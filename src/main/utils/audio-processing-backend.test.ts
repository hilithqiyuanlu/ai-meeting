import { describe, expect, it } from "vitest";
import { resolveActiveAudioProcessingBackend, sanitizeRequestedAudioProcessingBackend } from "./audio-processing-backend";

describe("sanitizeRequestedAudioProcessingBackend", () => {
  it("falls back to auto for invalid values", () => {
    expect(sanitizeRequestedAudioProcessingBackend(undefined)).toBe("auto");
  });
});

describe("resolveActiveAudioProcessingBackend", () => {
  it("prefers system backend in auto mode when available", () => {
    expect(
      resolveActiveAudioProcessingBackend({
        requested: "auto",
        captureMode: "microphone",
        voiceProcessingAvailable: true
      })
    ).toBe("system-voice-processing");
  });

  it("falls back to heuristic backend when system processing is unavailable", () => {
    expect(
      resolveActiveAudioProcessingBackend({
        requested: "system-voice-processing",
        captureMode: "microphone",
        voiceProcessingAvailable: false
      })
    ).toBe("heuristic-apm");
  });

  it("disables system voice processing in system-audio mode", () => {
    expect(
      resolveActiveAudioProcessingBackend({
        requested: "system-voice-processing",
        captureMode: "system-audio",
        voiceProcessingAvailable: true
      })
    ).toBe("heuristic-apm");
  });
});
