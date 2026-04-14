import type { BrowserWindow } from "electron";
import type {
  AudioActivityState,
  AppEventMap,
  MeetingDetail,
  RecordingSnapshot,
  TranscriptSegment,
  StartMeetingInput
} from "@shared/types";
import { OpenAICompatibleAsrProvider } from "@main/providers/asr/openai-compatible-asr";
import { GeminiOpenAIAudioAsrProvider } from "@main/providers/asr/gemini-openai-audio";
import { SenseVoiceLocalProvider } from "@main/providers/asr/sensevoice-local";
import type { AsrProvider } from "@main/providers/asr/base";
import { OpenAICompatibleLlmProvider } from "@main/providers/llm/openai-compatible-llm";
import { OllamaLocalLlmProvider } from "@main/providers/llm/ollama-local-llm";
import { AppDatabase } from "./database";
import { EnvironmentService } from "./environment-service";
import { ExportService } from "./export-service";
import { SystemAudioHelperClient } from "./audio-helper";
import { computePcmRms, getAudioState } from "@main/utils/audio";
import { trimOverlappedTranscript } from "@main/utils/transcript";
import { LocalAsrModelService } from "./local-asr-model-service";

export class MeetingService {
  private recording: RecordingSnapshot = {
    activeSessionId: null,
    status: "idle",
    startedAt: null,
    deviceId: null,
    deviceName: null,
    captureMode: "microphone",
    partialText: "",
    audioState: "unknown",
    inputLevel: 0,
    lastAudioAt: null,
    lastTranscriptAt: null,
    successfulSegments: 0,
    silentSegments: 0,
    unclearSegments: 0,
    failedSegments: 0,
    consecutiveAsrFailures: 0,
    errorMessage: null
  };

  private audioClient: SystemAudioHelperClient | null = null;
  private asrProvider: AsrProvider | null = null;
  private activeWindow: BrowserWindow | null = null;
  private transcriptSeq = 0;
  private lastSpeechText = "";
  private readonly summaryJobs = new Set<string>();

  constructor(
    private readonly db: AppDatabase,
    private readonly environmentService: EnvironmentService,
    private readonly exportService: ExportService,
    private readonly downloadDirectory: string,
    private readonly localAsrModelService: LocalAsrModelService
  ) {}

  attachWindow(window: BrowserWindow): void {
    this.activeWindow = window;
  }

  getRecordingSnapshot(): RecordingSnapshot {
    return this.recording;
  }

  async startMeeting(input: StartMeetingInput): Promise<RecordingSnapshot> {
    if (this.recording.activeSessionId) {
      throw new Error("已有会议正在录制");
    }

    const session = this.db.createSession(input);
    this.transcriptSeq = 0;
    this.recording = this.createRecordingSnapshot(
      session.id,
      session.startedAt,
      input.audioDeviceId,
      input.audioDeviceName,
      input.captureMode,
      "starting"
    );
    this.emit("recording-state", this.recording);
    this.emit("session-updated", session);

    try {
      await this.beginCapture(session.id, input.audioDeviceId, input.audioDeviceName);
      this.recording = {
        ...this.recording,
        status: "recording"
      };
      this.emit("recording-state", this.recording);
      return this.recording;
    } catch (error) {
      await this.handleRecordingFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async pauseMeeting(): Promise<RecordingSnapshot> {
    const sessionId = this.recording.activeSessionId;
    if (!sessionId) {
      return this.recording;
    }

    this.recording = { ...this.recording, status: "stopping", partialText: "正在暂停并整理当前录音..." };
    this.emit("recording-state", this.recording);
    await this.audioClient?.stopCapture();
    this.recording = { ...this.recording, status: "processing", partialText: "正在整理最后几段转写，请稍候..." };
    this.emit("recording-state", this.recording);
    await this.asrProvider?.stop();

    const paused = this.db.updateSession(sessionId, {
      status: "paused"
    });
    this.audioClient = null;
    this.asrProvider = null;
    this.recording = {
      ...this.recording,
      status: "paused",
      partialText: "当前会议已暂停，可以继续录制或结束会议。"
    };
    this.emit("session-updated", paused);
    this.emit("recording-state", this.recording);
    return this.recording;
  }

  async resumeMeeting(sessionId?: string): Promise<RecordingSnapshot> {
    const targetSessionId = sessionId || this.recording.activeSessionId;
    if (!targetSessionId) {
      throw new Error("没有可继续的会议。");
    }

    const session = this.db.getSession(targetSessionId);
    if (session.status !== "paused" && this.recording.status !== "paused") {
      throw new Error("当前会议不处于暂停状态。");
    }

    this.transcriptSeq = this.db.listTranscriptSegments(targetSessionId).length;
    this.recording = {
      ...this.recording,
      activeSessionId: targetSessionId,
      status: "starting",
      deviceId: session.audioDeviceId,
      deviceName: session.audioDeviceName,
      captureMode: session.captureMode,
      partialText: "正在继续录制..."
    };
    this.emit("recording-state", this.recording);

    await this.beginCapture(targetSessionId, session.audioDeviceId, session.audioDeviceName);
    const resumed = this.db.updateSession(targetSessionId, {
      status: "recording"
    });
    this.recording = {
      ...this.recording,
      status: "recording",
      partialText: "已继续录制。"
    };
    this.emit("session-updated", resumed);
    this.emit("recording-state", this.recording);
    return this.recording;
  }

  async stopMeeting(): Promise<RecordingSnapshot> {
    const sessionId = this.recording.activeSessionId;
    if (!sessionId) {
      return this.recording;
    }

    const session = this.db.getSession(sessionId);
    if (this.recording.status === "recording") {
      this.recording = { ...this.recording, status: "stopping" };
      this.emit("recording-state", this.recording);
      await this.audioClient?.stopCapture();
      this.recording = {
        ...this.recording,
        status: "processing",
        partialText: "正在整理最后几段转写，请稍候..."
      };
      this.emit("recording-state", this.recording);
      this.emit(
        "session-updated",
        this.db.updateSession(sessionId, {
          status: "processing"
        })
      );
      await this.asrProvider?.stop();
    } else if (this.recording.status === "paused") {
      this.recording = {
        ...this.recording,
        status: "processing",
        partialText: "正在结束这场会议..."
      };
      this.emit("recording-state", this.recording);
    }

    const endedAt = new Date().toISOString();
    const updated = this.db.updateSession(sessionId, {
      status: "completed",
      endedAt,
      durationMs: new Date(endedAt).getTime() - new Date(session.startedAt).getTime()
    });

    this.resetRecordingState();
    this.emit("session-updated", updated);
    this.emit("recording-state", this.recording);
    return this.recording;
  }

  async getMeetingDetail(sessionId: string): Promise<MeetingDetail> {
    return this.db.getMeetingDetail(sessionId);
  }

  async generateSummary(sessionId: string): Promise<MeetingDetail> {
    if (this.summaryJobs.has(sessionId)) {
      throw new Error("这场会议的纪要已经在生成中，请稍候。");
    }

    const detail = this.db.getMeetingDetail(sessionId);
    if (!detail.session.transcriptText.trim()) {
      throw new Error("当前会议还没有可用转写内容");
    }

    const provider = this.createLlmProvider();
    const sourceSegmentSeq = detail.transcriptSegments.at(-1)?.seq ?? 0;
    const sourceTranscriptChars = detail.session.transcriptText.length;
    const generatedWhileStatus =
      detail.session.status === "recording" || detail.session.status === "paused" ? detail.session.status : "completed";
    const generating = this.db.updateSession(sessionId, {
      summaryStatus: "generating"
    });
    this.summaryJobs.add(sessionId);
    this.emit("session-updated", generating);

    try {
      const summary = await provider.generateSummary(detail.session.transcriptText, detail.session.title);
      this.db.saveSummary({
        sessionId,
        ...summary,
        sourceSegmentSeq,
        sourceTranscriptChars,
        generatedWhileStatus
      });
      const updated = this.db.updateSession(sessionId, {
        summaryStatus: "ready"
      });
      const nextDetail = this.db.getMeetingDetail(sessionId);
      this.emit("session-updated", updated);
      this.emit("summary-updated", {
        sessionId,
        summary: nextDetail.summary
      });
      return nextDetail;
    } catch (error) {
      const updated = this.db.updateSession(sessionId, {
        summaryStatus: "error"
      });
      this.emit("session-updated", updated);
      this.emit("error", {
        scope: "summary",
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      this.summaryJobs.delete(sessionId);
    }
  }

  async askMeetingQuestion(sessionId: string, question: string): Promise<MeetingDetail> {
    const detail = this.db.getMeetingDetail(sessionId);
    if (!detail.transcriptSegments.some((segment) => segment.kind === "speech")) {
      throw new Error("先完成有效转写，再进行会议问答。");
    }

    const provider = this.createLlmProvider();
    const answer = await provider.answerQuestion({
      transcript: detail.session.transcriptText,
      title: detail.session.title,
      summary: detail.summary
        ? {
            overview: detail.summary.overview,
            bulletPoints: detail.summary.bulletPoints,
            actionItems: detail.summary.actionItems,
            risks: detail.summary.risks,
            rawResponse: detail.summary.rawResponse,
            sourceSegmentSeq: detail.summary.sourceSegmentSeq,
            sourceTranscriptChars: detail.summary.sourceTranscriptChars,
            generatedWhileStatus: detail.summary.generatedWhileStatus
          }
        : null,
      history: detail.qaItems.map((item) => ({
        question: item.question,
        answer: item.answer
      })),
      question
    });

    this.db.appendQaItem({
      sessionId,
      question,
      answer,
      model: this.db.getProviderConfig().llm.model
    });

    return this.db.getMeetingDetail(sessionId);
  }

  async deleteMeeting(sessionId: string): Promise<void> {
    if (this.recording.activeSessionId === sessionId) {
      throw new Error(
        this.recording.status === "processing"
          ? "这场会议正在整理最后几段转写，请稍候再删除。"
          : "请先停止当前录制后再删除。"
      );
    }

    this.db.deleteMeeting(sessionId);
  }

  async exportMeeting(sessionId: string, format: "markdown" | "txt"): Promise<string> {
    const detail = this.db.getMeetingDetail(sessionId);
    const preferences = this.db.getPreferences();
    return this.exportService.exportMeeting(detail, format, preferences, this.downloadDirectory);
  }

  private buildAsrCallbacks(sessionId: string) {
    return {
      onPartialText: (text: string) => {
        this.updatePartialText(text);
      },
      onFinalText: async (payload: {
        text: string;
        startMs: number;
        endMs: number;
        kind: TranscriptSegment["kind"];
        note: string | null;
        inputLevel: number;
        overlapChars: number;
      }) => {
        const nextSpeech =
          payload.kind === "speech"
            ? trimOverlappedTranscript(this.lastSpeechText, payload.text)
            : { text: payload.text, overlapChars: payload.overlapChars };

        const segment = this.db.appendTranscriptSegment({
          sessionId,
          seq: ++this.transcriptSeq,
          text: nextSpeech.text,
          startMs: payload.startMs,
          endMs: payload.endMs,
          isFinal: true,
          kind: payload.kind,
          note: payload.note,
          inputLevel: payload.inputLevel,
          overlapChars: payload.kind === "speech" ? nextSpeech.overlapChars : payload.overlapChars
        });

        const currentSession = this.db.getSession(sessionId);
        const transcriptText =
          segment.kind === "speech" && segment.text
            ? currentSession.transcriptText
              ? `${currentSession.transcriptText}\n${segment.text}`
              : segment.text
            : currentSession.transcriptText;

        const updated = this.db.updateSession(sessionId, {
          transcriptText
        });

        this.bumpRecordingCounters(segment);
        if (segment.kind === "speech" && segment.text) {
          this.lastSpeechText = segment.text;
        }

        this.emit("transcript-final", {
          sessionId,
          segment,
          transcriptText
        });
        this.emit("session-updated", updated);
        this.updatePartialText("");
      },
      onStatus: (status: string) => {
        this.updatePartialText(status);
      },
      onError: (error: Error) => {
        this.recording = {
          ...this.recording,
          audioState: this.recording.audioState === "device-error" ? "device-error" : this.recording.audioState,
          errorMessage: error.message
        };
        this.emit("error", {
          scope: "asr",
          message: error.message
        });
        this.emit("recording-state", this.recording);
      }
    };
  }

  private createLlmProvider(): OpenAICompatibleLlmProvider | OllamaLocalLlmProvider {
    const llmConfig = this.db.getProviderConfig().llm;
    return llmConfig.providerId === "ollama-local"
      ? new OllamaLocalLlmProvider(llmConfig)
      : new OpenAICompatibleLlmProvider(llmConfig);
  }

  private bumpRecordingCounters(segment: TranscriptSegment): void {
    const now = new Date().toISOString();
    if (segment.kind === "speech") {
      this.recording = {
        ...this.recording,
        audioState: "capturing",
        lastAudioAt: now,
        lastTranscriptAt: now,
        successfulSegments: this.recording.successfulSegments + 1,
        consecutiveAsrFailures: 0,
        errorMessage: null
      };
    } else if (segment.kind === "silence") {
      this.recording = {
        ...this.recording,
        silentSegments: this.recording.silentSegments + 1
      };
    } else if (segment.kind === "unclear") {
      this.recording = {
        ...this.recording,
        audioState: "capturing",
        lastAudioAt: now,
        unclearSegments: this.recording.unclearSegments + 1
      };
    } else {
      this.recording = {
        ...this.recording,
        failedSegments: this.recording.failedSegments + 1,
        consecutiveAsrFailures: this.recording.consecutiveAsrFailures + 1,
        errorMessage: segment.note
      };
    }
    this.emit("recording-state", this.recording);
  }

  private async handleRecordingFailure(error: Error): Promise<void> {
    if (!this.recording.activeSessionId) {
      return;
    }

    const sessionId = this.recording.activeSessionId;
    try {
      await this.audioClient?.stopCapture();
      await this.asrProvider?.stop();
    } catch {
      // ignore cleanup failure
    }

    const current = this.db.getSession(sessionId);
    const failed = this.db.updateSession(sessionId, {
      status: "failed",
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(current.startedAt).getTime()
    });

    this.recording = {
      ...this.recording,
      status: "error",
      errorMessage: error.message
    };

    this.emit("error", {
      scope: "recording",
      message: error.message
    });
    this.emit("session-updated", failed);
    this.emit("recording-state", this.recording);
  }

  private resetRecordingState(): void {
    this.audioClient = null;
    this.asrProvider = null;
    this.transcriptSeq = 0;
    this.lastSpeechText = "";
    this.recording = {
      activeSessionId: null,
      status: "idle",
      startedAt: null,
      deviceId: null,
      deviceName: null,
      captureMode: "microphone",
      partialText: "",
      audioState: "unknown",
      inputLevel: 0,
      lastAudioAt: null,
      lastTranscriptAt: null,
      successfulSegments: 0,
      silentSegments: 0,
      unclearSegments: 0,
      failedSegments: 0,
      consecutiveAsrFailures: 0,
      errorMessage: null
    };
  }

  private async beginCapture(sessionId: string, deviceId: string, deviceName: string): Promise<void> {
    const providerConfig = this.db.getProviderConfig();
    const helperPath = this.environmentService.getHelperBinaryPath();
    this.audioClient = new SystemAudioHelperClient(helperPath);
    this.asrProvider =
      providerConfig.asr.providerId === "sensevoice-local"
        ? new SenseVoiceLocalProvider(
            {
              chunkMs: providerConfig.asr.chunkMs || 8000,
              modelId: providerConfig.asr.localModelId || this.localAsrModelService.getModelId(),
              modelDir: providerConfig.asr.localModelDir,
              language: providerConfig.asr.localLanguage,
              modelService: this.localAsrModelService
            },
            this.buildAsrCallbacks(sessionId)
          )
        : providerConfig.asr.providerId === "gemini-openai-audio"
          ? new GeminiOpenAIAudioAsrProvider(providerConfig.asr, this.buildAsrCallbacks(sessionId))
          : new OpenAICompatibleAsrProvider(providerConfig.asr, this.buildAsrCallbacks(sessionId));

    await this.asrProvider.start();
    await this.audioClient.startCapture(deviceId, {
      onAudioChunk: async (chunk) => {
        this.trackAudioInput(chunk);
        await this.asrProvider?.sendAudio(chunk);
      },
      onStatus: (message) => {
        this.updatePartialText(message);
      },
      onError: (message) => {
        this.setAudioState("device-error", message);
        void this.handleRecordingFailure(new Error(message));
      }
    });

    this.recording = {
      ...this.recording,
      activeSessionId: sessionId,
      deviceId,
      deviceName
    };
  }

  private createRecordingSnapshot(
    sessionId: string,
    startedAt: string,
    deviceId: string,
    deviceName: string,
    captureMode: RecordingSnapshot["captureMode"],
    status: RecordingSnapshot["status"]
  ): RecordingSnapshot {
    return {
      activeSessionId: sessionId,
      status,
      startedAt,
      deviceId,
      deviceName,
      captureMode,
      partialText: "",
      audioState: "unknown",
      inputLevel: 0,
      lastAudioAt: null,
      lastTranscriptAt: null,
      successfulSegments: 0,
      silentSegments: 0,
      unclearSegments: 0,
      failedSegments: 0,
      consecutiveAsrFailures: 0,
      errorMessage: null
    };
  }

  private updatePartialText(text: string): void {
    this.recording = {
      ...this.recording,
      partialText: text
    };
    this.emit("recording-state", this.recording);
    if (this.recording.activeSessionId) {
      this.emit("transcript-partial", {
        sessionId: this.recording.activeSessionId,
        text
      });
    }
  }

  private trackAudioInput(chunk: Buffer): void {
    const inputLevel = computePcmRms(chunk);
    const lastAudioAt = inputLevel >= 0.015 ? new Date().toISOString() : this.recording.lastAudioAt;
    const audioState = getAudioState(inputLevel, lastAudioAt);

    this.recording = {
      ...this.recording,
      inputLevel,
      lastAudioAt,
      audioState
    };
    this.emit("recording-state", this.recording);
  }

  private setAudioState(audioState: AudioActivityState, errorMessage: string | null): void {
    this.recording = {
      ...this.recording,
      audioState,
      errorMessage
    };
    this.emit("recording-state", this.recording);
  }

  private emit<K extends keyof AppEventMap>(event: K, payload: AppEventMap[K]): void {
    this.activeWindow?.webContents.send(`app:event:${String(event)}`, payload);
  }
}
