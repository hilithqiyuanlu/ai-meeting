import { contextBridge, ipcRenderer } from "electron";
import type { AppApi } from "@shared/ipc";
import type {
  AppEventMap,
  ExportFormat,
  SavePreferencesInput,
  SaveProviderConfigInput,
  StartMeetingInput
} from "@shared/types";

const api: AppApi = {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  refreshEnvironment: () => ipcRenderer.invoke("app:refresh-environment"),
  requestMicrophoneAccess: () => ipcRenderer.invoke("app:request-microphone-access"),
  getLocalAsrState: () => ipcRenderer.invoke("local-asr:get-state"),
  downloadLocalAsrModel: () => ipcRenderer.invoke("local-asr:download-model"),
  deleteLocalAsrModel: () => ipcRenderer.invoke("local-asr:delete-model"),
  importLocalAsrModelDir: () => ipcRenderer.invoke("local-asr:import-model-dir"),
  startMeeting: (input: StartMeetingInput) => ipcRenderer.invoke("meeting:start", input),
  pauseMeeting: () => ipcRenderer.invoke("meeting:pause"),
  resumeMeeting: (sessionId?: string) => ipcRenderer.invoke("meeting:resume", sessionId),
  stopMeeting: () => ipcRenderer.invoke("meeting:stop"),
  getMeetingDetail: (sessionId: string) => ipcRenderer.invoke("meeting:get-detail", sessionId),
  generateSummary: (sessionId: string) => ipcRenderer.invoke("meeting:generate-summary", sessionId),
  askMeetingQuestion: (sessionId: string, question: string) => ipcRenderer.invoke("meeting:ask-question", { sessionId, question }),
  deleteMeeting: (sessionId: string) => ipcRenderer.invoke("meeting:delete", sessionId),
  exportMeeting: (sessionId: string, format: ExportFormat) => ipcRenderer.invoke("meeting:export", { sessionId, format }),
  saveProviderConfig: (input: SaveProviderConfigInput) => ipcRenderer.invoke("settings:save-provider-config", input),
  savePreferences: (input: SavePreferencesInput) => ipcRenderer.invoke("settings:save-preferences", input),
  onEvent: <K extends keyof AppEventMap>(event: K, callback: (payload: AppEventMap[K]) => void) => {
    const channel = `app:event:${String(event)}`;
    const listener = (_: Electron.IpcRendererEvent, payload: AppEventMap[K]) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld("appApi", api);

declare global {
  interface Window {
    appApi: AppApi;
  }
}
