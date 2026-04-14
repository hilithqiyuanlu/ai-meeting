import { useEffect, useMemo, useState } from "react";
import type {
  AppPreferences,
  BootstrapState,
  CustomTermEntry,
  EnvironmentStatus,
  LocalAsrStatus,
  MeetingDetail,
  MeetingSession,
  ProviderConfig,
  RecordingSnapshot,
  StructuredActionItem,
  UiLanguage
} from "@shared/types";
import { detectMeetingTerms, highlightText } from "./meeting-display";

type TabId = "capture" | "settings";

const copy = {
  "zh-CN": {
    loading: "正在加载工作台...",
    startupFailed: "启动失败",
    appFailed: "应用没有正确加载",
    restartHint: "请重启应用，如果仍然失败，把终端错误发给我。",
    workspace: "设置中心",
    searchPlaceholder: "搜索会议（即将支持）",
    realtimeRecord: "实时记录",
    waiting: "待命",
    settings: "系统设置",
    settingsTitle: "全局设置",
    language: "界面语言",
    languageZh: "中文",
    languageEn: "English",
    capture: "采集模式",
    microphoneMode: "麦克风模式",
    systemAudioMode: "系统音频模式",
    asr: "转写服务",
    localSenseVoice: "本地 SenseVoice",
    llm: "纪要模型",
    localOllama: "Ollama 本地",
    general: "通用",
    workspacePrefs: "本地偏好与权限",
    skipGuide: "跳过首次引导",
    exportPlaceholders: "导出 TXT 时保留静音/失败占位提示",
    requestMic: "请求麦克风权限",
    refreshDevices: "重新扫描设备",
    saveSettings: "保存设置",
    saving: "保存中...",
    finishGuide: "引导完成，返回工作台",
    transcript: "实时字幕流",
    summary: "会议纪要",
    controls: "录制控制",
    askPlaceholder: "继续追问这场会议，例如：老师提出的具体要求是什么？",
    ask: "提问",
    generating: "纪要生成中",
    generate: "生成",
    regenerate: "重新生成纪要",
    noSummary: "还没有纪要。有转写后即可生成，会议进行中也可以手动刷新。生成完成后，你也可以继续对会议内容发起多轮提问。",
    selectMeeting: "先从左侧选择一场会议。",
    chooseMeeting: "选择一场会议",
    transcriptEmpty: "中间区域会展示当前会议的转写全文与片段状态。",
    processingSummary: "AI 正在根据全文整理纪要，请稍候。",
    qa: "会议问答",
    keyPoints: "决策",
    actionItems: "行动项",
    risks: "问题",
    history: "历史会议",
    noHistory: "暂无会议记录",
    startMeetingHint: "开始一场新会议后，记录会出现在这里。",
    systemPreferences: "设置中心",
    runtime: "运行状态",
    systemStatus: "System Status",
    low: "低",
    medium: "中",
    high: "高",
    capturing: "检测到有效音频",
    nearSilence: "当前接近静音",
    noSignal: "设备存在但没有声音",
    deviceError: "设备或采集异常",
    waitingAudio: "等待开始录音",
    fast: "快速",
    balanced: "平衡",
    accurate: "高精度",
    readyNew: "准备开始新会议",
    starting: "正在启动录制",
    recording: "录制进行中",
    paused: "会议已暂停",
    stopping: "正在停止采集",
    processing: "正在整理最后几段",
    error: "录制异常",
    completed: "已完成",
    idle: "待命",
    startNewMeeting: "开始新会议",
    stopMeeting: "结束会议",
    pause: "暂停",
    resume: "继续",
    exportMd: "导出 MD",
    exportTxt: "导出 TXT",
    exportFailed: "导出失败",
    startSuccess: "录制已启动",
    pauseSuccess: "会议已暂停",
    resumeSuccess: "会议已继续录制",
    summaryFailed: "生成 AI 纪要失败",
    qaFailed: "会议问答失败",
    deleteSuccess: "会议记录已删除",
    modelDownloadFailed: "模型下载失败",
    modelDeleteFailed: "删除模型失败",
    modelImportFailed: "导入模型失败",
    enabled: "已启用",
    disabled: "已关闭",
    partialFallback: "等待稳定语音输入...",
    highlightDecision: "决策",
    highlightAction: "待办",
    highlightRisk: "风险",
    highlightFollowUp: "待确认",
    modelState: "模型状态",
    runtimeLabel: "运行时",
    recognitionLanguage: "识别语言",
    latencyStrategy: "延迟策略",
    chunkFallback: "兜底分段时长 (ms)",
    vad: "VAD",
    overlapDetection: "重叠检测",
    enableVad: "启用 VAD 驱动分段",
    enableOverlapDetection: "启用重叠发言检测",
    vadThreshold: "VAD 阈值",
    tailBuffer: "尾部缓冲 (ms)",
    aecStrategy: "AEC 策略",
    noiseSuppression: "噪声抑制",
    autoGain: "自动增益",
    auto: "自动",
    on: "开启",
    off: "关闭",
    forceOn: "强制开启",
    modelPath: "模型路径",
    modelError: "模型错误",
    downloadModel: "下载模型",
    redownloadModel: "重新下载模型",
    downloadingModel: "下载中...",
    deleteModel: "删除模型",
    importModelDir: "导入模型目录",
    endpoint: "Endpoint",
    apiKey: "API Key",
    model: "Model",
    microphonePermission: "权限状态",
    blackhole: "BlackHole",
    detected: "已检测到",
    notDetected: "未检测到",
    deleteMeeting: "删除会议记录",
    deleteTitle: "确认删除这条会议记录？",
    deleteTime: "会议时间：",
    deleteDesc: "删除后将同时移除全文转写、AI 纪要与问答记录，此操作不可撤销。",
    cancel: "取消",
    confirmDelete: "确认删除",
    deleting: "删除中...",
    justNow: "刚刚",
    secondsAgo: "秒前",
    minutesAgo: "分钟前",
    none: "暂无",
    speechType: "类型",
    level: "电平",
    latency: "延迟",
    processingMs: "处理",
    dedupe: "去重",
    questionPrefix: "问：",
    answerPrefix: "答：",
    noBody: "此段没有可用正文。",
    close: "关闭",
    noMeaningfulBody: "此段没有可用正文。",
    itemUnit: "条",
    segmentUnit: "段",
    settingsSaved: "设置已保存",
    stoppedSuccess: "录制已停止",
    summarySuccess: "AI 纪要已生成",
    exportedTo: "已导出到",
    startFailed: "开始录制失败",
    stopFailed: "停止录制失败",
    pauseFailed: "暂停失败",
    resumeFailed: "继续录制失败",
    deleteFailed: "删除失败",
    renameFailed: "重命名失败",
    noMicrophoneDevice: "没有可用麦克风设备。",
    noSystemAudioDevice: "没有可用系统音频输入设备。",
    micGranted: "麦克风权限已授权",
    micDenied: "麦克风权限未授权",
    statusLabel: "状态",
    inputStatusLabel: "输入状态",
    realtimeLatency: "实时延迟",
    inputQuality: "输入质量",
    lastAudio: "最近有声",
    lastTranscript: "最近转写成功",
    riskSegments: "风险片段",
    liveLevel: "实时电平",
    lowQualityShort: "低质",
    failedShort: "失败",
    recentOverlap: "最近检测到重叠发言",
    recentError: "最近错误",
    consecutiveFailures: "连续失败段数",
    consecutiveLowQuality: "连续低质量片段",
    generatedFromSegment: "该纪要基于第 {seq} 段生成，{status}",
    generatedWhenCompleted: "生成时会议已结束。",
    generatedWhenLive: "生成时会议仍在进行或暂停中。",
    staleSummary: "会议又新增了转写内容，当前纪要不是最新版本，可以手动重新生成。",
    processingMoreComplete: "会议正在整理最后几段，完成后再生成纪要会更完整。",
    saveRenameHint: "回车保存，Esc 取消",
    permissionGranted: "已授权",
    permissionDenied: "未授权",
    permissionRestricted: "受限制",
    permissionNotDetermined: "未确定",
    permissionUnknown: "未知",
    modelStateNotDownloaded: "未下载",
    modelStateDownloading: "下载中",
    modelStateReady: "已就绪",
    modelStateError: "异常",
    languageAuto: "自动",
    languageMandarin: "普通话",
    languageCantonese: "粤语",
    languageEnglish: "英语",
    languageJapanese: "日语",
    languageKorean: "韩语",
    qaUpdated: "会议问答已更新",
    modelDownloaded: "SenseVoice 模型已下载",
    modelDeleted: "SenseVoice 模型已删除",
    modelImported: "SenseVoice 模型已导入",
    importCanceled: "已取消导入",
    meetingTitleUpdated: "会议名称已更新",
    systemAudioPrefix: "系统音频",
    bridgeMissing: "应用桥接接口未加载，请重启应用。",
    overlapDetected: "重叠发言",
    issueEcho: "回声",
    issueNoise: "噪声",
    issueLowLevel: "音量低",
    issueClipping: "过载",
    audioBackend: "前处理后端",
    processingStatus: "前处理状态",
    backendHeuristic: "启发式 APM",
    backendNone: "未启用",
    processingActive: "前处理已启用",
    processingInactive: "前处理未启用",
    rawInputLevel: "原始电平",
    processedInputLevel: "处理后电平",
    vadTriggers: "VAD 触发",
    skippedSilence: "静音跳过",
    totalLowQualitySegments: "低质量累计",
    stitchSuppressed: "去重压制",
    processingNote: "当前仅实现启发式音频前处理，不包含系统级 voice processing。",
    preferredBackend: "推荐后端",
    termLibrary: "术语/热词库",
    enableCustomTerms: "启用自定义术语库",
    termLibraryNote: "术语标准化会同时使用内置词库和你启用的自定义词条；别名每行一个。",
    termCanonical: "标准写法",
    termAliases: "别名",
    termAliasesHint: "每行一个别名，例如：AIMeeting",
    addTerm: "新增词条",
    removeTerm: "删除词条",
    noCustomTerms: "还没有自定义词条。",
    termEntryEnabled: "启用此词条",
    actionOwner: "负责人",
    actionDue: "截止时间",
    actionOwnerUnknown: "未明确",
    actionDueUnknown: "未明确",
    noDecisions: "暂无明确决策。",
    noIssues: "暂无待确认问题。"
  },
  "en-US": {
    loading: "Loading workspace...",
    startupFailed: "Startup failed",
    appFailed: "The app did not load correctly",
    restartHint: "Restart the app. If it still fails, share the terminal error.",
    workspace: "Settings",
    searchPlaceholder: "Search meetings (coming soon)",
    realtimeRecord: "Realtime Record",
    waiting: "Standby",
    settings: "Settings",
    settingsTitle: "General",
    language: "UI Language",
    languageZh: "Chinese",
    languageEn: "English",
    capture: "Capture Mode",
    microphoneMode: "Microphone",
    systemAudioMode: "System Audio",
    asr: "Transcription",
    localSenseVoice: "Local SenseVoice",
    llm: "Summary Model",
    localOllama: "Local Ollama",
    general: "General",
    workspacePrefs: "Local Preferences & Permissions",
    skipGuide: "Skip onboarding",
    exportPlaceholders: "Keep silence/error placeholders in TXT export",
    requestMic: "Request microphone access",
    refreshDevices: "Rescan devices",
    saveSettings: "Save settings",
    saving: "Saving...",
    finishGuide: "Finish onboarding",
    transcript: "Realtime Transcript",
    summary: "Meeting Summary",
    controls: "Recording Controls",
    askPlaceholder: "Ask a follow-up question about this meeting...",
    ask: "Send",
    generating: "Generating summary",
    generate: "Generate",
    regenerate: "Regenerate",
    noSummary: "No summary yet. Generate one after transcription becomes available.",
    selectMeeting: "Choose a meeting from the left.",
    chooseMeeting: "Choose a meeting",
    transcriptEmpty: "The center area shows transcript segments and status.",
    processingSummary: "AI is organizing the full transcript, please wait.",
    qa: "Meeting Q&A",
    keyPoints: "Decisions",
    actionItems: "Action Items",
    risks: "Issues",
    history: "History",
    noHistory: "No meetings yet",
    startMeetingHint: "Your meetings will appear here after you start one.",
    systemPreferences: "Settings",
    runtime: "Runtime Status",
    systemStatus: "System Status",
    low: "Low",
    medium: "Medium",
    high: "High",
    capturing: "Capturing audio",
    nearSilence: "Near silence",
    noSignal: "No signal",
    deviceError: "Device error",
    waitingAudio: "Waiting to start",
    fast: "Fast",
    balanced: "Balanced",
    accurate: "Accurate",
    readyNew: "Ready for a new meeting",
    starting: "Starting",
    recording: "Recording",
    paused: "Paused",
    stopping: "Stopping",
    processing: "Finalizing",
    error: "Error",
    completed: "Completed",
    idle: "Idle",
    startNewMeeting: "Start Meeting",
    stopMeeting: "Stop Meeting",
    pause: "Pause",
    resume: "Resume",
    exportMd: "Export MD",
    exportTxt: "Export TXT",
    exportFailed: "Export failed",
    startSuccess: "Recording started",
    pauseSuccess: "Meeting paused",
    resumeSuccess: "Meeting resumed",
    summaryFailed: "Summary generation failed",
    qaFailed: "Q&A failed",
    deleteSuccess: "Meeting deleted",
    modelDownloadFailed: "Model download failed",
    modelDeleteFailed: "Model deletion failed",
    modelImportFailed: "Model import failed",
    enabled: "Enabled",
    disabled: "Disabled",
    partialFallback: "Waiting for stable speech...",
    highlightDecision: "Decision",
    highlightAction: "Action",
    highlightRisk: "Risk",
    highlightFollowUp: "Follow-up",
    modelState: "Model State",
    runtimeLabel: "Runtime",
    recognitionLanguage: "Recognition Language",
    latencyStrategy: "Latency Strategy",
    chunkFallback: "Fallback Chunk (ms)",
    vad: "VAD",
    overlapDetection: "Overlap Detection",
    enableVad: "Enable VAD-driven segmentation",
    enableOverlapDetection: "Enable overlap detection",
    vadThreshold: "VAD Threshold",
    tailBuffer: "Tail Buffer (ms)",
    aecStrategy: "AEC Strategy",
    noiseSuppression: "Noise Suppression",
    autoGain: "Auto Gain",
    auto: "Auto",
    on: "On",
    off: "Off",
    forceOn: "Force On",
    modelPath: "Model Path",
    modelError: "Model Error",
    downloadModel: "Download Model",
    redownloadModel: "Redownload Model",
    downloadingModel: "Downloading...",
    deleteModel: "Delete Model",
    importModelDir: "Import Model Folder",
    endpoint: "Endpoint",
    apiKey: "API Key",
    model: "Model",
    microphonePermission: "Permission",
    blackhole: "BlackHole",
    detected: "Detected",
    notDetected: "Not detected",
    deleteMeeting: "Delete Meeting",
    deleteTitle: "Delete this meeting?",
    deleteTime: "Meeting time:",
    deleteDesc: "This deletes the transcript, AI summary and Q&A history.",
    cancel: "Cancel",
    confirmDelete: "Delete",
    deleting: "Deleting...",
    justNow: "Just now",
    secondsAgo: "s ago",
    minutesAgo: "m ago",
    none: "None",
    speechType: "Type",
    level: "Level",
    latency: "Latency",
    processingMs: "Processing",
    dedupe: "Dedupe",
    questionPrefix: "Q:",
    answerPrefix: "A:",
    noBody: "No usable text for this segment.",
    close: "Close",
    noMeaningfulBody: "No usable text for this segment.",
    itemUnit: "items",
    segmentUnit: "segments",
    settingsSaved: "Settings saved",
    stoppedSuccess: "Recording stopped",
    summarySuccess: "AI summary generated",
    exportedTo: "Exported to",
    startFailed: "Failed to start recording",
    stopFailed: "Failed to stop recording",
    pauseFailed: "Pause failed",
    resumeFailed: "Resume failed",
    deleteFailed: "Delete failed",
    renameFailed: "Rename failed",
    noMicrophoneDevice: "No microphone device available.",
    noSystemAudioDevice: "No system audio input available.",
    micGranted: "Microphone access granted",
    micDenied: "Microphone access denied",
    statusLabel: "Status",
    inputStatusLabel: "Input Status",
    realtimeLatency: "Realtime Latency",
    inputQuality: "Input Quality",
    lastAudio: "Last Audio",
    lastTranscript: "Last Transcript",
    riskSegments: "Risk Segments",
    liveLevel: "Live Level",
    lowQualityShort: "Low quality",
    failedShort: "Failed",
    recentOverlap: "Recent overlap detected",
    recentError: "Recent error",
    consecutiveFailures: "Consecutive failures",
    consecutiveLowQuality: "Consecutive low-quality segments",
    generatedFromSegment: "Generated from segment {seq}. {status}",
    generatedWhenCompleted: "The meeting had ended when this was generated.",
    generatedWhenLive: "The meeting was still live or paused when this was generated.",
    staleSummary: "New transcript content was added after this summary. Regenerate to refresh it.",
    processingMoreComplete: "The meeting is finalizing the last segments. Generate again after it completes for a fuller summary.",
    saveRenameHint: "Enter to save, Esc to cancel",
    permissionGranted: "Granted",
    permissionDenied: "Denied",
    permissionRestricted: "Restricted",
    permissionNotDetermined: "Not determined",
    permissionUnknown: "Unknown",
    modelStateNotDownloaded: "Not downloaded",
    modelStateDownloading: "Downloading",
    modelStateReady: "Ready",
    modelStateError: "Error",
    languageAuto: "Auto",
    languageMandarin: "Mandarin",
    languageCantonese: "Cantonese",
    languageEnglish: "English",
    languageJapanese: "Japanese",
    languageKorean: "Korean",
    qaUpdated: "Meeting Q&A updated",
    modelDownloaded: "SenseVoice model downloaded",
    modelDeleted: "SenseVoice model deleted",
    modelImported: "SenseVoice model imported",
    importCanceled: "Import canceled",
    meetingTitleUpdated: "Meeting title updated",
    systemAudioPrefix: "System Audio",
    bridgeMissing: "The app bridge did not load. Restart the app.",
    overlapDetected: "Overlap",
    issueEcho: "Echo",
    issueNoise: "Noise",
    issueLowLevel: "Low level",
    issueClipping: "Clipping",
    audioBackend: "Processing Backend",
    processingStatus: "Processing Status",
    backendHeuristic: "Heuristic APM",
    backendNone: "Disabled",
    processingActive: "Processing active",
    processingInactive: "Processing inactive",
    rawInputLevel: "Raw Input",
    processedInputLevel: "Processed Input",
    vadTriggers: "VAD Triggers",
    skippedSilence: "Silence Skips",
    totalLowQualitySegments: "Low-quality Total",
    stitchSuppressed: "Dedupe Suppressed",
    processingNote: "Only heuristic audio preprocessing is implemented in v0.4.4. System voice processing is not wired in.",
    preferredBackend: "Preferred Backend",
    termLibrary: "Term Library",
    enableCustomTerms: "Enable custom term library",
    termLibraryNote: "Normalization uses built-in terms plus enabled custom entries. Put one alias per line.",
    termCanonical: "Canonical",
    termAliases: "Aliases",
    termAliasesHint: "One alias per line, for example: AIMeeting",
    addTerm: "Add Term",
    removeTerm: "Remove",
    noCustomTerms: "No custom terms yet.",
    termEntryEnabled: "Enable this term",
    actionOwner: "Owner",
    actionDue: "Due",
    actionOwnerUnknown: "Unspecified",
    actionDueUnknown: "Unspecified",
    noDecisions: "No confirmed decisions yet.",
    noIssues: "No open issues yet."
  }
} as const;

function t(language: UiLanguage, key: keyof typeof copy["zh-CN"]): string {
  return copy[language][key];
}

function countLabel(count: number, unit: "itemUnit" | "segmentUnit", language: UiLanguage): string {
  return `${count} ${t(language, unit)}`;
}

function localizedNotice(language: UiLanguage, key: keyof typeof copy["zh-CN"], detail?: string): string {
  return detail ? `${t(language, key)}: ${detail}` : t(language, key);
}

function permissionLabel(value: EnvironmentStatus["microphonePermission"], language: UiLanguage): string {
  switch (value) {
    case "granted":
      return t(language, "permissionGranted");
    case "denied":
      return t(language, "permissionDenied");
    case "restricted":
      return t(language, "permissionRestricted");
    case "not-determined":
      return t(language, "permissionNotDetermined");
    default:
      return t(language, "permissionUnknown");
  }
}

function modelStateLabel(value: EnvironmentStatus["localModelState"], language: UiLanguage): string {
  switch (value) {
    case "not-downloaded":
      return t(language, "modelStateNotDownloaded");
    case "downloading":
      return t(language, "modelStateDownloading");
    case "ready":
      return t(language, "modelStateReady");
    case "error":
      return t(language, "modelStateError");
    default:
      return value;
  }
}

function formatCompactDateTime(value: string | null, language: UiLanguage = "zh-CN"): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(language, {
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

function formatRelativeStatus(value: string | null, language: UiLanguage): string {
  if (!value) {
    return t(language, "none");
  }

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (deltaSeconds < 5) {
    return t(language, "justNow");
  }
  if (deltaSeconds < 60) {
    return `${deltaSeconds} ${t(language, "secondsAgo")}`;
  }
  return `${Math.floor(deltaSeconds / 60)} ${t(language, "minutesAgo")}`;
}

function audioStateLabel(state: RecordingSnapshot["audioState"], language: UiLanguage): string {
  switch (state) {
    case "capturing":
      return t(language, "capturing");
    case "near-silence":
      return t(language, "nearSilence");
    case "no-signal":
      return t(language, "noSignal");
    case "device-error":
      return t(language, "deviceError");
    default:
      return t(language, "waitingAudio");
  }
}

function audioLevelPercent(level: number): number {
  return Math.max(2, Math.min(100, Math.round(level * 900)));
}

function latencyModeLabel(mode: ProviderConfig["asr"]["latencyMode"], language: UiLanguage): string {
  switch (mode) {
    case "fast":
      return t(language, "fast");
    case "accurate":
      return t(language, "accurate");
    default:
      return t(language, "balanced");
  }
}

function transcriptQualityLabel(quality: RecordingSnapshot["inputQuality"], language: UiLanguage): string {
  switch (quality) {
    case "high":
      return t(language, "high");
    case "medium":
      return t(language, "medium");
    default:
      return t(language, "low");
  }
}

function audioIssueLabel(issue: MeetingDetail["transcriptSegments"][number]["audioIssues"][number], language: UiLanguage): string {
  switch (issue) {
    case "echo":
      return t(language, "issueEcho");
    case "noise":
      return t(language, "issueNoise");
    case "low-level":
      return t(language, "issueLowLevel");
    case "clipping":
      return t(language, "issueClipping");
    default:
      return issue;
  }
}

function customTermAliasesText(entry: CustomTermEntry): string {
  return entry.aliases.join("\n");
}

function createCustomTermEntry(): CustomTermEntry {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `custom-term-${Date.now()}`,
    canonical: "",
    aliases: [],
    enabled: true
  };
}

function formatActionItemMeta(item: StructuredActionItem, language: UiLanguage): string {
  return [
    `${t(language, "actionOwner")}: ${item.owner ?? t(language, "actionOwnerUnknown")}`,
    `${t(language, "actionDue")}: ${item.due ?? t(language, "actionDueUnknown")}`
  ].join(" · ");
}

function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) {
    return "--";
  }
  return `${latencyMs} ms`;
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

function recordingStatusLabel(recording: RecordingSnapshot, language: UiLanguage): string {
  switch (recording.status) {
    case "starting":
      return t(language, "starting");
    case "recording":
      return t(language, "recording");
    case "paused":
      return t(language, "paused");
    case "stopping":
      return t(language, "stopping");
    case "processing":
      return t(language, "processing");
    case "error":
      return t(language, "error");
    default:
      return t(language, "readyNew");
  }
}

function meetingStatusLabel(status: MeetingSession["status"], language: UiLanguage): string {
  switch (status) {
    case "recording":
      return t(language, "recording");
    case "paused":
      return t(language, "paused");
    case "processing":
      return t(language, "processing");
    case "completed":
      return t(language, "completed");
    case "failed":
      return t(language, "error");
    default:
      return t(language, "idle");
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

function buildDefaultMeetingTitle(
  startedAt: Date,
  captureMode: AppPreferences["captureMode"],
  language: UiLanguage
): string {
  const base = formatCompactDateTime(startedAt.toISOString(), language);
  return captureMode === "microphone" ? base : `${t(language, "systemAudioPrefix")} ${base}`;
}

function meetingListTitle(session: MeetingSession, language: UiLanguage): string {
  return isLegacyAutoMeetingTitle(session.title)
    ? formatCompactDateTime(session.startedAt, language)
    : session.title.trim() || formatCompactDateTime(session.startedAt, language);
}

function meetingDisplayTitle(session: MeetingSession | null, language: UiLanguage): string {
  if (!session) {
    return t(language, "realtimeRecord");
  }

  return meetingListTitle(session, language);
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
    <span className="loading-dots" role="status" aria-live="polite" aria-label={props.label ?? "Loading"}>
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
          throw new Error(t("zh-CN", "bridgeMissing"));
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
  const meetingTerms = useMemo(() => {
    if (!preferenceDraft) {
      return [];
    }
    return detectMeetingTerms(detail, preferenceDraft);
  }, [detail, preferenceDraft]);
  const uiLanguage = preferenceDraft?.uiLanguage ?? "zh-CN";

  if (loading) {
    return <div className="screen-center">{t(uiLanguage, "loading")}</div>;
  }

  if (!bootstrap || !providerDraft || !preferenceDraft) {
    return (
      <div className="screen-center error-screen">
        <div>
          <h1>{t(uiLanguage, "appFailed")}</h1>
          <p>{notice || t(uiLanguage, "restartHint")}</p>
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
    setNotice(granted ? t(uiLanguage, "micGranted") : t(uiLanguage, "micDenied"));
    await refreshEnvironment();
  }

  async function startMeeting(): Promise<void> {
    try {
      const device = getPreferredDevice(state.environment, prefsDraft, prefsDraft.captureMode);
      if (!device) {
        setNotice(prefsDraft.captureMode === "microphone" ? t(uiLanguage, "noMicrophoneDevice") : t(uiLanguage, "noSystemAudioDevice"));
        return;
      }

      const title = buildDefaultMeetingTitle(new Date(), prefsDraft.captureMode, uiLanguage);
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
      setNotice(t(uiLanguage, "startSuccess"));
    } catch (error) {
      setNotice(localizedNotice(uiLanguage, "startFailed", toMessage(error)));
    }
  }

  async function stopMeeting(): Promise<void> {
    try {
      await window.appApi.stopMeeting();
      setNotice(t(uiLanguage, "stoppedSuccess"));
    } catch (error) {
      setNotice(localizedNotice(uiLanguage, "stopFailed", toMessage(error)));
    }
  }

  async function saveSettings(): Promise<void> {
    setSaving(true);
    try {
      const config = await window.appApi.saveProviderConfig(configDraft);
      const preferences = await window.appApi.savePreferences(prefsDraft);
      setBootstrap((current) => (current ? { ...current, config, preferences } : current));
      setNotice(t(uiLanguage, "settingsSaved"));
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
      setNotice(t(uiLanguage, "summarySuccess"));
    } catch (error) {
      setNotice(localizedNotice(uiLanguage, "summaryFailed", toMessage(error)));
    }
  }

  async function exportSession(format: "markdown" | "txt"): Promise<void> {
    if (!selectedSessionId) {
      return;
    }
    try {
      const filePath = await window.appApi.exportMeeting(selectedSessionId, format);
      setNotice(`${t(uiLanguage, "exportedTo")} ${filePath}`);
    } catch (error) {
      setNotice(localizedNotice(uiLanguage, "exportFailed", toMessage(error)));
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
      setNotice(t(uiLanguage, "deleteSuccess"));
    } catch (error) {
      setNotice(localizedNotice(uiLanguage, "deleteFailed", toMessage(error)));
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
      setNotice(t(uiLanguage, "qaUpdated"));
    } catch (error) {
      setNotice(localizedNotice(uiLanguage, "qaFailed", toMessage(error)));
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
      setNotice(t(uiLanguage, "modelDownloaded"));
    } catch (error) {
      setNotice(localizedNotice(uiLanguage, "modelDownloadFailed", toMessage(error)));
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
      setNotice(t(uiLanguage, "modelDeleted"));
    } catch (error) {
      setNotice(localizedNotice(uiLanguage, "modelDeleteFailed", toMessage(error)));
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
      setNotice(state.state === "ready" ? t(uiLanguage, "modelImported") : t(uiLanguage, "importCanceled"));
    } catch (error) {
      setNotice(localizedNotice(uiLanguage, "modelImportFailed", toMessage(error)));
    }
  }

  function beginRenameSession(session: MeetingSession): void {
    setEditingSessionId(session.id);
    setEditingSessionTitle(meetingListTitle(session, uiLanguage));
    setNotice("");
  }

  async function commitRenameSession(session: MeetingSession): Promise<void> {
    if (renamingSessionId === session.id) {
      return;
    }

    const fallbackTitle = buildDefaultMeetingTitle(new Date(session.startedAt), session.captureMode, uiLanguage);
    const nextTitle = editingSessionTitle.trim() || fallbackTitle;
    setRenamingSessionId(session.id);
    try {
      const next = await window.appApi.renameMeeting(session.id, nextTitle);
      if (selectedSessionId === session.id) {
        setDetail(next);
      }
      setEditingSessionId(null);
      setEditingSessionTitle("");
    setNotice(t(uiLanguage, "meetingTitleUpdated"));
  } catch (error) {
      setNotice(localizedNotice(uiLanguage, "renameFailed", toMessage(error)));
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
            <div className="sidebar-search-shell">
              <input
                aria-label={t(uiLanguage, "searchPlaceholder")}
                className="sidebar-search"
                disabled
                placeholder={t(uiLanguage, "searchPlaceholder")}
                type="search"
              />
            </div>

            <HistoryPanel
              language={uiLanguage}
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
                <span className="sidebar-settings-label">{t(uiLanguage, "settings")}</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="workspace">
          <header className="workspace-header">
            <div className="workspace-heading">
              <h2>{activeTab === "settings" ? t(uiLanguage, "systemPreferences") : meetingDisplayTitle(currentSession, uiLanguage)}</h2>
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
                    language={uiLanguage}
                  />
                  <TranscriptPanel detail={detail} meetingTerms={meetingTerms} language={uiLanguage} />
                </>
              ) : (
                <SettingsPanel
                  environment={state.environment}
                  providerDraft={configDraft}
                  preferenceDraft={prefsDraft}
                  language={uiLanguage}
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
                language={uiLanguage}
                onPause={async () => {
                  try {
                    await window.appApi.pauseMeeting();
                    setNotice(t(uiLanguage, "pauseSuccess"));
                  } catch (error) {
                    setNotice(localizedNotice(uiLanguage, "pauseFailed", toMessage(error)));
                  }
                }}
                onResume={async () => {
                  try {
                    const targetSessionId = currentSession?.status === "paused" ? currentSession.id : undefined;
                    await window.appApi.resumeMeeting(targetSessionId);
                    setNotice(t(uiLanguage, "resumeSuccess"));
                  } catch (error) {
                    setNotice(localizedNotice(uiLanguage, "resumeFailed", toMessage(error)));
                  }
                }}
                onStop={stopMeeting}
                onExport={exportSession}
              />
              <SummaryPanel
                detail={detail}
                recording={state.recording}
                meetingTerms={meetingTerms}
                language={uiLanguage}
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
          language={uiLanguage}
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
  language: UiLanguage;
}) {
  const [statusExpanded, setStatusExpanded] = useState(false);
  const summaryItems = [
    {
      label: t(props.language, "latency"),
      value: formatLatency(props.recording.currentLatencyMs)
    },
    {
      label: t(props.language, "inputQuality"),
      value: transcriptQualityLabel(props.recording.inputQuality, props.language)
    }
  ];
  const expandedMetricItems = [
    {
      label: t(props.language, "statusLabel"),
      value: recordingStatusLabel(props.recording, props.language)
    },
    {
      label: t(props.language, "inputStatusLabel"),
      value: audioStateLabel(props.recording.audioState, props.language)
    },
    {
      label: t(props.language, "realtimeLatency"),
      value: formatLatency(props.recording.currentLatencyMs)
    },
    {
      label: t(props.language, "inputQuality"),
      value: transcriptQualityLabel(props.recording.inputQuality, props.language)
    },
    {
      label: t(props.language, "lastAudio"),
      value: formatRelativeStatus(props.recording.lastAudioAt, props.language)
    },
    {
      label: t(props.language, "lastTranscript"),
      value: formatRelativeStatus(props.recording.lastTranscriptAt, props.language)
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
          <h4>{t(props.language, "runtime")}</h4>
        </div>
        <div className="accordion-trigger-side compact">
          <span className={`session-status-pill compact tone-${meetingStatusTone(props.currentSession?.status ?? "idle")}`}>
            {props.currentSession ? meetingStatusLabel(props.currentSession.status, props.language) : t(props.language, "waiting")}
          </span>
          <div className="accordion-summary">
            {summaryItems.map((item) => (
              <span key={item.label} className="summary-chip compact">
                <span className="summary-chip-label">{item.label}</span>
                <span className="summary-chip-value">{item.value}</span>
              </span>
            ))}
          </div>
        </div>
      </button>

      {statusExpanded ? (
        <div className="accordion-content">
          <div className="metrics-grid">
            {expandedMetricItems.map((item) => (
              <article key={item.label} className="metric-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>

          <div className="level-card level-card-inline">
            <div className="section-head">
              <div>
                <h4>{t(props.language, "liveLevel")}</h4>
                <p className="muted">{latencyModeLabel(props.recording.latencyMode, props.language)} · {audioStateLabel(props.recording.audioState, props.language)}</p>
              </div>
            </div>
            <div className="level-track">
              <div className="level-fill" style={{ width: `${audioLevelPercent(props.recording.processedInputLevel)}%` }}></div>
            </div>
            <p className="level-readout mono-text">
              {t(props.language, "processedInputLevel")}{" "}
              {Math.round(props.recording.processedInputLevel * 1000) / 1000}
            </p>
            <p className="capture-note">{props.recording.partialText || t(props.language, "partialFallback")}</p>
            {props.recording.lastAudioIssues.length > 0 ? (
              <div className="tag-row">
                {props.recording.lastAudioIssues.map((issue) => (
                  <span key={issue} className="status-tag warning">
                    {audioIssueLabel(issue, props.language)}
                  </span>
                ))}
              </div>
            ) : null}
            {props.recording.lastOverlapAt ? (
              <p className="warning-text">
                {t(props.language, "recentOverlap")}: {formatRelativeStatus(props.recording.lastOverlapAt, props.language)}
              </p>
            ) : null}
            {props.recording.errorMessage ? (
              <p className="error-text">
                {t(props.language, "recentError")}: {props.recording.errorMessage}
              </p>
            ) : null}
            {props.recording.consecutiveAsrFailures > 0 ? (
              <p className="warning-text">
                {t(props.language, "consecutiveFailures")}: {props.recording.consecutiveAsrFailures}
              </p>
            ) : null}
            {props.recording.consecutiveLowQualitySegments > 0 ? (
              <p className="warning-text">
                {t(props.language, "consecutiveLowQuality")}: {props.recording.consecutiveLowQualitySegments}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function HistoryPanel(props: {
  language: UiLanguage;
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
          <h3>{t(props.language, "history")}</h3>
        </div>
        <button
          className="history-add-button"
          type="button"
          aria-label={t(props.language, "startNewMeeting")}
          disabled={!props.canStart}
          onClick={() => void props.onStart()}
        >
          +
        </button>
      </div>

      <div className="history-list-shell">
        {props.sessions.length === 0 ? (
          <div className="history-empty">
            <p className="mono-text">{t(props.language, "noHistory")}</p>
            <p className="muted">{t(props.language, "startMeetingHint")}</p>
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
                        {props.renamingSessionId === session.id ? t(props.language, "saving") : t(props.language, "saveRenameHint")}
                      </span>
                    </div>
                  ) : (
                    <button
                      className="history-main"
                      type="button"
                      onClick={() => props.onSelect(session.id)}
                      onDoubleClick={() => props.onBeginRename(session)}
                    >
                      <span className="history-title mono-text">{meetingListTitle(session, props.language)}</span>
                      <span className="history-subline">
                        <span className={`history-status-badge tone-${tone}`}>
                          <span className="history-status-icon">{meetingStatusIcon(session.status)}</span>
                          <span>{meetingStatusLabel(session.status, props.language)}</span>
                        </span>
                        <span className="history-time muted mono-text">{formatCompactDateTime(session.startedAt, props.language)}</span>
                      </span>
                    </button>
                  )}
                  {props.onDelete ? (
                    <button className="history-delete" type="button" aria-label={t(props.language, "deleteMeeting")} onClick={() => props.onDelete?.(session)}>
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
  language: UiLanguage;
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
  const updateCustomTerm = (termId: string, patch: Partial<CustomTermEntry>): void => {
    props.onPreferenceChange({
      ...preferenceDraft,
      customTerms: preferenceDraft.customTerms.map((item) =>
        item.id === termId
          ? {
              ...item,
              ...patch
            }
          : item
      )
    });
  };

  const appendCustomTerm = (): void => {
    props.onPreferenceChange({
      ...preferenceDraft,
      customTerms: [...preferenceDraft.customTerms, createCustomTermEntry()]
    });
  };

  const removeCustomTerm = (termId: string): void => {
    props.onPreferenceChange({
      ...preferenceDraft,
      customTerms: preferenceDraft.customTerms.filter((item) => item.id !== termId)
    });
  };

  return (
    <div className="stack">
      <section className="settings-hero">
        <h3>{t(props.language, "settingsTitle")}</h3>
      </section>

      <div className="settings-grid">
        <div className="settings-main-column">
          <div className="settings-card">
            <div className="settings-card-head">
              <h4>{t(props.language, "general")}</h4>
            </div>
            <label className="form-field">
              <span>{t(props.language, "language")}</span>
              <select
                value={props.preferenceDraft.uiLanguage}
                onChange={(event) =>
                  props.onPreferenceChange({
                    ...props.preferenceDraft,
                    uiLanguage: event.target.value as UiLanguage
                  })
                }
              >
                <option value="zh-CN">{t(props.language, "languageZh")}</option>
                <option value="en-US">{t(props.language, "languageEn")}</option>
              </select>
            </label>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <h4>{t(props.language, "capture")}</h4>
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
                {t(props.language, "microphoneMode")}
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
                {t(props.language, "systemAudioMode")}
              </button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <h4>{t(props.language, "asr")}</h4>
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
                Gemini
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
                {t(props.language, "localSenseVoice")}
              </button>
            </div>
            {localAsrSelected ? (
              <>
                <div className="guide-grid">
                  <div className="guide-card">
                    <span className="guide-label">{t(props.language, "modelState")}</span>
                    <strong className="mono-text">
                      {modelStateLabel(environment.localModelState, props.language)}
                      {environment.localModelDownloadProgress !== null ? ` ${environment.localModelDownloadProgress}%` : ""}
                    </strong>
                  </div>
                  <div className="guide-card">
                    <span className="guide-label">{t(props.language, "runtimeLabel")}</span>
                    <strong className="mono-text">sherpa-onnx</strong>
                  </div>
                </div>
                <label className="form-field">
                  <span>{t(props.language, "recognitionLanguage")}</span>
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
                    <option value="auto">{t(props.language, "languageAuto")}</option>
                    <option value="zh">{t(props.language, "languageMandarin")}</option>
                    <option value="yue">{t(props.language, "languageCantonese")}</option>
                    <option value="en">{t(props.language, "languageEnglish")}</option>
                    <option value="ja">{t(props.language, "languageJapanese")}</option>
                    <option value="ko">{t(props.language, "languageKorean")}</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>{t(props.language, "latencyStrategy")}</span>
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
                    <option value="fast">{t(props.language, "fast")}</option>
                    <option value="balanced">{t(props.language, "balanced")}</option>
                    <option value="accurate">{t(props.language, "accurate")}</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>{t(props.language, "chunkFallback")}</span>
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
                    <span className="guide-label">{t(props.language, "vad")}</span>
                    <strong>{providerDraft.asr.vadEnabled ? t(props.language, "enabled") : t(props.language, "disabled")}</strong>
                  </div>
                  <div className="guide-card">
                    <span className="guide-label">{t(props.language, "overlapDetection")}</span>
                    <strong>{providerDraft.asr.overlapDetectionEnabled ? t(props.language, "enabled") : t(props.language, "disabled")}</strong>
                  </div>
                </div>
                <div className="settings-inline-toggles">
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
                    <span>{t(props.language, "enableVad")}</span>
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
                    <span>{t(props.language, "enableOverlapDetection")}</span>
                  </label>
                </div>
                <p className="muted">{t(props.language, "processingNote")}</p>
                <div className="settings-inline-actions">
                  <button
                    type="button"
                    disabled={environment.localModelState === "downloading"}
                    onClick={props.onDownloadLocalModel}
                  >
                    {environment.localModelState === "ready"
                      ? t(props.language, "redownloadModel")
                      : environment.localModelState === "downloading"
                        ? t(props.language, "downloadingModel")
                        : t(props.language, "downloadModel")}
                  </button>
                  <button
                    type="button"
                    disabled={environment.localModelState === "downloading" || environment.localModelState === "not-downloaded"}
                    onClick={props.onDeleteLocalModel}
                  >
                    {t(props.language, "deleteModel")}
                  </button>
                  <button
                    type="button"
                    disabled={environment.localModelState === "downloading"}
                    onClick={props.onImportLocalModelDir}
                  >
                    {t(props.language, "importModelDir")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="form-field">
                  <span>{t(props.language, "endpoint")}</span>
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
                  <span>{t(props.language, "apiKey")}</span>
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
                  <span>{t(props.language, "model")}</span>
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
              <h4>{t(props.language, "llm")}</h4>
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
                {t(props.language, "localOllama")}
              </button>
            </div>
            <label className="form-field">
              <span>{localLlmSelected ? "Ollama URL" : "Base URL"}</span>
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
                <span>{t(props.language, "apiKey")}</span>
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
              <span>{t(props.language, "model")}</span>
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
        </div>

        <div className="settings-side-column">
          <div className="settings-card">
            <div className="settings-card-head">
              <h4>{t(props.language, "termLibrary")}</h4>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={preferenceDraft.customTermLibraryEnabled}
                onChange={(event) =>
                  props.onPreferenceChange({
                    ...preferenceDraft,
                    customTermLibraryEnabled: event.target.checked
                  })
                }
              />
              <span>{t(props.language, "enableCustomTerms")}</span>
            </label>
            <p className="muted">{t(props.language, "termLibraryNote")}</p>
            <div className="term-library-list">
              {preferenceDraft.customTerms.length === 0 ? <p className="muted">{t(props.language, "noCustomTerms")}</p> : null}
              {preferenceDraft.customTerms.map((item) => (
                <article key={item.id} className="term-library-item">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(event) => updateCustomTerm(item.id, { enabled: event.target.checked })}
                    />
                    <span>{t(props.language, "termEntryEnabled")}</span>
                  </label>
                  <label className="form-field">
                    <span>{t(props.language, "termCanonical")}</span>
                    <input
                      value={item.canonical}
                      onChange={(event) => updateCustomTerm(item.id, { canonical: event.target.value })}
                    />
                  </label>
                  <label className="form-field">
                    <span>{t(props.language, "termAliases")}</span>
                    <textarea
                      rows={4}
                      placeholder={t(props.language, "termAliasesHint")}
                      value={customTermAliasesText(item)}
                      onChange={(event) =>
                        updateCustomTerm(item.id, {
                          aliases: event.target.value
                            .split(/\n+/)
                            .map((alias) => alias.trim())
                            .filter(Boolean)
                        })
                      }
                    />
                  </label>
                  <button className="danger-ghost" type="button" onClick={() => removeCustomTerm(item.id)}>
                    {t(props.language, "removeTerm")}
                  </button>
                </article>
              ))}
            </div>
            <button type="button" onClick={appendCustomTerm}>
              {t(props.language, "addTerm")}
            </button>
          </div>

          <div className="settings-card">
            <div className="settings-card-head">
              <h4>{t(props.language, "workspacePrefs")}</h4>
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
                <span>{t(props.language, "skipGuide")}</span>
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
                <span>{t(props.language, "exportPlaceholders")}</span>
              </label>
            </div>

            <div className="guide-merged">
              <div className="guide-grid">
                <div className="guide-card">
                  <span className="guide-label">{t(props.language, "microphonePermission")}</span>
                  <strong className="mono-text">{permissionLabel(environment.microphonePermission, props.language)}</strong>
                </div>
                <div className="guide-card">
                  <span className="guide-label">{t(props.language, "blackhole")}</span>
                  <strong>{environment.hasBlackHoleDevice ? t(props.language, "detected") : t(props.language, "notDetected")}</strong>
                </div>
              </div>

              <div className="control-grid">
                <button type="button" onClick={props.onRequestAccess}>
                  {t(props.language, "requestMic")}
                </button>
                <button type="button" onClick={props.onRefresh}>
                  {t(props.language, "refreshDevices")}
                </button>
              </div>
            </div>
          </div>

          <div className="settings-card settings-actions-card">
            <div className="settings-actions">
              <button className="primary-button" disabled={props.saving} type="button" onClick={props.onSave}>
                {props.saving ? t(props.language, "saving") : t(props.language, "saveSettings")}
              </button>
              <button className="secondary-button" type="button" onClick={props.onCompleteGuide}>
                {t(props.language, "finishGuide")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TranscriptPanel(props: {
  detail: MeetingDetail | null;
  meetingTerms: string[];
  language: UiLanguage;
}) {
  if (!props.detail) {
    return (
      <div className="detail-card transcript-card empty-state">
        <h3>{t(props.language, "chooseMeeting")}</h3>
        <p>{t(props.language, "transcriptEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="detail-card transcript-card">
      <div className="section-head">
        <div>
          <h4>{t(props.language, "transcript")}</h4>
        </div>
        <span className="mono-text">{countLabel(props.detail.transcriptSegments.length, "segmentUnit", props.language)}</span>
      </div>
      {props.meetingTerms.length > 0 ? (
        <div className="term-strip scrollable">
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
                <p>{segment.kind === "speech" ? highlightText(segment.text, props.meetingTerms) : segment.note || t(props.language, "noBody")}</p>
                <div className="tag-row">
                  <span className={`status-tag quality-${segment.quality}`}>{transcriptQualityLabel(segment.quality, props.language)}</span>
                  {segment.overlapDetected ? <span className="status-tag warning">{t(props.language, "overlapDetected")}</span> : null}
                  {segment.audioIssues.map((issue) => (
                    <span key={issue} className="status-tag muted">
                      {audioIssueLabel(issue, props.language)}
                    </span>
                  ))}
                </div>
              </div>
              <small>
                {t(props.language, "speechType")}: {segment.kind} | {t(props.language, "level")}: {Math.round(segment.inputLevel * 1000) / 1000} | {t(props.language, "latency")}: {segment.latencyMs} ms | {t(props.language, "processingMs")}: {segment.processingMs} ms | {t(props.language, "dedupe")}: {segment.overlapChars}
              </small>
              {segment.note && segment.kind === "speech" ? <small>{segment.note}</small> : null}
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
  meetingTerms: string[];
  language: UiLanguage;
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
      <span className="summary-status summary-status-error">{t(props.language, "error")}</span>
    ) : summaryStatus === "none" ? (
      <span className="summary-status">{t(props.language, "waiting")}</span>
    ) : null;

  return (
    <div className="detail-card result-panel">
      <div className="result-header">
        <div className="section-head">
          <div>
            <h4>{t(props.language, "summary")}</h4>
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
            aria-label={
              summaryStatus === "generating"
                ? t(props.language, "generating")
                : stale
                  ? t(props.language, "regenerate")
                  : t(props.language, "generate")
            }
          >
            {summaryStatus === "generating" ? <LoadingDots label={t(props.language, "generating")} /> : t(props.language, "generate")}
          </button>
        </div>
        {statusNode}
      </div>
      <div className="result-body">
        {!props.detail ? (
          <p>{t(props.language, "selectMeeting")}</p>
        ) : props.detail.session.summaryStatus === "generating" ? (
          <p>{t(props.language, "processingSummary")}</p>
        ) : props.detail.summary ? (
          <>
            <p>{highlightText(props.detail.summary.overview, props.meetingTerms)}</p>
            <p className="muted">
              {t(props.language, "generatedFromSegment")
                .replace("{seq}", String(props.detail.summary.sourceSegmentSeq))
                .replace(
                  "{status}",
                  props.detail.summary.generatedWhileStatus === "completed"
                    ? t(props.language, "generatedWhenCompleted")
                    : t(props.language, "generatedWhenLive")
                )}
            </p>
            {stale ? <p className="warning-text">{t(props.language, "staleSummary")}</p> : null}
            <strong>{t(props.language, "keyPoints")}</strong>
            {props.detail.summary.decisions.length > 0 ? (
              <ul>
                {props.detail.summary.decisions.map((item) => (
                  <li key={item}>{highlightText(item, props.meetingTerms)}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t(props.language, "noDecisions")}</p>
            )}
            <strong>{t(props.language, "actionItems")}</strong>
            {props.detail.summary.actionItems.length > 0 ? (
              <div className="action-item-list">
                {props.detail.summary.actionItems.map((item) => (
                  <article key={`${item.text}-${item.owner ?? "none"}-${item.due ?? "none"}`} className="action-item-card">
                    <p>{highlightText(item.text, props.meetingTerms)}</p>
                    <small>{formatActionItemMeta(item, props.language)}</small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">{t(props.language, "none")}</p>
            )}
            <strong>{t(props.language, "risks")}</strong>
            {props.detail.summary.issues.length > 0 ? (
              <ul>
                {props.detail.summary.issues.map((item) => (
                  <li key={item}>{highlightText(item, props.meetingTerms)}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t(props.language, "noIssues")}</p>
            )}
            <div className="qa-section">
              <div className="section-head">
                <strong>{t(props.language, "qa")}</strong>
                <span className="mono-text">{countLabel(props.detail.qaItems.length, "itemUnit", props.language)}</span>
              </div>
              <div className="qa-list">
                {props.detail.qaItems.map((item) => (
                  <article key={item.id} className="qa-item">
                    <p className="qa-question">
                      {t(props.language, "questionPrefix")}
                      {highlightText(item.question, props.meetingTerms)}
                    </p>
                    <p className="qa-answer">
                      {t(props.language, "answerPrefix")}
                      {highlightText(item.answer, props.meetingTerms)}
                    </p>
                  </article>
                ))}
              </div>
              <div className="qa-compose">
                <textarea
                  placeholder={t(props.language, "askPlaceholder")}
                  value={props.qaInput}
                  onChange={(event) => props.onQaInputChange(event.target.value)}
                  rows={3}
                />
                <button disabled={props.asking || !props.qaInput.trim()} type="button" onClick={props.onAskQuestion}>
                  {props.asking ? t(props.language, "generating") : t(props.language, "ask")}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p>{t(props.language, "noSummary")}</p>
        )}
        {props.recording.status === "processing" ? <p className="warning-text">{t(props.language, "processingMoreComplete")}</p> : null}
      </div>
    </div>
  );
}

function ControlRail(props: {
  currentSession: MeetingSession | null;
  detail: MeetingDetail | null;
  recording: RecordingSnapshot;
  language: UiLanguage;
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
            <h4>{t(props.language, "controls")}</h4>
          </div>
        </div>

        <div className="control-grid">
          <button className="danger-ghost" disabled={!canFinish} type="button" onClick={props.onStop}>
            {t(props.language, "stopMeeting")}
          </button>
          <button
            disabled={!canResume && !canPause}
            type="button"
            onClick={canPause ? props.onPause : props.onResume}
          >
            {canPause ? t(props.language, "pause") : t(props.language, "resume")}
          </button>
          <button disabled={!props.detail} type="button" onClick={() => props.onExport("markdown")}>
            {t(props.language, "exportMd")}
          </button>
          <button disabled={!props.detail} type="button" onClick={() => props.onExport("txt")}>
            {t(props.language, "exportTxt")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmDialog(props: {
  language: UiLanguage;
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
        <h3 id="delete-dialog-title">{t(props.language, "deleteTitle")}</h3>
        <p className="muted">
          {t(props.language, "deleteTime")}
          {formatCompactDateTime(props.session.startedAt, props.language)}
        </p>
        <p>{t(props.language, "deleteDesc")}</p>
        <div className="modal-actions">
          <button className="secondary-button" disabled={props.deleting} type="button" onClick={props.onCancel}>
            {t(props.language, "cancel")}
          </button>
          <button className="danger-button" disabled={props.deleting} type="button" onClick={props.onConfirm}>
            {props.deleting ? t(props.language, "deleting") : t(props.language, "confirmDelete")}
          </button>
        </div>
      </div>
    </div>
  );
}
