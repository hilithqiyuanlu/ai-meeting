import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import log from "electron-log/main.js";
import { AppDatabase } from "./services/database";
import { EnvironmentService } from "./services/environment-service";
import { ExportService } from "./services/export-service";
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
  const environmentService = new EnvironmentService();
  const exportService = new ExportService();
  const meetingService = new MeetingService(db, environmentService, exportService, app.getPath("downloads"));

  ipcMain.handle("app:bootstrap", async () => ({
    environment: await environmentService.refresh(),
    config: db.getProviderConfig(),
    preferences: db.getPreferences(),
    sessions: db.listSessions(),
    recording: meetingService.getRecordingSnapshot()
  }));

  ipcMain.handle("app:refresh-environment", () => environmentService.refresh());
  ipcMain.handle("app:request-microphone-access", () => environmentService.requestMicrophoneAccess());
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
  ipcMain.handle("settings:save-provider-config", (_, payload) => db.saveProviderConfig(payload));
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
