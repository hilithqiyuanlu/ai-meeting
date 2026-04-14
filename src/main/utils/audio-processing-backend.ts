import type {
  AudioProcessingBackend,
  AudioProcessingBackendPreference,
  CaptureMode,
  ProviderConfig
} from "@shared/types";

export function sanitizeRequestedAudioProcessingBackend(
  value: ProviderConfig["asr"]["audioProcessingBackend"] | undefined
): AudioProcessingBackendPreference {
  if (value === "none" || value === "heuristic-apm" || value === "system-voice-processing" || value === "auto") {
    return value;
  }

  return "auto";
}

export function resolveActiveAudioProcessingBackend(input: {
  requested: AudioProcessingBackendPreference;
  captureMode: CaptureMode;
  voiceProcessingAvailable: boolean;
}): AudioProcessingBackend {
  if (input.captureMode === "system-audio") {
    return input.requested === "none" ? "none" : "heuristic-apm";
  }

  if (input.requested === "none") {
    return "none";
  }

  if (input.requested === "heuristic-apm") {
    return "heuristic-apm";
  }

  if (input.requested === "system-voice-processing") {
    return input.voiceProcessingAvailable ? "system-voice-processing" : "heuristic-apm";
  }

  return input.voiceProcessingAvailable ? "system-voice-processing" : "heuristic-apm";
}
