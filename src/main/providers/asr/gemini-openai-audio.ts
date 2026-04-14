import type { ProviderConfig } from "@shared/types";
import { classifyTranscriptQuality } from "@main/utils/audio-pipeline";
import type { AsrProvider, AsrProviderCallbacks } from "./base";

function pcm16MonoToWav(input: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + input.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(input.length, 40);
  return Buffer.concat([header, input]);
}

type CompletionResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
};

function extractText(payload: CompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n");
  }
  return "";
}

function measureLevel(chunk: Buffer): number {
  if (chunk.length < 2) {
    return 0;
  }

  let sum = 0;
  let count = 0;
  for (let index = 0; index + 1 < chunk.length; index += 2) {
    const sample = chunk.readInt16LE(index) / 32768;
    sum += sample * sample;
    count += 1;
  }

  return count === 0 ? 0 : Math.sqrt(sum / count);
}

export class GeminiOpenAIAudioAsrProvider implements AsrProvider {
  private readonly config: ProviderConfig["asr"];
  private readonly callbacks: AsrProviderCallbacks;
  private readonly sampleRate = 16000;
  private readonly bytesPerChunk: number;
  private readonly overlapBytes: number;
  private readonly stepBytes: number;
  private buffer = Buffer.alloc(0);
  private processing = Promise.resolve();
  private chunkIndex = 0;
  private started = false;

  constructor(config: ProviderConfig["asr"], callbacks: AsrProviderCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.bytesPerChunk = Math.max(1000, Math.floor((config.chunkMs / 1000) * this.sampleRate * 2));
    this.overlapBytes = Math.min(Math.floor(this.sampleRate * 2), Math.floor(this.bytesPerChunk / 4));
    this.stepBytes = this.bytesPerChunk - this.overlapBytes;
  }

  async start(): Promise<void> {
    this.started = true;
    this.callbacks.onStatus("Gemini ASR 已连接");
  }

  async sendAudio(chunk: Buffer): Promise<void> {
    if (!this.started) {
      return;
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= this.bytesPerChunk) {
      const current = this.buffer.subarray(0, this.bytesPerChunk);
      this.buffer = this.buffer.subarray(this.stepBytes);
      this.enqueueChunk(current, this.chunkIndex * this.stepBytes);
    }
  }

  async stop(): Promise<void> {
    if (this.buffer.length > this.overlapBytes / 2) {
      this.enqueueChunk(this.buffer, this.chunkIndex * this.stepBytes);
      this.buffer = Buffer.alloc(0);
    }
    await this.processing;
    this.started = false;
  }

  private enqueueChunk(chunk: Buffer, byteOffset: number): void {
    const index = this.chunkIndex++;
    const startMs = Math.round((byteOffset / 2 / this.sampleRate) * 1000);
    const endMs = startMs + Math.round((chunk.length / 2 / this.sampleRate) * 1000);
    const inputLevel = measureLevel(chunk);
    const overlapChars = Math.round((this.overlapBytes / 2 / this.sampleRate) * 10) / 10;

    this.callbacks.onPartialText(`正在用 Gemini 识别第 ${index + 1} 段音频...`);
    this.processing = this.processing.then(async () => {
      const decodeStartedAt = Date.now();
      try {
        const text = (await this.transcribeChunk(chunk)).trim();
        const kind = text ? "speech" : inputLevel >= 0.012 ? "unclear" : "silence";
        const processingMs = Date.now() - decodeStartedAt;
        const latencyMs = processingMs + Math.round((endMs - startMs) / 2);
        const note =
          kind === "silence"
            ? "这一段接近静音，没有检测到可识别人声。"
            : kind === "unclear"
              ? "这一段有音频活动，但没有识别出稳定文字。"
              : null;

        await this.callbacks.onFinalText({
          text,
          startMs,
          endMs,
          kind,
          note,
          inputLevel,
          overlapChars,
          processingMs,
          latencyMs,
          quality: classifyTranscriptQuality({
            text,
            kind,
            processingMs,
            latencyMs,
            inputLevel,
            overlapDetected: false,
            audioIssues: []
          }),
          overlapDetected: false,
          audioIssues: [],
          processedInputLevel: inputLevel
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.callbacks.onFinalText({
          text: "",
          startMs,
          endMs,
          kind: "error",
          note: message,
          inputLevel,
          overlapChars,
          processingMs: Date.now() - decodeStartedAt,
          latencyMs: Date.now() - decodeStartedAt,
          quality: "low",
          overlapDetected: false,
          audioIssues: [],
          processedInputLevel: inputLevel
        });
        this.callbacks.onError(new Error(`第 ${index + 1} 段转写失败：${message}`));
      }
    });
  }

  private async transcribeChunk(chunk: Buffer): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error("Gemini ASR API Key 未配置");
    }

    const baseUrl = this.config.endpoint.replace(/\/$/, "");
    const wav = pcm16MonoToWav(chunk, this.sampleRate);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请把这段会议音频逐字转写成简体中文。如果没有清晰语音，返回空字符串。不要总结，不要解释，不要补充额外说明。"
                },
                {
                  type: "input_audio",
                  input_audio: {
                    data: wav.toString("base64"),
                    format: "wav"
                  }
                }
              ]
            }
          ]
        })
      });
    } catch {
      throw new Error("网络连接失败，正在继续录音。");
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 401) {
        throw new Error("鉴权失败，请检查 ASR API Key。");
      }
      if (response.status === 429) {
        throw new Error("ASR 请求过于频繁，正在等待下一段继续识别。");
      }
      const detail = errorBody.trim() ? ` 详情：${errorBody.trim()}` : "";
      throw new Error(`有音频，但这一段暂时无法识别。${detail}`);
    }

    const payload = (await response.json()) as CompletionResponse;
    return extractText(payload);
  }
}
