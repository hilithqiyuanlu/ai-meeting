import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { access } from "node:fs/promises";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import type { AudioInputDevice, AudioProcessingBackend, CaptureMode } from "@shared/types";

const execFileAsync = promisify(execFile);

interface CaptureCallbacks {
  onAudioChunk: (chunk: Buffer) => void | Promise<void>;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}

interface HelperOutputEvent {
  type: "status" | "error" | "audio_chunk";
  message?: string;
  pcmBase64?: string;
}

interface HelperCapabilitiesResponse {
  voiceProcessingSupported: boolean;
}

interface CaptureOptions {
  captureMode: CaptureMode;
  backend: AudioProcessingBackend;
}

export class SystemAudioHelperClient {
  private process: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stdoutBuffer = "";

  constructor(private readonly helperBinaryPath: string | null) {}

  async isAvailable(): Promise<boolean> {
    if (!this.helperBinaryPath) {
      return false;
    }

    try {
      await access(this.helperBinaryPath);
      return true;
    } catch {
      return false;
    }
  }

  async listDevices(): Promise<AudioInputDevice[]> {
    if (!(await this.isAvailable()) || !this.helperBinaryPath) {
      return [];
    }

    const { stdout } = await execFileAsync(this.helperBinaryPath, ["devices"]);
    const payload = JSON.parse(stdout) as { devices: AudioInputDevice[] };
    return payload.devices;
  }

  async getCapabilities(): Promise<HelperCapabilitiesResponse> {
    if (!(await this.isAvailable()) || !this.helperBinaryPath) {
      return { voiceProcessingSupported: false };
    }

    const { stdout } = await execFileAsync(this.helperBinaryPath, ["capabilities"]);
    return JSON.parse(stdout) as HelperCapabilitiesResponse;
  }

  async startCapture(deviceId: string, options: CaptureOptions, callbacks: CaptureCallbacks): Promise<void> {
    if (!(await this.isAvailable()) || !this.helperBinaryPath) {
      throw new Error("SystemAudioCaptureHelper 未构建，请先执行 pnpm swift:build");
    }
    if (this.process) {
      throw new Error("音频采集已在运行");
    }

    const args = ["capture", "--device-id", deviceId, "--backend", options.backend, "--capture-mode", options.captureMode];
    const proc = spawn(this.helperBinaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.process = proc;

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          const event = JSON.parse(trimmed) as HelperOutputEvent;
          if (event.type === "status" && event.message) {
            callbacks.onStatus(event.message);
          } else if (event.type === "error" && event.message) {
            callbacks.onError(event.message);
          } else if (event.type === "audio_chunk" && event.pcmBase64) {
            void callbacks.onAudioChunk(Buffer.from(event.pcmBase64, "base64"));
          }
        } catch {
          callbacks.onError(`无法解析 helper 输出: ${trimmed}`);
        }
      }
    });

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => callbacks.onStatus(chunk.trim()));

    proc.on("exit", (code) => {
      if (this.process && code !== 0 && code !== null) {
        callbacks.onError(`音频采集进程退出，状态码 ${code}`);
      }
      this.process = null;
      this.stdoutBuffer = "";
    });
  }

  async stopCapture(): Promise<void> {
    if (!this.process) {
      return;
    }

    const proc = this.process;
    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      proc.kill("SIGINT");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
        resolve();
      }, 3000);
    });
    this.process = null;
  }
}
