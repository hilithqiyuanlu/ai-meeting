import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import log from "electron-log/main.js";
import { AppDatabase } from "./services/database";
import { EnvironmentService } from "./services/environment-service";
import { ExportService } from "./services/export-service";
import { LocalAsrModelService } from "./services/local-asr-model-service";
import { MeetingService } from "./services/meeting-service";

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#101417",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false
    }
  });

  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  log.initialize();

  const db = new AppDatabase(join(app.getPath("userData"), "storage", "meetings.db"));
  const localAsrModelService = new LocalAsrModelService(app.getPath("userData"));
  const environmentService = new EnvironmentService(localAsrModelService);
  const exportService = new ExportService();
  const meetingService = new MeetingService(
    db,
    environmentService,
    exportService,
    app.getPath("downloads"),
    localAsrModelService
  );

  const syncLocalAsrConfig = async () => {
    const state = await localAsrModelService.getState();
    const config = db.getProviderConfig();
    db.saveProviderConfig({
      ...config,
      asr: {
        ...config.asr,
        localModelId: state.modelId,
        localModelDir: state.storagePath
      }
    });
    return state;
  };

  localAsrModelService.subscribe((state) => {
    mainWindow?.webContents.send("app:event:local-model-updated", state);
  });

  ipcMain.handle("app:bootstrap", async () => ({
    environment: await environmentService.refresh(),
    config: db.getProviderConfig(),
    preferences: db.getPreferences(),
    sessions: db.listSessions(),
    recording: meetingService.getRecordingSnapshot()
  }));

  ipcMain.handle("app:refresh-environment", () => environmentService.refresh());
  ipcMain.handle("app:request-microphone-access", () => environmentService.requestMicrophoneAccess());
  ipcMain.handle("local-asr:get-state", () => localAsrModelService.getState());
  ipcMain.handle("local-asr:download-model", async () => {
    const state = await localAsrModelService.downloadModel();
    await syncLocalAsrConfig();
    return state;
  });
  ipcMain.handle("local-asr:delete-model", async () => {
    const state = await localAsrModelService.deleteModel();
    await syncLocalAsrConfig();
    return state;
  });
  ipcMain.handle("local-asr:import-model-dir", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 SenseVoice 模型目录",
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return localAsrModelService.getState();
    }

    const state = await localAsrModelService.importModelDirectory(result.filePaths[0]);
    await syncLocalAsrConfig();
    return state;
  });
  ipcMain.handle("meeting:start", async (_, payload) => meetingService.startMeeting(payload));
  ipcMain.handle("meeting:pause", () => meetingService.pauseMeeting());
  ipcMain.handle("meeting:resume", (_, sessionId: string | undefined) => meetingService.resumeMeeting(sessionId));
  ipcMain.handle("meeting:stop", () => meetingService.stopMeeting());
  ipcMain.handle("meeting:get-detail", (_, sessionId: string) => meetingService.getMeetingDetail(sessionId));
  ipcMain.handle("meeting:generate-summary", (_, sessionId: string) => meetingService.generateSummary(sessionId));
  ipcMain.handle("meeting:ask-question", (_, payload: { sessionId: string; question: string }) =>
    meetingService.askMeetingQuestion(payload.sessionId, payload.question)
  );
  ipcMain.handle("meeting:delete", (_, sessionId: string) => meetingService.deleteMeeting(sessionId));
  ipcMain.handle("meeting:export", (_, payload: { sessionId: string; format: "markdown" | "txt" }) =>
    meetingService.exportMeeting(payload.sessionId, payload.format)
  );
  ipcMain.handle("settings:save-provider-config", async (_, payload) => {
    const state = await localAsrModelService.getState();
    return db.saveProviderConfig({
      ...payload,
      asr: {
        ...payload.asr,
        localModelId: payload.asr.providerId === "sensevoice-local" ? state.modelId : payload.asr.localModelId,
        localModelDir: payload.asr.providerId === "sensevoice-local" ? state.storagePath : payload.asr.localModelDir
      }
    });
  });
  ipcMain.handle("settings:save-preferences", (_, payload) => db.savePreferences(payload));

  await createWindow();
  if (mainWindow) {
    meetingService.attachWindow(mainWindow);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

void bootstrap();
