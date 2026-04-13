import { join } from "node:path";
import type { LocalAsrLanguage } from "@shared/types";
import { LocalAsrModelService } from "@main/services/local-asr-model-service";
import { createSenseVoiceRecognizer } from "@main/utils/sherpa-onnx";
import type { AsrProvider, AsrProviderCallbacks } from "./base";

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

function pcm16ToFloat32(chunk: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(chunk.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = chunk.readInt16LE(index * 2) / 32768;
  }
  return samples;
}

type SenseVoiceLocalProviderConfig = {
  chunkMs: number;
  modelId: string;
  modelDir: string | null;
  language: LocalAsrLanguage;
  modelService: LocalAsrModelService;
};

type OfflineRecognizer = ReturnType<typeof createSenseVoiceRecognizer>;

export class SenseVoiceLocalProvider implements AsrProvider {
  private readonly sampleRate = 16000;
  private readonly overlapMs = 1000;
  private readonly bytesPerChunk: number;
  private readonly overlapBytes: number;
  private readonly stepBytes: number;
  private buffer = Buffer.alloc(0);
  private processing = Promise.resolve();
  private chunkIndex = 0;
  private started = false;
  private recognizer: OfflineRecognizer | null = null;

  constructor(
    private readonly config: SenseVoiceLocalProviderConfig,
    private readonly callbacks: AsrProviderCallbacks
  ) {
    this.bytesPerChunk = Math.max(1000, Math.floor((config.chunkMs / 1000) * this.sampleRate * 2));
    this.overlapBytes = Math.min(Math.floor((this.overlapMs / 1000) * this.sampleRate * 2), Math.floor(this.bytesPerChunk / 2));
    this.stepBytes = this.bytesPerChunk - this.overlapBytes;
  }

  async start(): Promise<void> {
    const state = await this.config.modelService.getState();
    const modelDir = this.config.modelDir || state.storagePath;
    if (!modelDir) {
      throw new Error("SenseVoice 模型尚未下载，请先在设置页完成下载。");
    }

    this.recognizer = createSenseVoiceRecognizer({
      modelPath: join(modelDir, "model.int8.onnx"),
      language: this.config.language,
      useInverseTextNormalization: true
    });
    this.started = true;
    this.callbacks.onStatus(`SenseVoice 本地 ASR 已就绪 (${this.config.modelId})`);
  }

  async sendAudio(chunk: Buffer): Promise<void> {
    if (!this.started || !this.recognizer) {
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
    this.recognizer?.free();
    this.recognizer = null;
    this.started = false;
  }

  private enqueueChunk(chunk: Buffer, byteOffset: number): void {
    const recognizer = this.recognizer;
    if (!recognizer) {
      return;
    }

    const index = this.chunkIndex++;
    const startMs = Math.round((byteOffset / 2 / this.sampleRate) * 1000);
    const endMs = startMs + Math.round((chunk.length / 2 / this.sampleRate) * 1000);
    const inputLevel = measureLevel(chunk);
    const overlapChars = Math.round((this.overlapBytes / 2 / this.sampleRate) * 10) / 10;

    this.callbacks.onPartialText(`正在用 SenseVoice 识别第 ${index + 1} 段音频...`);
    this.processing = this.processing.then(async () => {
      const stream = recognizer.createStream();
      try {
        stream.acceptWaveform(this.sampleRate, pcm16ToFloat32(chunk));
        recognizer.decode(stream);
        const text = (recognizer.getResult(stream).text ?? "").trim();
        const kind = text ? "speech" : inputLevel >= 0.012 ? "unclear" : "silence";
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
          overlapChars
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
          overlapChars
        });
        this.callbacks.onError(new Error(`SenseVoice 第 ${index + 1} 段识别失败：${message}`));
      } finally {
        stream.free();
      }
    });
  }
}
