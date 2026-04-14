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

export class OpenAICompatibleAsrProvider implements AsrProvider {
  private readonly config: ProviderConfig["asr"];
  private readonly callbacks: AsrProviderCallbacks;
  private readonly sampleRate = 16000;
  private readonly bytesPerChunk: number;
  private buffer = Buffer.alloc(0);
  private processing = Promise.resolve();
  private chunkIndex = 0;
  private started = false;

  constructor(config: ProviderConfig["asr"], callbacks: AsrProviderCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.bytesPerChunk = Math.max(1000, Math.floor((config.chunkMs / 1000) * this.sampleRate * 2));
  }

  async start(): Promise<void> {
    this.started = true;
    this.callbacks.onStatus("ASR 已连接");
  }

  async sendAudio(chunk: Buffer): Promise<void> {
    if (!this.started) {
      return;
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= this.bytesPerChunk) {
      const current = this.buffer.subarray(0, this.bytesPerChunk);
      this.buffer = this.buffer.subarray(this.bytesPerChunk);
      this.enqueueChunk(current);
    }
  }

  async stop(): Promise<void> {
    if (this.buffer.length > 0) {
      this.enqueueChunk(this.buffer);
      this.buffer = Buffer.alloc(0);
    }
    await this.processing;
    this.started = false;
  }

  private enqueueChunk(chunk: Buffer): void {
    const index = this.chunkIndex++;
    this.callbacks.onPartialText(`正在识别第 ${index + 1} 段音频...`);
    this.processing = this.processing.then(async () => {
      const inputLevel = measureLevel(chunk);
      const startMs = index * this.config.chunkMs;
      const endMs = startMs + Math.round((chunk.length / 2 / this.sampleRate) * 1000);
      const decodeStartedAt = Date.now();
      try {
        const text = await this.transcribeChunk(chunk);
        const trimmed = text.trim();
        const kind = trimmed ? "speech" : inputLevel >= 0.012 ? "unclear" : "silence";
        const processingMs = Date.now() - decodeStartedAt;
        const latencyMs = processingMs + this.config.chunkMs;
        await this.callbacks.onFinalText({
          text: trimmed,
          startMs,
          endMs,
          kind,
          note: trimmed
            ? null
            : inputLevel >= 0.012
              ? "这一段有音频活动，但没有识别出稳定文字。"
              : "这一段接近静音，没有检测到可识别人声。",
          inputLevel,
          overlapChars: 0,
          processingMs,
          latencyMs,
          quality: classifyTranscriptQuality({
            text: trimmed,
            kind,
            processingMs,
            latencyMs,
            inputLevel,
            overlapDetected: false,
            audioIssues: []
          }),
          overlapDetected: false,
          audioIssues: []
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
          overlapChars: 0,
          processingMs: Date.now() - decodeStartedAt,
          latencyMs: Date.now() - decodeStartedAt,
          quality: "low",
          overlapDetected: false,
          audioIssues: []
        });
        this.callbacks.onError(new Error(`第 ${index + 1} 段转写失败：${message}`));
      }
    });
  }

  private async transcribeChunk(chunk: Buffer): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error("ASR API Key 未配置");
    }

    const baseUrl = this.config.endpoint.replace(/\/$/, "");
    const formData = new FormData();
    const wav = pcm16MonoToWav(chunk, this.sampleRate);
    formData.append("file", new Blob([wav], { type: "audio/wav" }), "chunk.wav");
    formData.append("model", this.config.model);
    formData.append("language", this.config.language);

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const detail = errorBody.trim() ? `，返回：${errorBody.trim()}` : "";
      throw new Error(`ASR 请求失败: ${response.status} ${response.statusText}${detail}`);
    }

    const payload = (await response.json()) as { text?: string };
    return payload.text ?? "";
  }
}
