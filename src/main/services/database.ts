import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { sanitizeRequestedAudioProcessingBackend } from "@main/utils/audio-processing-backend";
import { sanitizeCustomTerms } from "@shared/term-library";
import type {
  MeetingHighlight,
  AppPreferences,
  MeetingDetail,
  MeetingQaItem,
  MeetingSession,
  MeetingSummary,
  ProviderConfig,
  TranscriptSegment
} from "@shared/types";

const defaultProviderConfig: ProviderConfig = {
  asr: {
    providerId: "gemini-openai-audio",
    runtime: "cloud",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: "",
    model: "gemini-2.5-flash",
    language: "zh-CN",
    chunkMs: 5000,
    localModelId: null,
    localModelDir: null,
    localLanguage: "auto",
    latencyMode: "balanced",
    vadEnabled: true,
    vadThreshold: 0.014,
    vadPreRollMs: 240,
    vadPostRollMs: 420,
    minSpeechMs: 600,
    maxSpeechMs: 5200,
    aecMode: "auto",
    noiseSuppressionMode: "auto",
    autoGainMode: "auto",
    overlapDetectionEnabled: true,
    audioProcessingBackend: "auto"
  },
  llm: {
    providerId: "gemini-openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: "",
    model: "gemini-2.5-flash",
    temperature: 0.2,
    maxTokens: 1200
  }
};

const defaultPreferences: AppPreferences = {
  preferredAudioDeviceId: null,
  preferredAudioDeviceName: null,
  exportDirectory: null,
  exportIncludePlaceholders: true,
  captureMode: "microphone",
  onboardingCompleted: false,
  uiLanguage: "zh-CN",
  customTermLibraryEnabled: true,
  customTerms: []
};

type SessionRow = Omit<MeetingSession, "durationMs"> & { duration_ms: number };
type TranscriptRow = Omit<
  TranscriptSegment,
  "startMs" | "endMs" | "isFinal" | "inputLevel" | "overlapChars" | "processingMs" | "latencyMs" | "overlapDetected" | "audioIssues"
> & {
  start_ms: number;
  end_ms: number;
  is_final: number;
  input_level: number | null;
  overlap_chars: number | null;
  processing_ms: number | null;
  latency_ms: number | null;
  overlap_detected: number | null;
  audio_issues_json: string | null;
};

export class AppDatabase {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.seedDefaults();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        endedAt TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        audioDeviceId TEXT NOT NULL,
        audioDeviceName TEXT NOT NULL,
        captureMode TEXT NOT NULL DEFAULT 'system-audio',
        transcriptText TEXT NOT NULL DEFAULT '',
        summaryStatus TEXT NOT NULL DEFAULT 'none',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        seq INTEGER NOT NULL,
        text TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        is_final INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'speech',
        note TEXT,
        input_level REAL NOT NULL DEFAULT 0,
        overlap_chars INTEGER NOT NULL DEFAULT 0,
        processing_ms INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        quality TEXT NOT NULL DEFAULT 'medium',
        overlap_detected INTEGER NOT NULL DEFAULT 0,
        audio_issues_json TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL,
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_segments_session_seq
      ON transcript_segments(sessionId, seq);

      CREATE TABLE IF NOT EXISTS summaries (
        sessionId TEXT PRIMARY KEY,
        overview TEXT NOT NULL,
        bulletPointsJson TEXT NOT NULL,
        actionItemsJson TEXT NOT NULL,
        risksJson TEXT NOT NULL,
        decisionsJson TEXT NOT NULL DEFAULT '[]',
        issuesJson TEXT NOT NULL DEFAULT '[]',
        rawResponse TEXT NOT NULL,
        sourceSegmentSeq INTEGER NOT NULL DEFAULT 0,
        sourceTranscriptChars INTEGER NOT NULL DEFAULT 0,
        generatedWhileStatus TEXT NOT NULL DEFAULT 'completed',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS provider_configs (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS meeting_qa_items (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        model TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS meeting_highlights (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        segmentId TEXT NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL
      );
    `);

    this.ensureColumn("transcript_segments", "kind", "TEXT NOT NULL DEFAULT 'speech'");
    this.ensureColumn("transcript_segments", "note", "TEXT");
    this.ensureColumn("transcript_segments", "input_level", "REAL NOT NULL DEFAULT 0");
    this.ensureColumn("transcript_segments", "overlap_chars", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("transcript_segments", "processing_ms", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("transcript_segments", "latency_ms", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("transcript_segments", "quality", "TEXT NOT NULL DEFAULT 'medium'");
    this.ensureColumn("transcript_segments", "overlap_detected", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("transcript_segments", "audio_issues_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("sessions", "captureMode", "TEXT NOT NULL DEFAULT 'system-audio'");
    this.ensureColumn("summaries", "sourceSegmentSeq", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("summaries", "sourceTranscriptChars", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("summaries", "generatedWhileStatus", "TEXT NOT NULL DEFAULT 'completed'");
    this.ensureColumn("summaries", "decisionsJson", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("summaries", "issuesJson", "TEXT NOT NULL DEFAULT '[]'");
  }

  private seedDefaults(): void {
    const providerRow = this.db.prepare("SELECT json FROM provider_configs WHERE id = 1").get() as { json: string } | undefined;
    if (!providerRow) {
      this.db.prepare("INSERT INTO provider_configs (id, json) VALUES (1, ?)").run(JSON.stringify(defaultProviderConfig));
    }

    const preferenceRow = this.db.prepare("SELECT json FROM app_preferences WHERE id = 1").get() as { json: string } | undefined;
    if (!preferenceRow) {
      this.db.prepare("INSERT INTO app_preferences (id, json) VALUES (1, ?)").run(JSON.stringify(defaultPreferences));
    }
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  listSessions(): MeetingSession[] {
    const rows = this.db.prepare("SELECT * FROM sessions ORDER BY startedAt DESC").all() as SessionRow[];
    return rows.map(this.mapSessionRow);
  }

  getSession(sessionId: string): MeetingSession {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
    if (!row) {
      throw new Error("会议不存在");
    }
    return this.mapSessionRow(row);
  }

  createSession(input: {
    title: string;
    audioDeviceId: string;
    audioDeviceName: string;
    captureMode: MeetingSession["captureMode"];
  }): MeetingSession {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO sessions (id, title, startedAt, endedAt, duration_ms, status, audioDeviceId, audioDeviceName, captureMode, transcriptText, summaryStatus, createdAt, updatedAt)
      VALUES (@id, @title, @startedAt, NULL, 0, 'recording', @audioDeviceId, @audioDeviceName, @captureMode, '', 'none', @createdAt, @updatedAt)
    `).run({
      id,
      title: input.title,
      startedAt: now,
      audioDeviceId: input.audioDeviceId,
      audioDeviceName: input.audioDeviceName,
      captureMode: input.captureMode,
      createdAt: now,
      updatedAt: now
    });
    return this.getSession(id);
  }

  updateSession(sessionId: string, patch: Partial<MeetingSession>): MeetingSession {
    const current = this.getSession(sessionId);
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.db.prepare(`
      UPDATE sessions
      SET title = @title,
          startedAt = @startedAt,
          endedAt = @endedAt,
          duration_ms = @durationMs,
          status = @status,
          audioDeviceId = @audioDeviceId,
          audioDeviceName = @audioDeviceName,
          captureMode = @captureMode,
          transcriptText = @transcriptText,
          summaryStatus = @summaryStatus,
          updatedAt = @updatedAt
      WHERE id = @id
    `).run(next);
    return this.getSession(sessionId);
  }

  appendTranscriptSegment(input: {
    sessionId: string;
    seq: number;
    text: string;
    startMs: number;
    endMs: number;
    isFinal: boolean;
    kind: TranscriptSegment["kind"];
    note: string | null;
    inputLevel: number;
    overlapChars: number;
    processingMs: number;
    latencyMs: number;
    quality: TranscriptSegment["quality"];
    overlapDetected: boolean;
    audioIssues: TranscriptSegment["audioIssues"];
  }): TranscriptSegment {
    const createdAt = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO transcript_segments (
        id, sessionId, seq, text, start_ms, end_ms, is_final, kind, note, input_level, overlap_chars,
        processing_ms, latency_ms, quality, overlap_detected, audio_issues_json, createdAt
      )
      VALUES (
        @id, @sessionId, @seq, @text, @start_ms, @end_ms, @is_final, @kind, @note, @input_level, @overlap_chars,
        @processing_ms, @latency_ms, @quality, @overlap_detected, @audio_issues_json, @createdAt
      )
    `).run({
      id,
      sessionId: input.sessionId,
      seq: input.seq,
      text: input.text,
      start_ms: input.startMs,
      end_ms: input.endMs,
      is_final: input.isFinal ? 1 : 0,
      kind: input.kind,
      note: input.note,
      input_level: input.inputLevel,
      overlap_chars: input.overlapChars,
      processing_ms: input.processingMs,
      latency_ms: input.latencyMs,
      quality: input.quality,
      overlap_detected: input.overlapDetected ? 1 : 0,
      audio_issues_json: JSON.stringify(input.audioIssues),
      createdAt
    });
    return {
      id,
      sessionId: input.sessionId,
      seq: input.seq,
      text: input.text,
      startMs: input.startMs,
      endMs: input.endMs,
      isFinal: input.isFinal,
      kind: input.kind,
      note: input.note,
      inputLevel: input.inputLevel,
      overlapChars: input.overlapChars,
      processingMs: input.processingMs,
      latencyMs: input.latencyMs,
      quality: input.quality,
      overlapDetected: input.overlapDetected,
      audioIssues: input.audioIssues,
      createdAt
    };
  }

  listTranscriptSegments(sessionId: string): TranscriptSegment[] {
    const rows = this.db
      .prepare("SELECT * FROM transcript_segments WHERE sessionId = ? ORDER BY seq ASC")
      .all(sessionId) as TranscriptRow[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      seq: row.seq,
      text: row.text,
      startMs: row.start_ms,
      endMs: row.end_ms,
      isFinal: row.is_final === 1,
      kind: row.kind,
      note: row.note ?? null,
      inputLevel: row.input_level ?? 0,
      overlapChars: row.overlap_chars ?? 0,
      processingMs: row.processing_ms ?? 0,
      latencyMs: row.latency_ms ?? 0,
      quality: row.quality,
      overlapDetected: row.overlap_detected === 1,
      audioIssues: row.audio_issues_json ? (JSON.parse(row.audio_issues_json) as TranscriptSegment["audioIssues"]) : [],
      createdAt: row.createdAt
    }));
  }

  listHighlights(sessionId: string): MeetingHighlight[] {
    const rows = this.db
      .prepare("SELECT * FROM meeting_highlights WHERE sessionId = ? ORDER BY seq ASC, createdAt ASC")
      .all(sessionId) as Array<{
      id: string;
      sessionId: string;
      segmentId: string;
      seq: number;
      kind: MeetingHighlight["kind"];
      text: string;
      createdAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      segmentId: row.segmentId,
      seq: row.seq,
      kind: row.kind,
      text: row.text,
      createdAt: row.createdAt
    }));
  }

  appendHighlight(input: Omit<MeetingHighlight, "id" | "createdAt">): MeetingHighlight {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO meeting_highlights (id, sessionId, segmentId, seq, kind, text, createdAt)
      VALUES (@id, @sessionId, @segmentId, @seq, @kind, @text, @createdAt)
    `).run({
      id,
      sessionId: input.sessionId,
      segmentId: input.segmentId,
      seq: input.seq,
      kind: input.kind,
      text: input.text,
      createdAt
    });

    return {
      id,
      sessionId: input.sessionId,
      segmentId: input.segmentId,
      seq: input.seq,
      kind: input.kind,
      text: input.text,
      createdAt
    };
  }

  saveSummary(summary: Omit<MeetingSummary, "createdAt" | "updatedAt">): MeetingSummary {
    const existing = this.getSummary(summary.sessionId);
    const now = new Date().toISOString();
    const payload = {
      sessionId: summary.sessionId,
      overview: summary.overview,
      bulletPointsJson: JSON.stringify(summary.decisions),
      actionItemsJson: JSON.stringify(summary.actionItems),
      risksJson: JSON.stringify(summary.issues),
      decisionsJson: JSON.stringify(summary.decisions),
      issuesJson: JSON.stringify(summary.issues),
      rawResponse: summary.rawResponse,
      sourceSegmentSeq: summary.sourceSegmentSeq,
      sourceTranscriptChars: summary.sourceTranscriptChars,
      generatedWhileStatus: summary.generatedWhileStatus,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.db.prepare(`
      INSERT INTO summaries (
        sessionId, overview, bulletPointsJson, actionItemsJson, risksJson, decisionsJson, issuesJson, rawResponse,
        sourceSegmentSeq, sourceTranscriptChars, generatedWhileStatus, createdAt, updatedAt
      )
      VALUES (
        @sessionId, @overview, @bulletPointsJson, @actionItemsJson, @risksJson, @decisionsJson, @issuesJson, @rawResponse,
        @sourceSegmentSeq, @sourceTranscriptChars, @generatedWhileStatus, @createdAt, @updatedAt
      )
      ON CONFLICT(sessionId) DO UPDATE SET
        overview = excluded.overview,
        bulletPointsJson = excluded.bulletPointsJson,
        actionItemsJson = excluded.actionItemsJson,
        risksJson = excluded.risksJson,
        decisionsJson = excluded.decisionsJson,
        issuesJson = excluded.issuesJson,
        rawResponse = excluded.rawResponse,
        sourceSegmentSeq = excluded.sourceSegmentSeq,
        sourceTranscriptChars = excluded.sourceTranscriptChars,
        generatedWhileStatus = excluded.generatedWhileStatus,
        updatedAt = excluded.updatedAt
    `).run(payload);

    return this.getSummary(summary.sessionId)!;
  }

  getSummary(sessionId: string): MeetingSummary | null {
    const row = this.db.prepare("SELECT * FROM summaries WHERE sessionId = ?").get(sessionId) as
      | {
          sessionId: string;
          overview: string;
          bulletPointsJson: string;
          actionItemsJson: string;
          risksJson: string;
          decisionsJson?: string;
          issuesJson?: string;
          rawResponse: string;
          sourceSegmentSeq?: number;
          sourceTranscriptChars?: number;
          generatedWhileStatus?: MeetingSummary["generatedWhileStatus"];
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const actionItems = (JSON.parse(row.actionItemsJson) as Array<string | { text?: string; owner?: string | null; due?: string | null }>)
      .map((item) =>
        typeof item === "string"
          ? {
              text: item,
              owner: null,
              due: null
            }
          : {
              text: item.text?.trim() ?? "",
              owner: item.owner?.trim() || null,
              due: item.due?.trim() || null
            }
      )
      .filter((item) => item.text);

    return {
      sessionId: row.sessionId,
      overview: row.overview,
      actionItems,
      decisions: JSON.parse(row.decisionsJson ?? row.bulletPointsJson) as string[],
      issues: JSON.parse(row.issuesJson ?? row.risksJson) as string[],
      rawResponse: row.rawResponse,
      sourceSegmentSeq: row.sourceSegmentSeq ?? 0,
      sourceTranscriptChars: row.sourceTranscriptChars ?? 0,
      generatedWhileStatus: row.generatedWhileStatus ?? "completed",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  getMeetingDetail(sessionId: string): MeetingDetail {
    return {
      session: this.getSession(sessionId),
      transcriptSegments: this.listTranscriptSegments(sessionId),
      summary: this.getSummary(sessionId),
      qaItems: this.listQaItems(sessionId)
    };
  }

  listQaItems(sessionId: string): MeetingQaItem[] {
    const rows = this.db
      .prepare("SELECT * FROM meeting_qa_items WHERE sessionId = ? ORDER BY createdAt ASC")
      .all(sessionId) as Array<{
        id: string;
        sessionId: string;
        question: string;
        answer: string;
        model: string;
        createdAt: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      question: row.question,
      answer: row.answer,
      model: row.model,
      createdAt: row.createdAt
    }));
  }

  appendQaItem(input: Omit<MeetingQaItem, "id" | "createdAt">): MeetingQaItem {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO meeting_qa_items (id, sessionId, question, answer, model, createdAt)
      VALUES (@id, @sessionId, @question, @answer, @model, @createdAt)
    `).run({
      id,
      sessionId: input.sessionId,
      question: input.question,
      answer: input.answer,
      model: input.model,
      createdAt
    });

    return {
      id,
      sessionId: input.sessionId,
      question: input.question,
      answer: input.answer,
      model: input.model,
      createdAt
    };
  }

  deleteMeeting(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  getProviderConfig(): ProviderConfig {
    const row = this.db.prepare("SELECT json FROM provider_configs WHERE id = 1").get() as { json: string };
    return this.normalizeProviderConfig(JSON.parse(row.json) as Partial<ProviderConfig>);
  }

  saveProviderConfig(config: ProviderConfig): ProviderConfig {
    this.db.prepare("UPDATE provider_configs SET json = ? WHERE id = 1").run(JSON.stringify(config));
    return this.getProviderConfig();
  }

  getPreferences(): AppPreferences {
    const row = this.db.prepare("SELECT json FROM app_preferences WHERE id = 1").get() as { json: string };
    const parsed = JSON.parse(row.json) as Partial<AppPreferences>;
    return {
      ...defaultPreferences,
      ...parsed,
      customTerms: sanitizeCustomTerms(parsed.customTerms ?? [])
    };
  }

  savePreferences(preferences: AppPreferences): AppPreferences {
    this.db.prepare("UPDATE app_preferences SET json = ? WHERE id = 1").run(
      JSON.stringify({
        ...preferences,
        customTerms: sanitizeCustomTerms(preferences.customTerms)
      })
    );
    return this.getPreferences();
  }

  private mapSessionRow(row: SessionRow): MeetingSession {
    return {
      id: row.id,
      title: row.title,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationMs: row.duration_ms,
      status: row.status,
      audioDeviceId: row.audioDeviceId,
      audioDeviceName: row.audioDeviceName,
      captureMode: row.captureMode,
      transcriptText: row.transcriptText,
      summaryStatus: row.summaryStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private normalizeProviderConfig(config: Partial<ProviderConfig>): ProviderConfig {
    const merged: ProviderConfig = {
      asr: {
        ...defaultProviderConfig.asr,
        ...(config.asr ?? {})
      },
      llm: {
        ...defaultProviderConfig.llm,
        ...(config.llm ?? {})
      }
    };

    if (
      merged.llm.providerId === "gemini-openai-compatible" &&
      merged.llm.baseUrl === "https://generativelanguage.googleapis.com/v1beta/openai" &&
      merged.llm.model === "gemini-3-flash-preview"
    ) {
      merged.llm.model = "gemini-2.5-flash";
    }

    if (merged.llm.providerId === "ollama-local") {
      if (
        !merged.llm.baseUrl ||
        merged.llm.baseUrl === "https://generativelanguage.googleapis.com/v1beta/openai" ||
        merged.llm.baseUrl.endsWith("/v1")
      ) {
        merged.llm.baseUrl = "http://127.0.0.1:11434";
      }
      if (!merged.llm.model || merged.llm.model === "gemini-2.5-flash") {
        merged.llm.model = "qwen3.5:4b";
      }
      merged.llm.apiKey = merged.llm.apiKey || "ollama";
    }

    if (merged.asr.providerId === "sensevoice-local") {
      merged.asr.runtime = "sherpa-onnx";
      merged.asr.localModelId = merged.asr.localModelId ?? "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09";
      merged.asr.chunkMs = merged.asr.chunkMs || 8000;
      merged.asr.vadEnabled = merged.asr.vadEnabled ?? true;
      merged.asr.overlapDetectionEnabled = merged.asr.overlapDetectionEnabled ?? true;
      merged.asr.audioProcessingBackend = sanitizeRequestedAudioProcessingBackend(merged.asr.audioProcessingBackend);
    } else {
      merged.asr.runtime = "cloud";
      merged.asr.audioProcessingBackend = sanitizeRequestedAudioProcessingBackend(merged.asr.audioProcessingBackend);
    }

    return merged;
  }
}
