import { access } from "node:fs/promises";
import { join } from "node:path";
import { app, systemPreferences } from "electron";
import type { EnvironmentStatus } from "@shared/types";
import { SystemAudioHelperClient } from "./audio-helper";

export class EnvironmentService {
  getHelperBinaryPath(): string | null {
    const devPath = join(process.cwd(), "swift/SystemAudioCaptureHelper/.build/release/SystemAudioCaptureHelper");
    const packagedPath = join(process.resourcesPath, "SystemAudioCaptureHelper");
    return app.isPackaged ? packagedPath : devPath;
  }

  async refresh(): Promise<EnvironmentStatus> {
    const helperBinaryPath = this.getHelperBinaryPath();
    let helperBinaryFound = false;
    if (helperBinaryPath) {
      try {
        await access(helperBinaryPath);
        helperBinaryFound = true;
      } catch {
        helperBinaryFound = false;
      }
    }

    const helper = new SystemAudioHelperClient(helperBinaryPath);
    const audioDevices = helperBinaryFound ? await helper.listDevices().catch(() => []) : [];

    const microphonePermission = this.getMicrophonePermission();
    const microphoneDevices = audioDevices.filter((device) => !device.isBlackHole);
    const systemAudioDevices = audioDevices.filter((device) => device.isBlackHole);
    return {
      platform: process.platform,
      isMacOS: process.platform === "darwin",
      helperBinaryFound,
      microphonePermission,
      hasBlackHoleDevice: audioDevices.some((device) => device.isBlackHole),
      audioDevices,
      microphoneDevices,
      systemAudioDevices,
      voiceProcessingAvailable: false,
      helperBuildHint: "运行 `pnpm swift:build` 以构建 SystemAudioCaptureHelper"
    };
  }

  getMicrophonePermission(): EnvironmentStatus["microphonePermission"] {
    if (process.platform !== "darwin") {
      return "unknown";
    }

    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted" || status === "denied" || status === "not-determined" || status === "restricted") {
      return status;
    }
    return "unknown";
  }

  requestMicrophoneAccess(): Promise<boolean> {
    return systemPreferences.askForMediaAccess("microphone");
  }
}
