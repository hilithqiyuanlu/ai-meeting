import { join } from "node:path";
import type { CaptureMode, LocalAsrLanguage, ProviderConfig } from "@shared/types";
import { LocalAsrModelService } from "@main/services/local-asr-model-service";
import { createSenseVoiceRecognizer } from "@main/utils/sherpa-onnx";
import { classifyTranscriptQuality, pcm16ToFloat32, prepareAudioChunk } from "@main/utils/audio-pipeline";
import { stitchTranscript } from "@main/utils/transcript";
import { VadSegmenter } from "@main/utils/vad";
import type { AsrProvider, AsrProviderCallbacks } from "./base";

type SenseVoiceLocalProviderConfig = {
  chunkMs: number;
  modelId: string;
  modelDir: string | null;
  language: LocalAsrLanguage;
  modelService: LocalAsrModelService;
  captureMode: CaptureMode;
  asr: Pick<
    ProviderConfig["asr"],
    | "latencyMode"
    | "vadEnabled"
    | "vadThreshold"
    | "vadPreRollMs"
    | "vadPostRollMs"
    | "minSpeechMs"
    | "maxSpeechMs"
    | "aecMode"
    | "noiseSuppressionMode"
    | "autoGainMode"
    | "overlapDetectionEnabled"
    | "audioProcessingBackend"
  >;
};

function deriveVadStrategy(config: SenseVoiceLocalProviderConfig["asr"]) {
  if (config.latencyMode === "fast") {
    return {
      threshold: Math.max(0.008, config.vadThreshold * 0.95),
      preRollMs: Math.max(120, Math.round(config.vadPreRollMs * 0.8)),
      postRollMs: Math.max(180, Math.round(config.vadPostRollMs * 0.72)),
      minSpeechMs: Math.max(300, Math.round(config.minSpeechMs * 0.65)),
      maxSpeechMs: Math.max(2200, Math.round(config.maxSpeechMs * 0.72))
    };
  }

  if (config.latencyMode === "accurate") {
    return {
      threshold: config.vadThreshold,
      preRollMs: Math.round(config.vadPreRollMs * 1.15),
      postRollMs: Math.round(config.vadPostRollMs * 1.25),
      minSpeechMs: Math.round(config.minSpeechMs * 1.15),
      maxSpeechMs: Math.round(config.maxSpeechMs * 1.15)
    };
  }

  return {
    threshold: config.vadThreshold,
    preRollMs: config.vadPreRollMs,
    postRollMs: config.vadPostRollMs,
    minSpeechMs: config.minSpeechMs,
    maxSpeechMs: config.maxSpeechMs
  };
}

type OfflineRecognizer = ReturnType<typeof createSenseVoiceRecognizer>;

export class SenseVoiceLocalProvider implements AsrProvider {
  private readonly sampleRate = 16000;
  private readonly bytesPerChunk: number;
  private buffer = Buffer.alloc(0);
  private processing = Promise.resolve();
  private chunkIndex = 0;
  private started = false;
  private recognizer: OfflineRecognizer | null = null;
  private readonly vadSegmenter: VadSegmenter;
  private lastFinalText = "";

  constructor(
    private readonly config: SenseVoiceLocalProviderConfig,
    private readonly callbacks: AsrProviderCallbacks
  ) {
    this.bytesPerChunk = Math.max(1000, Math.floor((config.chunkMs / 1000) * this.sampleRate * 2));
    const strategy = deriveVadStrategy(config.asr);
    this.vadSegmenter = new VadSegmenter({
      sampleRate: this.sampleRate,
      frameMs: 30,
      threshold: strategy.threshold,
      preRollMs: strategy.preRollMs,
      postRollMs: strategy.postRollMs,
      minSpeechMs: strategy.minSpeechMs,
      maxSpeechMs: strategy.maxSpeechMs
    });
  }

  async start(): Promise<void> {
    const state = await this.config.modelService.getState();
    const modelDir = this.config.modelDir || state.storagePath;
    if (!modelDir) {
      throw new Error("SenseVoice 模型尚未下载，请先在设置页完成下载。");
    }

    this.recognizer = createSenseVoiceRecognizer({
      modelPath: join(modelDir, "model.int8.onnx"),
      tokensPath: join(modelDir, "tokens.txt"),
      language: this.config.language,
      useInverseTextNormalization: true
    });
    this.started = true;
    this.callbacks.onStatus(
      `SenseVoice 本地 ASR 已就绪 (${this.config.modelId}) · ${this.config.asr.vadEnabled ? `VAD ${this.config.asr.latencyMode}` : "固定分段"}`
    );
  }

  async sendAudio(chunk: Buffer): Promise<void> {
    if (!this.started || !this.recognizer) {
      return;
    }

    if (!this.config.asr.vadEnabled) {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= this.bytesPerChunk) {
        const current = this.buffer.subarray(0, this.bytesPerChunk);
        this.buffer = this.buffer.subarray(this.bytesPerChunk);
        this.enqueueChunk(current, this.chunkIndex * this.config.chunkMs, this.chunkIndex * this.config.chunkMs + this.config.chunkMs);
      }
      return;
    }

    const segments = this.vadSegmenter.push(chunk);
    if (segments.length === 0) {
      this.callbacks.onPartialText("正在监听麦克风，等待稳定语音...");
      return;
    }

    for (const segment of segments) {
      this.enqueueChunk(segment.pcm, segment.startMs, segment.endMs, segment.inputLevel);
    }
  }

  async stop(): Promise<void> {
    if (!this.config.asr.vadEnabled && this.buffer.length > 0) {
      const durationMs = Math.round((this.buffer.length / 2 / this.sampleRate) * 1000);
      this.enqueueChunk(this.buffer, this.chunkIndex * this.config.chunkMs, this.chunkIndex * this.config.chunkMs + durationMs);
      this.buffer = Buffer.alloc(0);
    }

    if (this.config.asr.vadEnabled) {
      for (const segment of this.vadSegmenter.flush()) {
        this.enqueueChunk(segment.pcm, segment.startMs, segment.endMs, segment.inputLevel);
      }
    }

    await this.processing;
    this.recognizer?.free();
    this.recognizer = null;
    this.started = false;
  }

  private enqueueChunk(chunk: Buffer, startMs: number, endMs: number, fallbackInputLevel?: number): void {
    const recognizer = this.recognizer;
    if (!recognizer) {
      return;
    }

    const index = this.chunkIndex++;
    this.callbacks.onPartialText(`正在用 SenseVoice 识别第 ${index + 1} 段高价值语音...`);
    this.processing = this.processing.then(async () => {
      const prepared = prepareAudioChunk(chunk, {
        noiseSuppressionMode: this.config.asr.noiseSuppressionMode,
        autoGainMode: this.config.asr.autoGainMode,
        overlapDetectionEnabled: this.config.asr.overlapDetectionEnabled,
        aecMode: this.config.asr.aecMode,
        audioProcessingBackend: this.config.asr.audioProcessingBackend
      });

      const decodeStartedAt = Date.now();
      const stream = recognizer.createStream();
      try {
        stream.acceptWaveform(this.sampleRate, pcm16ToFloat32(prepared.pcm));
        recognizer.decode(stream);
        const rawText = (recognizer.getResult(stream).text ?? "").trim();
        const stitched = stitchTranscript(this.lastFinalText, rawText);
        const text = stitched.text;
        const inputLevel = fallbackInputLevel ?? prepared.metrics.rms;
        const baseKind = text ? "speech" : inputLevel >= this.config.asr.vadThreshold ? "unclear" : "silence";
        const processingMs = Date.now() - decodeStartedAt;
        const latencyBudget = this.config.asr.vadEnabled ? this.config.asr.vadPostRollMs : this.config.chunkMs;
        const latencyMs = processingMs + latencyBudget;
        const quality = classifyTranscriptQuality({
          text,
          kind: baseKind,
          processingMs,
          latencyMs,
          inputLevel,
          overlapDetected: prepared.overlapDetected,
          audioIssues: prepared.audioIssues
        });
        const note = this.buildNote(baseKind, prepared.audioIssues, prepared.overlapDetected, quality);

        if (baseKind === "speech" && text) {
          this.lastFinalText = text;
        }

        await this.callbacks.onFinalText({
          text,
          startMs,
          endMs,
          kind: baseKind,
          note,
          inputLevel,
          overlapChars: stitched.overlapChars,
          processingMs,
          latencyMs,
          quality,
          overlapDetected: prepared.overlapDetected,
          audioIssues: prepared.audioIssues,
          processedInputLevel: prepared.metrics.rms
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.callbacks.onFinalText({
          text: "",
          startMs,
          endMs,
          kind: "error",
          note: message,
          inputLevel: fallbackInputLevel ?? prepared.metrics.rms,
          overlapChars: 0,
          processingMs: Date.now() - decodeStartedAt,
          latencyMs: Date.now() - decodeStartedAt,
          quality: "low",
          overlapDetected: prepared.overlapDetected,
          audioIssues: prepared.audioIssues,
          processedInputLevel: prepared.metrics.rms
        });
        this.callbacks.onError(new Error(`SenseVoice 第 ${index + 1} 段识别失败：${message}`));
      } finally {
        stream.free();
      }
    });
  }

  private buildNote(
    kind: "speech" | "silence" | "unclear" | "error",
    audioIssues: string[],
    overlapDetected: boolean,
    quality: "high" | "medium" | "low"
  ): string | null {
    if (kind === "silence") {
      return "该时段未检测到稳定语音，已跳过本地识别。";
    }
    if (kind === "unclear") {
      return "检测到短语音或噪声活动，但不足以生成稳定文本。";
    }

    const warnings: string[] = [];
    if (overlapDetected) {
      warnings.push("检测到重叠发言");
    }
    if (audioIssues.includes("echo")) {
      warnings.push(this.config.captureMode === "microphone" ? "疑似扬声器回声" : "疑似回声");
    }
    if (audioIssues.includes("noise")) {
      warnings.push("噪声偏高");
    }
    if (audioIssues.includes("low-level")) {
      warnings.push("输入偏弱");
    }
    if (audioIssues.includes("clipping")) {
      warnings.push("输入过载");
    }
    if (quality === "low" && warnings.length === 0) {
      warnings.push("该段置信度较低");
    }

    return warnings.length > 0 ? warnings.join("，") : null;
  }
}
