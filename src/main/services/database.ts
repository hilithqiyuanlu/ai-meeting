import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
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
    localLanguage: "auto"
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
  onboardingCompleted: false
};

type SessionRow = Omit<MeetingSession, "durationMs"> & { duration_ms: number };
type TranscriptRow = Omit<TranscriptSegment, "startMs" | "endMs" | "isFinal" | "inputLevel" | "overlapChars"> & {
  start_ms: number;
  end_ms: number;
  is_final: number;
  input_level: number | null;
  overlap_chars: number | null;
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

      CREATE TABLE IF NOT EXISTS app_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL
      );
    `);

    this.ensureColumn("transcript_segments", "kind", "TEXT NOT NULL DEFAULT 'speech'");
    this.ensureColumn("transcript_segments", "note", "TEXT");
    this.ensureColumn("transcript_segments", "input_level", "REAL NOT NULL DEFAULT 0");
    this.ensureColumn("transcript_segments", "overlap_chars", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("sessions", "captureMode", "TEXT NOT NULL DEFAULT 'system-audio'");
    this.ensureColumn("summaries", "sourceSegmentSeq", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("summaries", "sourceTranscriptChars", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("summaries", "generatedWhileStatus", "TEXT NOT NULL DEFAULT 'completed'");
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
  }): TranscriptSegment {
    const createdAt = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO transcript_segments (id, sessionId, seq, text, start_ms, end_ms, is_final, kind, note, input_level, overlap_chars, createdAt)
      VALUES (@id, @sessionId, @seq, @text, @start_ms, @end_ms, @is_final, @kind, @note, @input_level, @overlap_chars, @createdAt)
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
      createdAt: row.createdAt
    }));
  }

  saveSummary(summary: Omit<MeetingSummary, "createdAt" | "updatedAt">): MeetingSummary {
    const existing = this.getSummary(summary.sessionId);
    const now = new Date().toISOString();
    const payload = {
      sessionId: summary.sessionId,
      overview: summary.overview,
      bulletPointsJson: JSON.stringify(summary.bulletPoints),
      actionItemsJson: JSON.stringify(summary.actionItems),
      risksJson: JSON.stringify(summary.risks),
      rawResponse: summary.rawResponse,
      sourceSegmentSeq: summary.sourceSegmentSeq,
      sourceTranscriptChars: summary.sourceTranscriptChars,
      generatedWhileStatus: summary.generatedWhileStatus,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.db.prepare(`
      INSERT INTO summaries (
        sessionId, overview, bulletPointsJson, actionItemsJson, risksJson, rawResponse,
        sourceSegmentSeq, sourceTranscriptChars, generatedWhileStatus, createdAt, updatedAt
      )
      VALUES (
        @sessionId, @overview, @bulletPointsJson, @actionItemsJson, @risksJson, @rawResponse,
        @sourceSegmentSeq, @sourceTranscriptChars, @generatedWhileStatus, @createdAt, @updatedAt
      )
      ON CONFLICT(sessionId) DO UPDATE SET
        overview = excluded.overview,
        bulletPointsJson = excluded.bulletPointsJson,
        actionItemsJson = excluded.actionItemsJson,
        risksJson = excluded.risksJson,
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

    return {
      sessionId: row.sessionId,
      overview: row.overview,
      bulletPoints: JSON.parse(row.bulletPointsJson) as string[],
      actionItems: JSON.parse(row.actionItemsJson) as string[],
      risks: JSON.parse(row.risksJson) as string[],
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
    return {
      ...defaultPreferences,
      ...(JSON.parse(row.json) as Partial<AppPreferences>)
    };
  }

  savePreferences(preferences: AppPreferences): AppPreferences {
    this.db.prepare("UPDATE app_preferences SET json = ? WHERE id = 1").run(JSON.stringify(preferences));
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

    if (merged.asr.providerId === "sensevoice-local") {
      merged.asr.runtime = "sherpa-onnx";
      merged.asr.localModelId = merged.asr.localModelId ?? "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09";
      merged.asr.chunkMs = merged.asr.chunkMs || 8000;
    } else {
      merged.asr.runtime = "cloud";
    }

    return merged;
  }
}
