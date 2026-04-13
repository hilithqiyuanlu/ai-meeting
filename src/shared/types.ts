export type MeetingStatus = "idle" | "recording" | "paused" | "processing" | "completed" | "failed";

export type AsrProviderId = "openai-compatible-asr" | "gemini-openai-audio" | "sensevoice-local";
export type LlmProviderId = "openai-compatible-llm" | "gemini-openai-compatible";
export type TranscriptSegmentKind = "speech" | "silence" | "unclear" | "error";
export type AudioActivityState = "unknown" | "capturing" | "near-silence" | "no-signal" | "device-error";
export type CaptureMode = "microphone" | "system-audio";

export interface MeetingSession {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  status: MeetingStatus;
  audioDeviceId: string;
  audioDeviceName: string;
  captureMode: CaptureMode;
  transcriptText: string;
  summaryStatus: "none" | "generating" | "ready" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  seq: number;
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
  kind: TranscriptSegmentKind;
  note: string | null;
  inputLevel: number;
  overlapChars: number;
  createdAt: string;
}

export interface MeetingSummary {
  sessionId: string;
  overview: string;
  bulletPoints: string[];
  actionItems: string[];
  risks: string[];
  rawResponse: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingQaItem {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  model: string;
  createdAt: string;
}

export interface ProviderConfig {
  asr: {
    providerId: AsrProviderId;
    endpoint: string;
    apiKey: string;
    model: string;
    language: string;
    chunkMs: number;
  };
  llm: {
    providerId: LlmProviderId;
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

export interface AppPreferences {
  preferredAudioDeviceId: string | null;
  preferredAudioDeviceName: string | null;
  exportDirectory: string | null;
  exportIncludePlaceholders: boolean;
  captureMode: CaptureMode;
  onboardingCompleted: boolean;
}

export interface AudioInputDevice {
  id: string;
  name: string;
  isBlackHole: boolean;
}

export interface EnvironmentStatus {
  platform: string;
  isMacOS: boolean;
  helperBinaryFound: boolean;
  microphonePermission: "granted" | "denied" | "not-determined" | "restricted" | "unknown";
  hasBlackHoleDevice: boolean;
  audioDevices: AudioInputDevice[];
  microphoneDevices: AudioInputDevice[];
  systemAudioDevices: AudioInputDevice[];
  voiceProcessingAvailable: boolean;
  helperBuildHint: string;
}

export interface MeetingDetail {
  session: MeetingSession;
  transcriptSegments: TranscriptSegment[];
  summary: MeetingSummary | null;
  qaItems: MeetingQaItem[];
}

export interface RecordingSnapshot {
  activeSessionId: string | null;
  status: "idle" | "starting" | "recording" | "paused" | "stopping" | "processing" | "error";
  startedAt: string | null;
  deviceId: string | null;
  deviceName: string | null;
  captureMode: CaptureMode;
  partialText: string;
  audioState: AudioActivityState;
  inputLevel: number;
  lastAudioAt: string | null;
  lastTranscriptAt: string | null;
  successfulSegments: number;
  silentSegments: number;
  unclearSegments: number;
  failedSegments: number;
  consecutiveAsrFailures: number;
  errorMessage: string | null;
}

export interface BootstrapState {
  environment: EnvironmentStatus;
  config: ProviderConfig;
  preferences: AppPreferences;
  sessions: MeetingSession[];
  recording: RecordingSnapshot;
}

export interface StartMeetingInput {
  title: string;
  audioDeviceId: string;
  audioDeviceName: string;
  captureMode: CaptureMode;
}

export type ExportFormat = "markdown" | "txt";

export interface AppEventMap {
  "recording-state": RecordingSnapshot;
  "transcript-partial": {
    sessionId: string;
    text: string;
  };
  "transcript-final": {
    sessionId: string;
    segment: TranscriptSegment;
    transcriptText: string;
  };
  "session-updated": MeetingSession;
  "summary-updated": {
    sessionId: string;
    summary: MeetingSummary | null;
  };
  error: {
    scope: string;
    message: string;
  };
}

export type SaveProviderConfigInput = ProviderConfig;
export type SavePreferencesInput = AppPreferences;
