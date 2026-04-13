import type { AsrProvider, AsrProviderCallbacks } from "./base";

export class SenseVoiceLocalProvider implements AsrProvider {
  constructor(private readonly callbacks: AsrProviderCallbacks) {}

  async start(): Promise<void> {
    this.callbacks.onStatus("SenseVoice 本地链路预留，当前版本未启用");
  }

  async sendAudio(): Promise<void> {
    throw new Error("SenseVoice 本地 ASR 尚未实现，请先使用云端 ASR");
  }

  async stop(): Promise<void> {
    return;
  }
}
