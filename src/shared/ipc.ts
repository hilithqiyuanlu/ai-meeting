import type {
  AppEventMap,
  BootstrapState,
  EnvironmentStatus,
  ExportFormat,
  MeetingDetail,
  ProviderConfig,
  RecordingSnapshot,
  SavePreferencesInput,
  SaveProviderConfigInput,
  StartMeetingInput
} from "./types";

export interface AppApi {
  bootstrap(): Promise<BootstrapState>;
  refreshEnvironment(): Promise<EnvironmentStatus>;
  requestMicrophoneAccess(): Promise<boolean>;
  startMeeting(input: StartMeetingInput): Promise<RecordingSnapshot>;
  pauseMeeting(): Promise<RecordingSnapshot>;
  resumeMeeting(sessionId?: string): Promise<RecordingSnapshot>;
  stopMeeting(): Promise<RecordingSnapshot>;
  getMeetingDetail(sessionId: string): Promise<MeetingDetail>;
  generateSummary(sessionId: string): Promise<MeetingDetail>;
  askMeetingQuestion(sessionId: string, question: string): Promise<MeetingDetail>;
  deleteMeeting(sessionId: string): Promise<void>;
  exportMeeting(sessionId: string, format: ExportFormat): Promise<string>;
  saveProviderConfig(input: SaveProviderConfigInput): Promise<ProviderConfig>;
  savePreferences(input: SavePreferencesInput): Promise<SavePreferencesInput>;
  onEvent<K extends keyof AppEventMap>(event: K, callback: (payload: AppEventMap[K]) => void): () => void;
}
