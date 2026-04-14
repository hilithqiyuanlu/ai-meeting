import { useEffect, useMemo, useState } from "react";
import type {
  AppPreferences,
  BootstrapState,
  EnvironmentStatus,
  LocalAsrStatus,
  MeetingDetail,
  MeetingSession,
  ProviderConfig,
  RecordingSnapshot
} from "@shared/types";
import { detectMeetingTerms, groupMeetingHighlights, highlightText } from "./meeting-display";

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

function latencyModeLabel(mode: ProviderConfig["asr"]["latencyMode"]): string {
  switch (mode) {
    case "fast":
      return "快速";
    case "accurate":
      return "高精度";
    default:
      return "平衡";
  }
}

function transcriptQualityLabel(quality: RecordingSnapshot["inputQuality"]): string {
  switch (quality) {
    case "high":
      return "高";
    case "medium":
      return "中";
    default:
      return "低";
  }
}

function audioIssueLabel(issue: MeetingDetail["transcriptSegments"][number]["audioIssues"][number]): string {
  switch (issue) {
    case "echo":
      return "回声";
    case "noise":
      return "噪声";
    case "low-level":
      return "音量低";
    case "clipping":
      return "过载";
    default:
      return issue;
  }
}

function highlightKindLabel(kind: MeetingDetail["highlights"][number]["kind"]): string {
  switch (kind) {
    case "decision":
      return "决策";
    case "action":
      return "待办";
    case "risk":
      return "风险";
    default:
      return "待确认";
  }
}

function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) {
    return "暂无";
  }
  return `${latencyMs} ms`;
}

function formatCueTime(startMs: number | null): string {
  if (startMs === null) {
    return "--";
  }

  if (startMs < 60_000) {
    return `${Math.round(startMs / 100) / 10}s`;
  }

  const minutes = Math.floor(startMs / 60_000);
  const seconds = Math.floor((startMs % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function summarySourceSegment(detail: MeetingDetail | null): number {
  return detail?.summary?.sourceSegmentSeq ?? 0;
}

function latestSegmentSeq(detail: MeetingDetail | null): number {
  return detail?.transcriptSegments.at(-1)?.seq ?? 0;
}

function summaryNeedsRefresh(detail: MeetingDetail | null): boolean {
  return !!detail?.summary && latestSegmentSeq(detail) > summarySourceSegment(detail);
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

function isLegacyAutoMeetingTitle(title: string): boolean {
  return title.startsWith("会议记录 ");
}

function buildDefaultMeetingTitle(startedAt: Date, captureMode: AppPreferences["captureMode"]): string {
  const base = formatCompactDateTime(startedAt.toISOString());
  return captureMode === "microphone" ? base : `系统音频 ${base}`;
}

function meetingListTitle(session: MeetingSession): string {
  return isLegacyAutoMeetingTitle(session.title) ? formatCompactDateTime(session.startedAt) : session.title.trim() || formatCompactDateTime(session.startedAt);
}

function meetingDisplayTitle(session: MeetingSession | null): string {
  if (!session) {
    return "实时记录";
  }

  return meetingListTitle(session);
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
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);

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
    const offHighlight = window.appApi.onEvent("highlight-added", (payload) => {
      if (payload.sessionId === selectedSessionId) {
        void loadDetail(payload.sessionId);
      }
    });
    const offLocalModel = window.appApi.onEvent("local-model-updated", (payload: LocalAsrStatus) => {
      setBootstrap((current) =>
        current
          ? {
              ...current,
              environment: {
                ...current.environment,
                localModelState: payload.state,
                localModelDownloadProgress: payload.progress,
                localModelStoragePath: payload.storagePath,
                localModelErrorMessage: payload.errorMessage
              }
            }
          : current
      );
    });
    const offError = window.appApi.onEvent("error", (payload) => {
      setNotice(`${payload.scope}: ${payload.message}`);
    });

    return () => {
      offRecording();
      offSession();
      offSummary();
      offHighlight();
      offLocalModel();
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
    return getPreferredDevice(bootstrap.environment, preferenceDraft ?? bootstrap.preferences, (preferenceDraft ?? bootstrap.preferences).captureMode)?.id ?? "";
  }, [bootstrap, preferenceDraft]);

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
  const meetingTerms = useMemo(() => detectMeetingTerms(detail), [detail]);

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

      const title = buildDefaultMeetingTitle(new Date(), prefsDraft.captureMode);
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

  async function downloadLocalModel(): Promise<void> {
    try {
      const state = await window.appApi.downloadLocalAsrModel();
      setBootstrap((current) =>
        current
          ? {
              ...current,
              environment: {
                ...current.environment,
                localModelState: state.state,
                localModelDownloadProgress: state.progress,
                localModelStoragePath: state.storagePath,
                localModelErrorMessage: state.errorMessage
              }
            }
          : current
      );
      setNotice("SenseVoice 模型已下载");
    } catch (error) {
      setNotice(`模型下载失败：${toMessage(error)}`);
    }
  }

  async function deleteLocalModel(): Promise<void> {
    try {
      const state = await window.appApi.deleteLocalAsrModel();
      setBootstrap((current) =>
        current
          ? {
              ...current,
              environment: {
                ...current.environment,
                localModelState: state.state,
                localModelDownloadProgress: state.progress,
                localModelStoragePath: state.storagePath,
                localModelErrorMessage: state.errorMessage
              }
            }
          : current
      );
      setNotice("SenseVoice 模型已删除");
    } catch (error) {
      setNotice(`删除模型失败：${toMessage(error)}`);
    }
  }

  async function importLocalModelDir(): Promise<void> {
    try {
      const state = await window.appApi.importLocalAsrModelDir();
      setBootstrap((current) =>
        current
          ? {
              ...current,
              environment: {
                ...current.environment,
                localModelState: state.state,
                localModelDownloadProgress: state.progress,
                localModelStoragePath: state.storagePath,
                localModelErrorMessage: state.errorMessage
              }
            }
          : current
      );
      setNotice(state.state === "ready" ? "SenseVoice 模型已导入" : "已取消导入");
    } catch (error) {
      setNotice(`导入模型失败：${toMessage(error)}`);
    }
  }

  function beginRenameSession(session: MeetingSession): void {
    setEditingSessionId(session.id);
    setEditingSessionTitle(meetingListTitle(session));
    setNotice("");
  }

  async function commitRenameSession(session: MeetingSession): Promise<void> {
    if (renamingSessionId === session.id) {
      return;
    }

    const fallbackTitle = buildDefaultMeetingTitle(new Date(session.startedAt), session.captureMode);
    const nextTitle = editingSessionTitle.trim() || fallbackTitle;
    setRenamingSessionId(session.id);
    try {
      const next = await window.appApi.renameMeeting(session.id, nextTitle);
      if (selectedSessionId === session.id) {
        setDetail(next);
      }
      setEditingSessionId(null);
      setEditingSessionTitle("");
      setNotice("会议名称已更新");
    } catch (error) {
      setNotice(`重命名失败：${toMessage(error)}`);
    } finally {
      setRenamingSessionId(null);
    }
  }

  function cancelRenameSession(): void {
    setEditingSessionId(null);
    setEditingSessionTitle("");
    setRenamingSessionId(null);
  }

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-panel">
            <div className="sidebar-intro">
              <p className="eyebrow">Realtime Copilot</p>
              <h1>AI Meeting</h1>
            </div>

            <HistoryPanel
              sessions={state.sessions}
              selectedSessionId={selectedSessionId}
              editingSessionId={editingSessionId}
              editingSessionTitle={editingSessionTitle}
              renamingSessionId={renamingSessionId}
              canStart={state.recording.status === "idle" || state.recording.status === "error"}
              onSelect={(sessionId) => {
                setSelectedSessionId(sessionId);
                setActiveTab("capture");
              }}
              onStart={startMeeting}
              onBeginRename={beginRenameSession}
              onEditingTitleChange={setEditingSessionTitle}
              onCommitRename={(session) => void commitRenameSession(session)}
              onCancelRename={cancelRenameSession}
              onDelete={(session) => setDeleteTarget(session)}
            />

            <div className="sidebar-footer">
              <button
                className={activeTab === "settings" ? "sidebar-settings active" : "sidebar-settings"}
                type="button"
                onClick={() => setActiveTab("settings")}
              >
                <span className="sidebar-settings-label">系统设置</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="workspace">
          <header className="workspace-header">
            <div className="workspace-heading">
              <p className="eyebrow">{activeTab === "settings" ? "System Preferences" : "Realtime Copilot"}</p>
              <h2>{activeTab === "settings" ? "设置中心" : meetingDisplayTitle(currentSession)}</h2>
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
                  <HighlightsPanel detail={detail} compact meetingTerms={meetingTerms} />
                  <TranscriptPanel detail={detail} meetingTerms={meetingTerms} />
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
                  onDownloadLocalModel={downloadLocalModel}
                  onDeleteLocalModel={deleteLocalModel}
                  onImportLocalModelDir={importLocalModelDir}
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
                meetingTerms={meetingTerms}
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
  const summaryItems = [
    {
      label: "延迟",
      value: formatLatency(props.recording.currentLatencyMs)
    },
    {
      label: "质量",
      value: transcriptQualityLabel(props.recording.inputQuality)
    }
  ];

  return (
    <section className={statusExpanded ? "accordion-card open capture-status-card" : "accordion-card capture-status-card"}>
      <button
        className="accordion-trigger compact"
        type="button"
        aria-expanded={statusExpanded}
        onClick={() => setStatusExpanded((current) => !current)}
      >
        <div className="accordion-trigger-main">
          <p className="eyebrow">System Status</p>
          <h4>运行状态</h4>
        </div>
        <div className="accordion-trigger-side compact">
          <span className={`session-status-pill compact tone-${meetingStatusTone(props.currentSession?.status ?? "idle")}`}>
            {props.currentSession ? meetingStatusLabel(props.currentSession.status) : "待命"}
          </span>
          <div className="accordion-summary">
            {summaryItems.map((item) => (
              <span key={item.label} className="summary-chip compact">
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
                <span>实时延迟</span>
                <strong>{formatLatency(props.recording.currentLatencyMs)}</strong>
              </article>
              <article className="metric-card">
                <span>输入质量</span>
                <strong>{transcriptQualityLabel(props.recording.inputQuality)}</strong>
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
                <span>风险片段</span>
                <strong>低质 {props.recording.consecutiveLowQualitySegments} / 失败 {props.recording.failedSegments}</strong>
              </article>
            </div>

          <div className="level-card level-card-inline">
            <div className="section-head">
              <div>
                <h4>实时电平</h4>
                <p className="muted">
                  {latencyModeLabel(props.recording.latencyMode)}延迟策略 · {audioStateLabel(props.recording.audioState)}
                </p>
              </div>
            </div>
            <div className="level-track">
              <div className="level-fill" style={{ width: `${audioLevelPercent(props.recording.inputLevel)}%` }}></div>
            </div>
            <p className="level-readout mono-text">input level {Math.round(props.recording.inputLevel * 1000) / 1000}</p>
            <p>{props.recording.partialText || "等待稳定语音输入..."}</p>
            {props.recording.lastAudioIssues.length > 0 ? (
              <div className="tag-row">
                {props.recording.lastAudioIssues.map((issue) => (
                  <span key={issue} className="status-tag warning">
                    {audioIssueLabel(issue)}
                  </span>
                ))}
              </div>
            ) : null}
            {props.recording.lastOverlapAt ? (
              <p className="warning-text">最近检测到重叠发言：{formatRelativeStatus(props.recording.lastOverlapAt)}</p>
            ) : null}
            {props.recording.errorMessage ? <p className="error-text">最近错误：{props.recording.errorMessage}</p> : null}
            {props.recording.consecutiveAsrFailures > 0 ? (
              <p className="warning-text">连续失败段数：{props.recording.consecutiveAsrFailures}</p>
            ) : null}
            {props.recording.consecutiveLowQualitySegments > 0 ? (
              <p className="warning-text">连续低质量片段：{props.recording.consecutiveLowQualitySegments}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function HistoryPanel(props: {
  sessions: MeetingSession[];
  selectedSessionId: string | null;
  editingSessionId: string | null;
  editingSessionTitle: string;
  renamingSessionId: string | null;
  canStart: boolean;
  onSelect: (sessionId: string) => void;
  onStart: () => Promise<void>;
  onBeginRename: (session: MeetingSession) => void;
  onEditingTitleChange: (title: string) => void;
  onCommitRename: (session: MeetingSession) => void;
  onCancelRename: () => void;
  onDelete?: (session: MeetingSession) => void;
}) {
  return (
    <section className="history-panel">
      <div className="history-panel-header">
        <div>
          <p className="eyebrow">History</p>
          <h3>历史会议</h3>
        </div>
        <button
          className="history-add-button"
          type="button"
          aria-label="开始新会议"
          disabled={!props.canStart}
          onClick={() => void props.onStart()}
        >
          +
        </button>
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
              const editing = props.editingSessionId === session.id;
              return (
                <div key={session.id} className={props.selectedSessionId === session.id ? "history-row selected" : "history-row"}>
                  {editing ? (
                    <div className="history-edit-shell">
                      <input
                        autoFocus
                        className="history-title-input"
                        disabled={props.renamingSessionId === session.id}
                        value={props.editingSessionTitle}
                        onChange={(event) => props.onEditingTitleChange(event.target.value)}
                        onBlur={() => props.onCommitRename(session)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            props.onCommitRename(session);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            props.onCancelRename();
                          }
                        }}
                      />
                      <span className="history-edit-hint muted">
                        {props.renamingSessionId === session.id ? "保存中..." : "回车保存，Esc 取消"}
                      </span>
                    </div>
                  ) : (
                    <button
                      className="history-main"
                      type="button"
                      onClick={() => props.onSelect(session.id)}
                      onDoubleClick={() => props.onBeginRename(session)}
                    >
                      <span className="history-title mono-text">{meetingListTitle(session)}</span>
                      <span className="history-subline">
                        <span className={`history-status-badge tone-${tone}`}>
                          <span className="history-status-icon">{meetingStatusIcon(session.status)}</span>
                          <span>{meetingStatusLabel(session.status)}</span>
                        </span>
                        <span className="history-time muted mono-text">{formatCompactDateTime(session.startedAt)}</span>
                      </span>
                    </button>
                  )}
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
  onDownloadLocalModel: () => Promise<void>;
  onDeleteLocalModel: () => Promise<void>;
  onImportLocalModelDir: () => Promise<void>;
  onCompleteGuide: () => Promise<void>;
}) {
  const { providerDraft, preferenceDraft, environment } = props;
  const localAsrSelected = providerDraft.asr.providerId === "sensevoice-local";
  const localLlmSelected = providerDraft.llm.providerId === "ollama-local";

  return (
    <div className="stack">
      <section className="settings-hero">
        <p className="eyebrow">System Preferences</p>
        <h3>全局设置</h3>
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
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">ASR</p>
            <h4>转写服务</h4>
          </div>
          <div className="capture-mode-grid">
            <button
              className={providerDraft.asr.providerId === "gemini-openai-audio" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() =>
                props.onProviderChange({
                  ...providerDraft,
                  asr: { ...providerDraft.asr, providerId: "gemini-openai-audio", runtime: "cloud" }
                })
              }
            >
              Gemini 音频
            </button>
            <button
              className={providerDraft.asr.providerId === "openai-compatible-asr" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() =>
                props.onProviderChange({
                  ...providerDraft,
                  asr: { ...providerDraft.asr, providerId: "openai-compatible-asr", runtime: "cloud" }
                })
              }
            >
              OpenAI-compatible
            </button>
            <button
              className={localAsrSelected ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() =>
                props.onProviderChange({
                  ...providerDraft,
                  asr: {
                    ...providerDraft.asr,
                    providerId: "sensevoice-local",
                    runtime: "sherpa-onnx",
                    chunkMs: providerDraft.asr.chunkMs || 8000
                  }
                })
              }
            >
              本地 SenseVoice
            </button>
          </div>
          {localAsrSelected ? (
            <>
              <div className="guide-grid">
                <div className="guide-card">
                  <span className="guide-label">模型状态</span>
                  <strong className="mono-text">
                    {environment.localModelState}
                    {environment.localModelDownloadProgress !== null ? ` ${environment.localModelDownloadProgress}%` : ""}
                  </strong>
                </div>
                <div className="guide-card">
                  <span className="guide-label">运行时</span>
                  <strong className="mono-text">sherpa-onnx</strong>
                </div>
              </div>
              <label className="form-field">
                <span>识别语言</span>
                <select
                  value={providerDraft.asr.localLanguage}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        localLanguage: event.target.value as ProviderConfig["asr"]["localLanguage"]
                      }
                    })
                  }
                >
                  <option value="auto">自动</option>
                  <option value="zh">普通话</option>
                  <option value="yue">粤语</option>
                  <option value="en">英语</option>
                  <option value="ja">日语</option>
                  <option value="ko">韩语</option>
                </select>
              </label>
              <label className="form-field">
                <span>延迟策略</span>
                <select
                  value={providerDraft.asr.latencyMode}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        latencyMode: event.target.value as ProviderConfig["asr"]["latencyMode"]
                      }
                    })
                  }
                >
                  <option value="fast">快速</option>
                  <option value="balanced">平衡</option>
                  <option value="accurate">高精度</option>
                </select>
              </label>
              <label className="form-field">
                <span>兜底分段时长 (ms)</span>
                <input
                  type="number"
                  min={4000}
                  step={1000}
                  value={providerDraft.asr.chunkMs}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        chunkMs: Number(event.target.value) || 8000
                      }
                    })
                  }
                />
              </label>
              <div className="guide-grid">
                <div className="guide-card">
                  <span className="guide-label">VAD</span>
                  <strong>{providerDraft.asr.vadEnabled ? "已启用" : "已关闭"}</strong>
                </div>
                <div className="guide-card">
                  <span className="guide-label">重叠检测</span>
                  <strong>{providerDraft.asr.overlapDetectionEnabled ? "已启用" : "已关闭"}</strong>
                </div>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={providerDraft.asr.vadEnabled}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        vadEnabled: event.target.checked
                      }
                    })
                  }
                />
                <span>启用 VAD 驱动分段</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={providerDraft.asr.overlapDetectionEnabled}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        overlapDetectionEnabled: event.target.checked
                      }
                    })
                  }
                />
                <span>启用重叠发言检测</span>
              </label>
              <label className="form-field">
                <span>VAD 阈值</span>
                <input
                  type="number"
                  min={0.005}
                  max={0.08}
                  step={0.001}
                  value={providerDraft.asr.vadThreshold}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        vadThreshold: Number(event.target.value) || 0.014
                      }
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>尾部缓冲 (ms)</span>
                <input
                  type="number"
                  min={120}
                  step={60}
                  value={providerDraft.asr.vadPostRollMs}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        vadPostRollMs: Number(event.target.value) || 420
                      }
                    })
                  }
                />
              </label>
              <div className="guide-grid">
                <div className="guide-card">
                  <span className="guide-label">AEC</span>
                  <strong className="mono-text">{providerDraft.asr.aecMode}</strong>
                </div>
                <div className="guide-card">
                  <span className="guide-label">NS / AGC</span>
                  <strong className="mono-text">
                    {providerDraft.asr.noiseSuppressionMode} / {providerDraft.asr.autoGainMode}
                  </strong>
                </div>
              </div>
              <label className="form-field">
                <span>AEC 策略</span>
                <select
                  value={providerDraft.asr.aecMode}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        aecMode: event.target.value as ProviderConfig["asr"]["aecMode"]
                      }
                    })
                  }
                >
                  <option value="auto">自动</option>
                  <option value="on">强制开启</option>
                  <option value="off">关闭</option>
                </select>
              </label>
              <label className="form-field">
                <span>噪声抑制</span>
                <select
                  value={providerDraft.asr.noiseSuppressionMode}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        noiseSuppressionMode: event.target.value as ProviderConfig["asr"]["noiseSuppressionMode"]
                      }
                    })
                  }
                >
                  <option value="auto">自动</option>
                  <option value="on">开启</option>
                  <option value="off">关闭</option>
                </select>
              </label>
              <label className="form-field">
                <span>自动增益</span>
                <select
                  value={providerDraft.asr.autoGainMode}
                  onChange={(event) =>
                    props.onProviderChange({
                      ...providerDraft,
                      asr: {
                        ...providerDraft.asr,
                        autoGainMode: event.target.value as ProviderConfig["asr"]["autoGainMode"]
                      }
                    })
                  }
                >
                  <option value="auto">自动</option>
                  <option value="on">开启</option>
                  <option value="off">关闭</option>
                </select>
              </label>
              <p className="muted">说明：当前版本已实现本地噪声抑制、自动增益、VAD 与重叠检测；AEC 策略已预留接口，现阶段仍以告警和保守降级为主。</p>
              <p className="muted">模型路径：{environment.localModelStoragePath ?? "尚未下载"}</p>
              {environment.localModelErrorMessage ? <p className="error-text">模型错误：{environment.localModelErrorMessage}</p> : null}
              <div className="control-grid">
                <button
                  type="button"
                  disabled={environment.localModelState === "downloading"}
                  onClick={props.onDownloadLocalModel}
                >
                  {environment.localModelState === "ready"
                    ? "重新下载模型"
                    : environment.localModelState === "downloading"
                      ? "下载中..."
                      : "下载模型"}
                </button>
                <button
                  type="button"
                  disabled={environment.localModelState === "downloading" || environment.localModelState === "not-downloaded"}
                  onClick={props.onDeleteLocalModel}
                >
                  删除模型
                </button>
                <button
                  type="button"
                  disabled={environment.localModelState === "downloading"}
                  onClick={props.onImportLocalModelDir}
                >
                  导入模型目录
                </button>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">LLM</p>
            <h4>纪要模型</h4>
          </div>
          <div className="capture-mode-grid">
            <button
              className={providerDraft.llm.providerId === "gemini-openai-compatible" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() =>
                props.onProviderChange({
                  ...providerDraft,
                  llm: {
                    ...providerDraft.llm,
                    providerId: "gemini-openai-compatible",
                    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
                    model: providerDraft.llm.model === "qwen3.5:4b" ? "gemini-2.5-flash" : providerDraft.llm.model
                  }
                })
              }
            >
              Gemini
            </button>
            <button
              className={providerDraft.llm.providerId === "openai-compatible-llm" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() =>
                props.onProviderChange({
                  ...providerDraft,
                  llm: {
                    ...providerDraft.llm,
                    providerId: "openai-compatible-llm"
                  }
                })
              }
            >
              OpenAI-compatible
            </button>
            <button
              className={localLlmSelected ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() =>
                props.onProviderChange({
                  ...providerDraft,
                  llm: {
                    ...providerDraft.llm,
                    providerId: "ollama-local",
                    baseUrl: "http://127.0.0.1:11434",
                    apiKey: "ollama",
                    model: "qwen3.5:4b"
                  }
                })
              }
            >
              Ollama 本地
            </button>
          </div>
          <label className="form-field">
            <span>{localLlmSelected ? "Ollama 地址" : "Base URL"}</span>
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
          {!localLlmSelected ? (
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
          ) : null}
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
  meetingTerms: string[];
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
          <h4>实时字幕流</h4>
        </div>
        <span className="mono-text">{props.detail.transcriptSegments.length} 段</span>
      </div>
      {props.meetingTerms.length > 0 ? (
        <div className="term-strip">
          {props.meetingTerms.slice(0, 8).map((term) => (
            <span key={term} className="status-tag term-chip">
              {term}
            </span>
          ))}
        </div>
      ) : null}
      <div className="transcript-list">
        {props.detail.transcriptSegments.map((segment) => (
          <article
            key={segment.id}
            className={`transcript-item ${segment.kind} ${segment.quality === "low" ? "low-quality" : ""} ${
              segment.overlapDetected ? "overlap" : ""
            }`}
          >
            <span className="transcript-time mono-text">{segment.startMs}ms</span>
            <div>
              <div className="transcript-meta-row">
                <p>{segment.kind === "speech" ? highlightText(segment.text, props.meetingTerms) : segment.note || "此段没有可用正文。"}</p>
                <div className="tag-row">
                  <span className={`status-tag quality-${segment.quality}`}>{transcriptQualityLabel(segment.quality)}</span>
                  {segment.overlapDetected ? <span className="status-tag warning">重叠</span> : null}
                  {segment.audioIssues.map((issue) => (
                    <span key={issue} className="status-tag muted">
                      {audioIssueLabel(issue)}
                    </span>
                  ))}
                </div>
              </div>
              <small>
                类型：{segment.kind} | 电平：{Math.round(segment.inputLevel * 1000) / 1000} | 延迟：{segment.latencyMs} ms |
                处理：{segment.processingMs} ms | 去重：{segment.overlapChars}
              </small>
              {segment.note && segment.kind === "speech" ? <small>{segment.note}</small> : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function HighlightsPanel(props: {
  detail: MeetingDetail | null;
  compact?: boolean;
  meetingTerms: string[];
}) {
  if (!props.detail) {
    return (
      <div className={`detail-card highlight-card ${props.compact ? "compact" : ""} empty-state`}>
        <p className="eyebrow">Highlights</p>
        <h3>重点提醒</h3>
        <p>会中高置信度的决策、待办和风险会出现在这里。</p>
      </div>
    );
  }

  const groups = groupMeetingHighlights(props.detail);
  const flatItems = groups.flatMap((group) => group.items);

  return (
    <div className={`detail-card highlight-card ${props.compact ? "compact" : ""}`}>
      <div className="section-head">
        <div>
          <p className="eyebrow">Highlights</p>
          <h4>重点提醒</h4>
        </div>
        <span className="mono-text">{props.detail.highlights.length} 条</span>
      </div>
      {props.detail.highlights.length === 0 ? (
        <p className="muted">当前还没有满足保守阈值的提醒。系统只会在高置信度、非重叠片段上提示重点。</p>
      ) : (
        <>
          <div className="highlight-chip-row">
            {groups.map((group) => (
              <span key={group.kind} className={`status-tag accent subtle-${group.kind}`}>
                {highlightKindLabel(group.kind)} {group.items.length}
              </span>
            ))}
          </div>
          {props.compact ? (
            <div className="highlight-list">
              {flatItems.slice(0, 3).map((item) => (
                <article key={item.id} className={`highlight-item kind-${item.kind}`}>
                  <div className="highlight-item-head">
                    <span className="status-tag accent">{highlightKindLabel(item.kind)}</span>
                    <span className="highlight-time mono-text">{formatCueTime(item.startMs)}</span>
                  </div>
                  <p>{highlightText(item.text, props.meetingTerms)}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="highlight-groups">
              {groups.map((group) => (
                <section key={group.kind} className="highlight-group">
                  <div className="section-head">
                    <strong>{highlightKindLabel(group.kind)}</strong>
                    <span className="mono-text">{group.items.length}</span>
                  </div>
                  <div className="highlight-list">
                    {group.items.map((item) => (
                      <article key={item.id} className={`highlight-item kind-${item.kind}`}>
                        <div className="highlight-item-head">
                          <span className="highlight-time mono-text">{formatCueTime(item.startMs)}</span>
                        </div>
                        <p>{highlightText(item.text, props.meetingTerms)}</p>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryPanel(props: {
  detail: MeetingDetail | null;
  recording: RecordingSnapshot;
  meetingTerms: string[];
  qaInput: string;
  asking: boolean;
  onQaInputChange: (value: string) => void;
  onAskQuestion: () => Promise<void>;
  onGenerateSummary: () => Promise<void>;
}) {
  const summaryStatus = props.detail?.session.summaryStatus ?? "none";
  const stale = summaryNeedsRefresh(props.detail);
  const statusNode =
    summaryStatus === "error" ? (
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
          <button
            className={
              summaryStatus === "generating"
                ? "secondary-button summary-generate-button summary-generate-button-loading"
                : "primary-button summary-generate-button"
            }
            disabled={
              !props.detail ||
              props.detail.session.summaryStatus === "generating" ||
              props.detail.transcriptSegments.every((segment) => segment.kind !== "speech")
            }
            type="button"
            onClick={props.onGenerateSummary}
            aria-label={summaryStatus === "generating" ? "纪要生成中" : stale ? "重新生成纪要" : "生成纪要"}
          >
            {summaryStatus === "generating" ? <LoadingDots label="纪要生成中" /> : "生成"}
          </button>
        </div>
        {statusNode}
      </div>
      <div className="result-body">
        {!props.detail ? (
          <p>先从左侧选择一场会议。</p>
        ) : props.detail.session.summaryStatus === "generating" ? (
          <p>AI 正在根据全文整理纪要，请稍候。</p>
        ) : props.detail.summary ? (
          <>
            {props.meetingTerms.length > 0 ? (
              <div className="term-strip subtle">
                {props.meetingTerms.slice(0, 6).map((term) => (
                  <span key={term} className="status-tag term-chip">
                    {term}
                  </span>
                ))}
              </div>
            ) : null}
            <p>{highlightText(props.detail.summary.overview, props.meetingTerms)}</p>
            <p className="muted">
              该纪要基于第 {props.detail.summary.sourceSegmentSeq} 段生成，
              {props.detail.summary.generatedWhileStatus === "completed" ? "生成时会议已结束。" : "生成时会议仍在进行或暂停中。"}
            </p>
            {stale ? <p className="warning-text">会议又新增了转写内容，当前纪要不是最新版本，可以手动重新生成。</p> : null}
            <strong>关键结论</strong>
            <ul>
              {props.detail.summary.bulletPoints.map((item) => (
                <li key={item}>{highlightText(item, props.meetingTerms)}</li>
              ))}
            </ul>
            <strong>待办事项</strong>
            <ul>
              {props.detail.summary.actionItems.map((item) => (
                <li key={item}>{highlightText(item, props.meetingTerms)}</li>
              ))}
            </ul>
            {props.detail.summary.risks.length > 0 ? (
              <>
                <strong>风险与待确认</strong>
                <ul>
                  {props.detail.summary.risks.map((item) => (
                    <li key={item}>{highlightText(item, props.meetingTerms)}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="qa-section">
              <div className="section-head">
                <strong>会议问答</strong>
                <span className="mono-text">{props.detail.qaItems.length} 条</span>
              </div>
              <div className="qa-list">
                {props.detail.qaItems.map((item) => (
                  <article key={item.id} className="qa-item">
                    <p className="qa-question">问：{highlightText(item.question, props.meetingTerms)}</p>
                    <p className="qa-answer">答：{highlightText(item.answer, props.meetingTerms)}</p>
                  </article>
                ))}
              </div>
              <div className="qa-compose">
                <textarea
                  placeholder="继续追问这场会议，例如：老师提出的具体要求是什么？"
                  value={props.qaInput}
                  onChange={(event) => props.onQaInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void props.onAskQuestion();
                    }
                  }}
                  rows={3}
                />
              </div>
            </div>
          </>
        ) : (
          <p>还没有纪要。有转写后即可生成，会议进行中也可以手动刷新。生成完成后，你也可以继续对会议内容发起多轮提问。</p>
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
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
  onExport: (format: "markdown" | "txt") => Promise<void>;
}) {
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
        </div>

        <div className="control-grid">
          <button className="danger-ghost" disabled={!canFinish} type="button" onClick={props.onStop}>
            结束会议
          </button>
          <button
            disabled={!canResume && !canPause}
            type="button"
            onClick={canPause ? props.onPause : props.onResume}
          >
            {canPause ? "暂停" : "继续"}
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
