import { useEffect, useMemo, useState } from "react";
import type {
  AppPreferences,
  BootstrapState,
  EnvironmentStatus,
  MeetingDetail,
  MeetingSession,
  ProviderConfig,
  RecordingSnapshot
} from "@shared/types";

type TabId = "capture" | "settings";

function formatCompactDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function emptyDetail(): MeetingDetail | null {
  return null;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatRelativeStatus(value: string | null): string {
  if (!value) {
    return "暂无";
  }

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (deltaSeconds < 5) {
    return "刚刚";
  }
  if (deltaSeconds < 60) {
    return `${deltaSeconds} 秒前`;
  }
  return `${Math.floor(deltaSeconds / 60)} 分钟前`;
}

function audioStateLabel(state: RecordingSnapshot["audioState"]): string {
  switch (state) {
    case "capturing":
      return "检测到有效音频";
    case "near-silence":
      return "当前接近静音";
    case "no-signal":
      return "设备存在但没有声音";
    case "device-error":
      return "设备或采集异常";
    default:
      return "等待开始录音";
  }
}

function audioLevelPercent(level: number): number {
  return Math.max(2, Math.min(100, Math.round(level * 900)));
}

function recordingStatusLabel(recording: RecordingSnapshot): string {
  switch (recording.status) {
    case "starting":
      return "正在启动录制";
    case "recording":
      return "录制进行中";
    case "paused":
      return "会议已暂停";
    case "stopping":
      return "正在停止采集";
    case "processing":
      return "正在整理最后几段";
    case "error":
      return "录制异常";
    default:
      return "准备开始新会议";
  }
}

function meetingStatusLabel(status: MeetingSession["status"]): string {
  switch (status) {
    case "recording":
      return "录制中";
    case "paused":
      return "已暂停";
    case "processing":
      return "整理中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "待命";
  }
}

function meetingStatusIcon(status: MeetingSession["status"]): string {
  switch (status) {
    case "recording":
      return "●";
    case "paused":
      return "⏸";
    case "processing":
      return "…";
    case "completed":
      return "✓";
    case "failed":
      return "!";
    default:
      return "○";
  }
}

function meetingStatusTone(status: MeetingSession["status"]): string {
  switch (status) {
    case "recording":
      return "recording";
    case "paused":
      return "paused";
    case "processing":
      return "processing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

function meetingDisplayTitle(session: MeetingSession | null): string {
  if (!session) {
    return "实时记录";
  }

  if (session.title.startsWith("会议记录 ")) {
    return formatCompactDateTime(session.startedAt);
  }

  return session.title;
}

function getPreferredDevice(
  environment: EnvironmentStatus,
  preferences: AppPreferences,
  captureMode: AppPreferences["captureMode"]
) {
  const pool = captureMode === "microphone" ? environment.microphoneDevices : environment.systemAudioDevices;
  return pool.find((device) => device.id === preferences.preferredAudioDeviceId) || pool[0] || null;
}

function LoadingDots(props: {
  label?: string;
}) {
  return (
    <span className="loading-dots" role="status" aria-live="polite" aria-label={props.label ?? "加载中"}>
      <span></span>
      <span></span>
      <span></span>
    </span>
  );
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(emptyDetail());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("capture");
  const [notice, setNotice] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [qaInput, setQaInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MeetingSession | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const [providerDraft, setProviderDraft] = useState<ProviderConfig | null>(null);
  const [preferenceDraft, setPreferenceDraft] = useState<AppPreferences | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        if (!window.appApi) {
          throw new Error("应用桥接接口未加载，请重启应用。");
        }

        const state = await window.appApi.bootstrap();
        setBootstrap(state);
        setProviderDraft(state.config);
        setPreferenceDraft(state.preferences);
        setSelectedSessionId(state.sessions[0]?.id ?? null);
        setActiveTab("capture");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    const offRecording = window.appApi.onEvent("recording-state", (payload) => {
      setBootstrap((current) => (current ? { ...current, recording: payload } : current));
      if (payload.activeSessionId) {
        setSelectedSessionId((current) => current ?? payload.activeSessionId);
      }
    });
    const offSession = window.appApi.onEvent("session-updated", (payload) => {
      setBootstrap((current) => {
        if (!current) {
          return current;
        }
        const exists = current.sessions.some((item) => item.id === payload.id);
        const sessions = exists
          ? current.sessions.map((item) => (item.id === payload.id ? payload : item))
          : [payload, ...current.sessions];
        return { ...current, sessions: sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
      });
      if (payload.id === selectedSessionId) {
        void loadDetail(payload.id);
      }
    });
    const offSummary = window.appApi.onEvent("summary-updated", (payload) => {
      if (payload.sessionId === selectedSessionId) {
        void loadDetail(payload.sessionId);
      }
    });
    const offError = window.appApi.onEvent("error", (payload) => {
      setNotice(`${payload.scope}: ${payload.message}`);
    });

    return () => {
      offRecording();
      offSession();
      offSummary();
      offError();
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!deleteTarget) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !deletingSessionId) {
        setDeleteTarget(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteTarget, deletingSessionId]);

  const selectedDeviceId = useMemo(() => {
    if (!bootstrap) {
      return "";
    }
    return (
      preferenceDraft?.preferredAudioDeviceId ||
      bootstrap.environment.audioDevices.find((device) => device.isBlackHole)?.id ||
      bootstrap.environment.audioDevices[0]?.id ||
      ""
    );
  }, [bootstrap, preferenceDraft?.preferredAudioDeviceId]);

  if (loading) {
    return <div className="screen-center">正在加载工作台...</div>;
  }

  if (!bootstrap || !providerDraft || !preferenceDraft) {
    return (
      <div className="screen-center error-screen">
        <div>
          <p className="eyebrow">启动失败</p>
          <h1>应用没有正确加载</h1>
          <p>{notice || "请重启应用，如果仍然失败，把终端错误发给我。"}</p>
        </div>
      </div>
    );
  }

  const state = bootstrap;
  const configDraft = providerDraft;
  const prefsDraft = preferenceDraft;
  const currentSession = selectedSessionId
    ? state.sessions.find((item) => item.id === selectedSessionId) ?? null
    : null;

  async function loadDetail(sessionId: string): Promise<void> {
    const next = await window.appApi.getMeetingDetail(sessionId);
    setDetail(next);
  }

  async function refreshEnvironment(): Promise<void> {
    const environment = await window.appApi.refreshEnvironment();
    setBootstrap((current) => (current ? { ...current, environment } : current));
  }

  async function requestMicrophoneAccess(): Promise<void> {
    const granted = await window.appApi.requestMicrophoneAccess();
    setNotice(granted ? "麦克风权限已授权" : "麦克风权限未授权");
    await refreshEnvironment();
  }

  async function startMeeting(): Promise<void> {
    try {
      const device = getPreferredDevice(state.environment, prefsDraft, prefsDraft.captureMode);
      if (!device) {
        setNotice(prefsDraft.captureMode === "microphone" ? "没有可用麦克风设备。" : "没有可用系统音频输入设备。");
        return;
      }

      const title = `会议记录 ${new Date().toLocaleString("zh-CN")}`;
      await window.appApi.startMeeting({
        title,
        audioDeviceId: device.id,
        audioDeviceName: device.name,
        captureMode: prefsDraft.captureMode
      });
      setActiveTab("capture");
      setPreferenceDraft((current) =>
        current
          ? {
              ...current,
              preferredAudioDeviceId: device.id,
              preferredAudioDeviceName: device.name
            }
          : current
      );
      setNotice("录制已启动");
    } catch (error) {
      setNotice(`开始录制失败：${toMessage(error)}`);
    }
  }

  async function stopMeeting(): Promise<void> {
    try {
      await window.appApi.stopMeeting();
      setNotice("录制已停止");
    } catch (error) {
      setNotice(`停止录制失败：${toMessage(error)}`);
    }
  }

  async function saveSettings(): Promise<void> {
    setSaving(true);
    try {
      const config = await window.appApi.saveProviderConfig(configDraft);
      const preferences = await window.appApi.savePreferences(prefsDraft);
      setBootstrap((current) => (current ? { ...current, config, preferences } : current));
      setNotice("设置已保存");
    } finally {
      setSaving(false);
    }
  }

  async function completeGuide(): Promise<void> {
    const next = {
      ...prefsDraft,
      onboardingCompleted: true
    };
    const saved = await window.appApi.savePreferences(next);
    setPreferenceDraft(saved);
    setBootstrap((current) => (current ? { ...current, preferences: saved } : current));
    setActiveTab("capture");
  }

  async function runSummary(): Promise<void> {
    if (!selectedSessionId) {
      return;
    }
    try {
      const next = await window.appApi.generateSummary(selectedSessionId);
      setDetail(next);
      setNotice("AI 纪要已生成");
    } catch (error) {
      setNotice(`生成 AI 纪要失败：${toMessage(error)}`);
    }
  }

  async function exportSession(format: "markdown" | "txt"): Promise<void> {
    if (!selectedSessionId) {
      return;
    }
    try {
      const filePath = await window.appApi.exportMeeting(selectedSessionId, format);
      setNotice(`已导出到 ${filePath}`);
    } catch (error) {
      setNotice(`导出失败：${toMessage(error)}`);
    }
  }

  async function confirmDeleteSession(): Promise<void> {
    if (!deleteTarget) {
      return;
    }

    const target = deleteTarget;
    const deletingSelected = selectedSessionId === target.id;
    const remainingSessions = state.sessions.filter((item) => item.id !== target.id);

    setDeletingSessionId(target.id);
    try {
      await window.appApi.deleteMeeting(target.id);
      setBootstrap((current) =>
        current
          ? {
              ...current,
              sessions: current.sessions.filter((item) => item.id !== target.id)
            }
          : current
      );

      if (deletingSelected) {
        const nextSelectedId = remainingSessions[0]?.id ?? null;
        setDetail(null);
        setSelectedSessionId(nextSelectedId);
      }

      setDeleteTarget(null);
      setNotice("会议记录已删除");
    } catch (error) {
      setNotice(`删除失败：${toMessage(error)}`);
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function askQuestion(): Promise<void> {
    if (!selectedSessionId || !qaInput.trim()) {
      return;
    }

    setAsking(true);
    try {
      const next = await window.appApi.askMeetingQuestion(selectedSessionId, qaInput.trim());
      setDetail(next);
      setQaInput("");
      setNotice("会议问答已更新");
    } catch (error) {
      setNotice(`会议问答失败：${toMessage(error)}`);
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-panel">
            <div className="sidebar-intro">
              <p className="eyebrow">Meeting Archive</p>
              <h1>AI Meeting</h1>
            </div>

            <HistoryPanel
              sessions={state.sessions}
              selectedSessionId={selectedSessionId}
              onSelect={(sessionId) => {
                setSelectedSessionId(sessionId);
                setActiveTab("capture");
              }}
              onDelete={(session) => setDeleteTarget(session)}
            />

            <div className="sidebar-footer">
              <button
                className={activeTab === "settings" ? "sidebar-settings active" : "sidebar-settings"}
                type="button"
                onClick={() => setActiveTab("settings")}
              >
                <span className="sidebar-settings-label">系统设置</span>
                <span className="sidebar-settings-meta">录音、模型与导出</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="workspace">
          <header className="workspace-header">
            <div className="workspace-heading">
              <p className="eyebrow">{activeTab === "settings" ? "System Preferences" : "Workspace"}</p>
              <h2>{activeTab === "settings" ? "设置中心" : meetingDisplayTitle(currentSession)}</h2>
              {activeTab === "settings" ? <p className="workspace-subtitle">统一维护采集、转写与纪要生成配置。</p> : null}
            </div>
            {notice ? <div className="notice">{notice}</div> : null}
          </header>

          <section className="workspace-content">
            <div className={activeTab === "capture" ? "panel primary capture-layout" : "panel primary scrollable"}>
              {activeTab === "capture" ? (
                <>
                  <CapturePanel
                    environment={state.environment}
                    recording={state.recording}
                    currentSession={currentSession}
                    selectedDeviceId={selectedDeviceId}
                  />
                  <TranscriptPanel detail={detail} />
                </>
              ) : (
                <SettingsPanel
                  environment={state.environment}
                  providerDraft={configDraft}
                  preferenceDraft={prefsDraft}
                  onProviderChange={setProviderDraft}
                  onPreferenceChange={setPreferenceDraft}
                  onSave={saveSettings}
                  saving={saving}
                  onRefresh={refreshEnvironment}
                  onRequestAccess={requestMicrophoneAccess}
                  onCompleteGuide={async () => {
                    await completeGuide();
                    setActiveTab("capture");
                  }}
                />
              )}
            </div>

            <div className="panel rail">
              <ControlRail
                currentSession={currentSession}
                detail={detail}
                recording={state.recording}
                onStart={startMeeting}
                onPause={async () => {
                  try {
                    await window.appApi.pauseMeeting();
                    setNotice("会议已暂停");
                  } catch (error) {
                    setNotice(`暂停失败：${toMessage(error)}`);
                  }
                }}
                onResume={async () => {
                  try {
                    const targetSessionId = currentSession?.status === "paused" ? currentSession.id : undefined;
                    await window.appApi.resumeMeeting(targetSessionId);
                    setNotice("会议已继续录制");
                  } catch (error) {
                    setNotice(`继续录制失败：${toMessage(error)}`);
                  }
                }}
                onStop={stopMeeting}
                onExport={exportSession}
              />
              <SummaryPanel
                detail={detail}
                recording={state.recording}
                qaInput={qaInput}
                asking={asking}
                onQaInputChange={setQaInput}
                onAskQuestion={askQuestion}
                onGenerateSummary={runSummary}
              />
            </div>
          </section>
        </main>
      </div>

      {deleteTarget ? (
        <DeleteConfirmDialog
          session={deleteTarget}
          deleting={deletingSessionId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDeleteSession()}
        />
      ) : null}
    </>
  );
}

function CapturePanel(props: {
  environment: EnvironmentStatus;
  recording: RecordingSnapshot;
  currentSession: MeetingSession | null;
  selectedDeviceId: string;
}) {
  const [statusExpanded, setStatusExpanded] = useState(false);
  const selectedDevice = props.environment.audioDevices.find((item) => item.id === props.selectedDeviceId);
  const summaryItems = [
    {
      label: "录制",
      value: recordingStatusLabel(props.recording)
    },
    {
      label: "输入",
      value: audioStateLabel(props.recording.audioState)
    },
    {
      label: "片段",
      value: `${props.recording.successfulSegments}/${props.recording.failedSegments}`
    }
  ];

  return (
    <div className="stack">
      <section className="capture-banner">
        <div className="capture-banner-main">
          <p className="eyebrow">Realtime Capture</p>
          <h3>{selectedDevice?.name ?? "未选择采集设备"}</h3>
          <p className="muted">
            {props.currentSession ? `当前会议状态：${meetingStatusLabel(props.currentSession.status)}` : "准备创建一场新的会议记录。"}
          </p>
        </div>
        <span className={`session-status-pill tone-${meetingStatusTone(props.currentSession?.status ?? "idle")}`}>
          {props.currentSession ? meetingStatusLabel(props.currentSession.status) : "待命"}
        </span>
      </section>

      <section className={statusExpanded ? "accordion-card open" : "accordion-card"}>
        <button
          className="accordion-trigger"
          type="button"
          aria-expanded={statusExpanded}
          onClick={() => setStatusExpanded((current) => !current)}
        >
          <div className="accordion-trigger-main">
            <p className="eyebrow">System Status</p>
            <h4>运行状态</h4>
          </div>
          <div className="accordion-trigger-side">
            <div className="accordion-summary">
              {summaryItems.map((item) => (
                <span key={item.label} className="summary-chip">
                  <span className="summary-chip-label">{item.label}</span>
                  <span className="summary-chip-value">{item.value}</span>
                </span>
              ))}
            </div>
            <span className="accordion-icon">{statusExpanded ? "−" : "+"}</span>
          </div>
        </button>

        {statusExpanded ? (
          <div className="accordion-content">
            <div className="metrics-grid">
              <article className="metric-card">
                <span>状态</span>
                <strong>{recordingStatusLabel(props.recording)}</strong>
              </article>
              <article className="metric-card">
                <span>输入状态</span>
                <strong>{audioStateLabel(props.recording.audioState)}</strong>
              </article>
              <article className="metric-card">
                <span>输入电平</span>
                <strong>{Math.round(props.recording.inputLevel * 1000) / 1000}</strong>
              </article>
              <article className="metric-card">
                <span>最近有声</span>
                <strong>{formatRelativeStatus(props.recording.lastAudioAt)}</strong>
              </article>
              <article className="metric-card">
                <span>最近转写成功</span>
                <strong>{formatRelativeStatus(props.recording.lastTranscriptAt)}</strong>
              </article>
              <article className="metric-card">
                <span>片段统计</span>
                <strong>
                  成功 {props.recording.successfulSegments} / 静音 {props.recording.silentSegments} / 失败 {props.recording.failedSegments}
                </strong>
              </article>
            </div>

            <div className="level-card level-card-inline">
              <div className="section-head">
                <div>
                  <h4>实时电平</h4>
                  <p className="muted">{audioStateLabel(props.recording.audioState)}</p>
                </div>
                <span className="mono-text">{selectedDevice?.name ?? "未选择设备"}</span>
              </div>
              <div className="level-track">
                <div className="level-fill" style={{ width: `${audioLevelPercent(props.recording.inputLevel)}%` }}></div>
              </div>
              <p className="level-readout mono-text">input level {Math.round(props.recording.inputLevel * 1000) / 1000}</p>
              <p>{props.recording.partialText || "等待音频输入..."}</p>
              {props.recording.errorMessage ? <p className="error-text">最近错误：{props.recording.errorMessage}</p> : null}
              {props.recording.consecutiveAsrFailures > 0 ? (
                <p className="warning-text">连续失败段数：{props.recording.consecutiveAsrFailures}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function HistoryPanel(props: {
  sessions: MeetingSession[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onDelete?: (session: MeetingSession) => void;
}) {
  return (
    <section className="history-panel">
      <div className="history-panel-header">
        <div>
          <p className="eyebrow">History</p>
          <h3>历史会议</h3>
        </div>
        <span className="history-count mono-text">{props.sessions.length}</span>
      </div>

      <div className="history-list-shell">
        {props.sessions.length === 0 ? (
          <div className="history-empty">
            <p className="mono-text">暂无会议记录</p>
            <p className="muted">开始一场新会议后，记录会出现在这里。</p>
          </div>
        ) : (
          <div className="history-list">
            {props.sessions.map((session) => {
              const tone = meetingStatusTone(session.status);
              return (
                <div key={session.id} className={props.selectedSessionId === session.id ? "history-row selected" : "history-row"}>
                  <button className="history-main" type="button" onClick={() => props.onSelect(session.id)}>
                    <span className="history-title mono-text">{formatCompactDateTime(session.startedAt)}</span>
                    <span className="history-subline">
                      <span className={`history-status-badge tone-${tone}`}>
                        <span className="history-status-icon">{meetingStatusIcon(session.status)}</span>
                        <span>{meetingStatusLabel(session.status)}</span>
                      </span>
                    </span>
                  </button>
                  {props.onDelete ? (
                    <button className="history-delete" type="button" aria-label="删除会议记录" onClick={() => props.onDelete?.(session)}>
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsPanel(props: {
  environment: EnvironmentStatus;
  providerDraft: ProviderConfig;
  preferenceDraft: AppPreferences;
  onProviderChange: (value: ProviderConfig) => void;
  onPreferenceChange: (value: AppPreferences) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  onRefresh: () => Promise<void>;
  onRequestAccess: () => Promise<void>;
  onCompleteGuide: () => Promise<void>;
}) {
  const { providerDraft, preferenceDraft, environment } = props;

  return (
    <div className="stack">
      <section className="settings-hero">
        <p className="eyebrow">System Preferences</p>
        <h3>全局设置</h3>
        <p className="muted">统一管理采集模式、模型配置、本地导出和首次引导偏好。</p>
      </section>

      <div className="settings-grid">
        <div className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">Capture</p>
            <h4>采集模式</h4>
          </div>
          <div className="capture-mode-grid">
            <button
              className={preferenceDraft.captureMode === "microphone" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() =>
                props.onPreferenceChange({
                  ...preferenceDraft,
                  captureMode: "microphone"
                })
              }
            >
              麦克风模式
            </button>
            <button
              className={preferenceDraft.captureMode === "system-audio" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() =>
                props.onPreferenceChange({
                  ...preferenceDraft,
                  captureMode: "system-audio"
                })
              }
            >
              系统音频模式
            </button>
          </div>
          <p className="muted">
            {preferenceDraft.captureMode === "microphone"
              ? "适合线下会议；线上会议建议佩戴耳机。"
              : "适合线上会议；需要先配置 BlackHole。"}
          </p>
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">ASR</p>
            <h4>转写服务</h4>
          </div>
          <label className="form-field">
            <span>Endpoint</span>
            <input
              value={providerDraft.asr.endpoint}
              onChange={(event) =>
                props.onProviderChange({
                  ...providerDraft,
                  asr: { ...providerDraft.asr, endpoint: event.target.value }
                })
              }
            />
          </label>
          <label className="form-field">
            <span>API Key</span>
            <input
              type="password"
              value={providerDraft.asr.apiKey}
              onChange={(event) =>
                props.onProviderChange({
                  ...providerDraft,
                  asr: { ...providerDraft.asr, apiKey: event.target.value }
                })
              }
            />
          </label>
          <label className="form-field">
            <span>Model</span>
            <input
              value={providerDraft.asr.model}
              onChange={(event) =>
                props.onProviderChange({
                  ...providerDraft,
                  asr: { ...providerDraft.asr, model: event.target.value }
                })
              }
            />
          </label>
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">LLM</p>
            <h4>纪要模型</h4>
          </div>
          <label className="form-field">
            <span>Base URL</span>
            <input
              value={providerDraft.llm.baseUrl}
              onChange={(event) =>
                props.onProviderChange({
                  ...providerDraft,
                  llm: { ...providerDraft.llm, baseUrl: event.target.value }
                })
              }
            />
          </label>
          <label className="form-field">
            <span>API Key</span>
            <input
              type="password"
              value={providerDraft.llm.apiKey}
              onChange={(event) =>
                props.onProviderChange({
                  ...providerDraft,
                  llm: { ...providerDraft.llm, apiKey: event.target.value }
                })
              }
            />
          </label>
          <label className="form-field">
            <span>Model</span>
            <input
              value={providerDraft.llm.model}
              onChange={(event) =>
                props.onProviderChange({
                  ...providerDraft,
                  llm: { ...providerDraft.llm, model: event.target.value }
                })
              }
            />
          </label>
          <p className="muted">默认推荐：gemini-2.5-flash</p>
        </div>

        <div className="settings-card settings-card-wide">
          <div className="settings-card-head">
            <p className="eyebrow">Workspace</p>
            <h4>本地偏好与权限</h4>
          </div>

          <div className="preference-list">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={preferenceDraft.onboardingCompleted}
                onChange={(event) =>
                  props.onPreferenceChange({
                    ...preferenceDraft,
                    onboardingCompleted: event.target.checked
                  })
                }
              />
              <span>跳过首次引导</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={preferenceDraft.exportIncludePlaceholders}
                onChange={(event) =>
                  props.onPreferenceChange({
                    ...preferenceDraft,
                    exportIncludePlaceholders: event.target.checked
                  })
                }
              />
              <span>导出 TXT 时保留静音/失败占位提示</span>
            </label>
          </div>

          <div className="guide-merged">
            <div className="guide-grid">
              <div className="guide-card">
                <span className="guide-label">权限状态</span>
                <strong className="mono-text">{environment.microphonePermission}</strong>
              </div>
              <div className="guide-card">
                <span className="guide-label">BlackHole</span>
                <strong>{environment.hasBlackHoleDevice ? "已检测到" : "未检测到"}</strong>
              </div>
            </div>

            <p className="muted">麦克风模式适合线下会议；系统音频模式适合线上会议，需要提前完成 BlackHole 配置。</p>

            <div className="control-grid">
              <button type="button" onClick={props.onRequestAccess}>
                请求麦克风权限
              </button>
              <button type="button" onClick={props.onRefresh}>
                重新扫描设备
              </button>
            </div>
          </div>

          <div className="settings-actions">
            <button className="primary-button" disabled={props.saving} type="button" onClick={props.onSave}>
              {props.saving ? "保存中..." : "保存设置"}
            </button>
            <button className="secondary-button" type="button" onClick={props.onCompleteGuide}>
              引导完成，返回工作台
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TranscriptPanel(props: {
  detail: MeetingDetail | null;
}) {
  if (!props.detail) {
    return (
      <div className="detail-card transcript-card empty-state">
        <p className="eyebrow">Transcript</p>
        <h3>选择一场会议</h3>
        <p>中间区域会展示当前会议的转写全文与片段状态。</p>
      </div>
    );
  }

  return (
    <div className="detail-card transcript-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Transcript</p>
          <h4>全文转写</h4>
        </div>
        <span className="mono-text">{props.detail.transcriptSegments.length} 段</span>
      </div>
      <div className="transcript-list">
        {props.detail.transcriptSegments.map((segment) => (
          <article key={segment.id} className={`transcript-item ${segment.kind}`}>
            <span className="transcript-time mono-text">{segment.startMs}ms</span>
            <div>
              <p>{segment.kind === "speech" ? segment.text : segment.note || "此段没有可用正文。"}</p>
              <small>
                类型：{segment.kind} | 电平：{Math.round(segment.inputLevel * 1000) / 1000} | 重叠：{segment.overlapChars}
              </small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SummaryPanel(props: {
  detail: MeetingDetail | null;
  recording: RecordingSnapshot;
  qaInput: string;
  asking: boolean;
  onQaInputChange: (value: string) => void;
  onAskQuestion: () => Promise<void>;
  onGenerateSummary: () => Promise<void>;
}) {
  const summaryStatus = props.detail?.session.summaryStatus ?? "none";
  const statusNode =
    summaryStatus === "generating" ? (
      <span className="summary-status summary-status-loading">
        <LoadingDots label="纪要生成中" />
      </span>
    ) : summaryStatus === "error" ? (
      <span className="summary-status summary-status-error">失败</span>
    ) : summaryStatus === "none" ? (
      <span className="summary-status">未生成</span>
    ) : null;

  return (
    <div className="detail-card result-panel">
      <div className="result-header">
        <div className="section-head">
          <div>
            <p className="eyebrow">AI Summary</p>
            <h4>会议纪要</h4>
          </div>
          {statusNode}
        </div>
        <button
          className="primary-button summary-generate-button"
          disabled={
            !props.detail ||
            props.detail.session.summaryStatus === "generating" ||
            props.detail.transcriptSegments.every((segment) => segment.kind !== "speech")
          }
          type="button"
          onClick={props.onGenerateSummary}
        >
          生成纪要
        </button>
      </div>
      <div className="result-body">
        {!props.detail ? (
          <p>先从左侧选择一场会议。</p>
        ) : props.detail.session.summaryStatus === "generating" ? (
          <p>AI 正在根据全文整理纪要，请稍候，不需要重复点击。</p>
        ) : props.detail.summary ? (
          <>
            <p>{props.detail.summary.overview}</p>
            <strong>关键结论</strong>
            <ul>
              {props.detail.summary.bulletPoints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <strong>待办事项</strong>
            <ul>
              {props.detail.summary.actionItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="qa-section">
              <div className="section-head">
                <strong>会议问答</strong>
                <span className="mono-text">{props.detail.qaItems.length} 条</span>
              </div>
              <div className="qa-list">
                {props.detail.qaItems.map((item) => (
                  <article key={item.id} className="qa-item">
                    <p className="qa-question">问：{item.question}</p>
                    <p className="qa-answer">答：{item.answer}</p>
                  </article>
                ))}
              </div>
              <div className="qa-compose">
                <textarea
                  placeholder="继续追问这场会议，例如：老师提出的具体要求是什么？"
                  value={props.qaInput}
                  onChange={(event) => props.onQaInputChange(event.target.value)}
                  rows={3}
                />
                <button disabled={props.asking || !props.qaInput.trim()} type="button" onClick={props.onAskQuestion}>
                  {props.asking ? "正在回答..." : "提问"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p>还没有纪要，停止录制后可以手动生成。生成完成后，你也可以继续对会议内容发起多轮提问。</p>
        )}
        {props.recording.status === "processing" ? <p className="warning-text">会议正在整理最后几段，完成后再生成纪要会更完整。</p> : null}
      </div>
    </div>
  );
}

function ControlRail(props: {
  currentSession: MeetingSession | null;
  detail: MeetingDetail | null;
  recording: RecordingSnapshot;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
  onExport: (format: "markdown" | "txt") => Promise<void>;
}) {
  const canStart = props.recording.status === "idle" || props.recording.status === "error";
  const canPause = props.recording.status === "recording";
  const canResume =
    props.recording.status === "paused" ||
    (props.recording.status === "idle" && props.currentSession?.status === "paused");
  const canFinish =
    props.recording.status === "recording" ||
    props.recording.status === "paused" ||
    props.recording.status === "processing";

  return (
    <div className="stack">
      <div className="detail-card control-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Controls</p>
            <h4>录制控制</h4>
          </div>
          <span className="mono-text">
            {props.currentSession ? meetingStatusLabel(props.currentSession.status) : "idle"}
          </span>
        </div>

        <div className="control-grid">
          <button className="primary-button" disabled={!canStart} type="button" onClick={props.onStart}>
            开始新会议
          </button>
          <button className="danger-ghost" disabled={!canFinish} type="button" onClick={props.onStop}>
            结束会议
          </button>
          <button disabled={!canResume} type="button" onClick={props.onResume}>
            继续
          </button>
          <button disabled={!canPause} type="button" onClick={props.onPause}>
            暂停
          </button>
          <button disabled={!props.detail} type="button" onClick={() => props.onExport("markdown")}>
            导出 MD
          </button>
          <button disabled={!props.detail} type="button" onClick={() => props.onExport("txt")}>
            导出 TXT
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmDialog(props: {
  session: MeetingSession;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={() => (!props.deleting ? props.onCancel() : undefined)}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">Delete Meeting</p>
        <h3 id="delete-dialog-title">确认删除这条会议记录？</h3>
        <p className="muted">会议时间：{formatCompactDateTime(props.session.startedAt)}</p>
        <p>删除后将同时移除全文转写、AI 纪要与问答记录，此操作不可撤销。</p>
        <div className="modal-actions">
          <button className="secondary-button" disabled={props.deleting} type="button" onClick={props.onCancel}>
            取消
          </button>
          <button className="danger-button" disabled={props.deleting} type="button" onClick={props.onConfirm}>
            {props.deleting ? "删除中..." : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
