import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import type {
  ConversationDetail,
  ConversationSummary,
  LogCategory,
  LogEntry,
  LogLevel,
  LlmMode,
  MessageRole,
  PipelineEvent,
  PipelineStage,
  PipelineStatus,
  SpeechProviderMode,
  VoicePipelineMode
} from "@voxmesh/shared";

interface CountRow {
  count: number;
}

interface AdminRow {
  password_hash: string;
}

interface SessionRow {
  expires_at: string;
}

interface ConversationRow {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

interface LogRow {
  id: string;
  category: LogCategory;
  level: LogLevel;
  message: string;
  conversation_id: string | null;
  created_at: string;
}

interface SettingRow {
  key: string;
  value: string;
}

interface PipelineEventRow {
  id: string;
  stage: PipelineStage;
  status: PipelineStatus;
  message: string;
  created_at: string;
}

export interface StoredLlmConfiguration {
  mode: LlmMode;
  endpoint: string;
  deployment: string;
  apiVersion: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  apiKey: string | null;
}

export interface StoredSpeechConfiguration {
  sttMode: SpeechProviderMode;
  ttsMode: SpeechProviderMode;
  sttEndpoint: string;
  sttDeployment: string;
  sttApiVersion: string;
  sttLanguage: string;
  sttApiKey: string | null;
  ttsEndpoint: string;
  ttsDeployment: string;
  ttsApiVersion: string;
  ttsVoice: string;
  ttsInstructions: string;
  ttsApiKey: string | null;
}

export interface StoredVoicePipelineConfiguration {
  mode: VoicePipelineMode;
  nativeProviderId: string;
}

export class VoxMeshStore {
  private readonly database: Database.Database;

  public constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.database = new Database(path);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  public close(): void {
    this.database.close();
  }

  public hasAdmin(): boolean {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM admin_credentials")
      .get() as CountRow;
    return row.count > 0;
  }

  public createAdmin(passwordHash: string): boolean {
    const result = this.database
      .prepare(
        "INSERT OR IGNORE INTO admin_credentials (id, password_hash, created_at) VALUES (1, ?, ?)"
      )
      .run(passwordHash, new Date().toISOString());
    return result.changes === 1;
  }

  public getAdminPasswordHash(): string | null {
    const row = this.database
      .prepare("SELECT password_hash FROM admin_credentials WHERE id = 1")
      .get() as AdminRow | undefined;
    return row?.password_hash ?? null;
  }

  public updateAdminPassword(passwordHash: string): void {
    const result = this.database
      .prepare(
        "UPDATE admin_credentials SET password_hash = ?, created_at = ? WHERE id = 1"
      )
      .run(passwordHash, new Date().toISOString());
    if (result.changes !== 1) {
      throw new Error("Administrator setup has not been completed");
    }
  }

  public createSession(tokenHash: string, expiresAt: string): void {
    this.database
      .prepare(
        "INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)"
      )
      .run(tokenHash, expiresAt, new Date().toISOString());
  }

  public getSessionExpiry(tokenHash: string): string | null {
    const row = this.database
      .prepare("SELECT expires_at FROM sessions WHERE token_hash = ?")
      .get(tokenHash) as SessionRow | undefined;
    if (!row) {
      return null;
    }
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.deleteSession(tokenHash);
      return null;
    }
    return row.expires_at;
  }

  public deleteSession(tokenHash: string): void {
    this.database
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(tokenHash);
  }

  public deleteAllSessions(): void {
    this.database.prepare("DELETE FROM sessions").run();
  }

  public getLlmConfiguration(): StoredLlmConfiguration {
    const rows = this.database
      .prepare(
        "SELECT key, value FROM app_settings WHERE key LIKE 'llm.%' ORDER BY key"
      )
      .all() as SettingRow[];
    const settings = new Map(rows.map((row) => [row.key, row.value]));
    return {
      mode: llmMode(settings.get("llm.mode")),
      endpoint: settings.get("llm.endpoint") ?? "",
      deployment: settings.get("llm.deployment") ?? "",
      apiVersion: settings.get("llm.apiVersion") ?? "2024-10-21",
      baseUrl: settings.get("llm.baseUrl") ?? "",
      model: settings.get("llm.model") ?? "qwen-plus",
      timeoutMs: positiveInteger(settings.get("llm.timeoutMs"), 30_000),
      maxOutputTokens: positiveInteger(
        settings.get("llm.maxOutputTokens"),
        1_024
      ),
      apiKey: settings.get("llm.apiKey") ?? null
    };
  }

  public updateLlmConfiguration(input: {
    mode: LlmMode;
    endpoint: string;
    deployment: string;
    apiVersion: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    maxOutputTokens: number;
    apiKey?: string;
    clearApiKey?: boolean;
  }): StoredLlmConfiguration {
    this.database.transaction(() => {
      this.setSetting("llm.mode", input.mode);
      this.setSetting("llm.endpoint", input.endpoint);
      this.setSetting("llm.deployment", input.deployment);
      this.setSetting("llm.apiVersion", input.apiVersion);
      this.setSetting("llm.baseUrl", input.baseUrl);
      this.setSetting("llm.model", input.model);
      this.setSetting("llm.timeoutMs", String(input.timeoutMs));
      this.setSetting("llm.maxOutputTokens", String(input.maxOutputTokens));
      if (input.clearApiKey) {
        this.database
          .prepare("DELETE FROM app_settings WHERE key = 'llm.apiKey'")
          .run();
      } else if (input.apiKey !== undefined) {
        this.setSetting("llm.apiKey", input.apiKey);
      }
    })();
    return this.getLlmConfiguration();
  }

  public getSpeechConfiguration(): StoredSpeechConfiguration {
    const rows = this.database
      .prepare(
        "SELECT key, value FROM app_settings WHERE key LIKE 'speech.%' ORDER BY key"
      )
      .all() as SettingRow[];
    const settings = new Map(rows.map((row) => [row.key, row.value]));
    // Legacy shared values remain readable so existing installations can
    // migrate without losing configured credentials.
    const legacyEndpoint = settings.get("speech.endpoint") ?? "";
    const legacyApiKey = settings.get("speech.apiKey") ?? null;
    const ttsMode = providerMode(settings.get("speech.ttsMode"));
    const ttsDeployment = settings.get("speech.ttsDeployment") ?? "";
    const configuredTtsVoice = settings.get("speech.ttsVoice") ?? "coral";
    // VoxMesh briefly suggested a Flash-only voice for the Plus model.
    // Preserve other custom voices while correcting that exact invalid pair.
    const ttsVoice =
      ttsMode === "alibaba-model-studio" &&
      ttsDeployment === "qwen-audio-3.0-tts-plus" &&
      configuredTtsVoice === "longanlingxi"
        ? "longanlingxin"
        : configuredTtsVoice;
    return {
      sttMode: providerMode(settings.get("speech.sttMode")),
      ttsMode,
      sttEndpoint: settings.get("speech.sttEndpoint") ?? legacyEndpoint,
      sttDeployment: settings.get("speech.sttDeployment") ?? "",
      sttApiVersion:
        settings.get("speech.sttApiVersion") ?? "2025-04-01-preview",
      sttLanguage: settings.get("speech.sttLanguage") ?? "zh",
      sttApiKey: settings.get("speech.sttApiKey") ?? legacyApiKey,
      ttsEndpoint: settings.get("speech.ttsEndpoint") ?? legacyEndpoint,
      ttsDeployment,
      ttsApiVersion:
        settings.get("speech.ttsApiVersion") ?? "2025-03-01-preview",
      ttsVoice,
      ttsInstructions:
        settings.get("speech.ttsInstructions") ??
        "Speak clearly and naturally.",
      ttsApiKey: settings.get("speech.ttsApiKey") ?? legacyApiKey
    };
  }

  public updateSpeechConfiguration(input: {
    sttMode: SpeechProviderMode;
    ttsMode: SpeechProviderMode;
    sttEndpoint: string;
    sttDeployment: string;
    sttApiVersion: string;
    sttLanguage: string;
    sttApiKey?: string;
    clearSttApiKey?: boolean;
    ttsEndpoint: string;
    ttsDeployment: string;
    ttsApiVersion: string;
    ttsVoice: string;
    ttsInstructions: string;
    ttsApiKey?: string;
    clearTtsApiKey?: boolean;
  }): StoredSpeechConfiguration {
    this.database.transaction(() => {
      this.setSetting("speech.sttMode", input.sttMode);
      this.setSetting("speech.ttsMode", input.ttsMode);
      this.setSetting("speech.sttEndpoint", input.sttEndpoint);
      this.setSetting("speech.sttDeployment", input.sttDeployment);
      this.setSetting("speech.sttApiVersion", input.sttApiVersion);
      this.setSetting("speech.sttLanguage", input.sttLanguage);
      if (input.clearSttApiKey) {
        this.database
          .prepare("DELETE FROM app_settings WHERE key = 'speech.sttApiKey'")
          .run();
      } else if (input.sttApiKey !== undefined) {
        this.setSetting("speech.sttApiKey", input.sttApiKey);
      }
      this.setSetting("speech.ttsEndpoint", input.ttsEndpoint);
      this.setSetting("speech.ttsDeployment", input.ttsDeployment);
      this.setSetting("speech.ttsApiVersion", input.ttsApiVersion);
      this.setSetting("speech.ttsVoice", input.ttsVoice);
      this.setSetting("speech.ttsInstructions", input.ttsInstructions);
      if (input.clearTtsApiKey) {
        this.database
          .prepare("DELETE FROM app_settings WHERE key = 'speech.ttsApiKey'")
          .run();
      } else if (input.ttsApiKey !== undefined) {
        this.setSetting("speech.ttsApiKey", input.ttsApiKey);
      }
    })();
    return this.getSpeechConfiguration();
  }

  public getVoicePipelineConfiguration(): StoredVoicePipelineConfiguration {
    const rows = this.database
      .prepare(
        "SELECT key, value FROM app_settings WHERE key LIKE 'voice.%' ORDER BY key"
      )
      .all() as SettingRow[];
    const settings = new Map(rows.map((row) => [row.key, row.value]));
    return {
      mode:
        settings.get("voice.mode") === "native-multimodal"
          ? "native-multimodal"
          : "composed",
      nativeProviderId: settings.get("voice.nativeProviderId") ?? "mock-native"
    };
  }

  public updateVoicePipelineConfiguration(
    input: StoredVoicePipelineConfiguration
  ): StoredVoicePipelineConfiguration {
    this.database.transaction(() => {
      this.setSetting("voice.mode", input.mode);
      this.setSetting("voice.nativeProviderId", input.nativeProviderId);
    })();
    return this.getVoicePipelineConfiguration();
  }

  public createConversation(userMessage: string): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    const title =
      userMessage.length > 64 ? `${userMessage.slice(0, 61)}...` : userMessage;
    this.database.transaction(() => {
      this.database
        .prepare(
          "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
        )
        .run(id, title, now, now);
      this.addMessage(id, "user", userMessage);
    })();
    return id;
  }

  public addMessage(
    conversationId: string,
    role: MessageRole,
    content: string
  ): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(randomUUID(), conversationId, role, content, now);
    this.database
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(now, conversationId);
  }

  public listConversations(): ConversationSummary[] {
    const rows = this.database
      .prepare(
        `SELECT c.id, c.title, COUNT(m.id) AS message_count,
                c.created_at, c.updated_at
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         GROUP BY c.id
         ORDER BY c.updated_at DESC`
      )
      .all() as ConversationRow[];
    return rows.map(mapConversation);
  }

  public getConversation(id: string): ConversationDetail | null {
    const row = this.database
      .prepare(
        `SELECT c.id, c.title, COUNT(m.id) AS message_count,
                c.created_at, c.updated_at
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.id = ?
         GROUP BY c.id`
      )
      .get(id) as ConversationRow | undefined;
    if (!row) {
      return null;
    }
    const messages = this.database
      .prepare(
        "SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid"
      )
      .all(id) as MessageRow[];
    const events = this.database
      .prepare(
        "SELECT id, stage, status, message, created_at FROM conversation_events WHERE conversation_id = ? ORDER BY created_at, rowid"
      )
      .all(id) as PipelineEventRow[];
    return {
      ...mapConversation(row),
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at
      })),
      events: events.map(mapPipelineEvent)
    };
  }

  public addPipelineEvent(input: {
    conversationId: string;
    stage: PipelineStage;
    status: PipelineStatus;
    message: string;
  }): void {
    this.database
      .prepare(
        "INSERT INTO conversation_events (id, conversation_id, stage, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        randomUUID(),
        input.conversationId,
        input.stage,
        input.status,
        input.message,
        new Date().toISOString()
      );
  }

  public addLog(input: {
    category: LogCategory;
    level: LogLevel;
    message: string;
    conversationId?: string;
  }): void {
    this.database
      .prepare(
        "INSERT INTO logs (id, category, level, message, conversation_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        randomUUID(),
        input.category,
        input.level,
        input.message,
        input.conversationId ?? null,
        new Date().toISOString()
      );
  }

  public listLogs(limit = 200): LogEntry[] {
    const rows = this.database
      .prepare(
        "SELECT id, category, level, message, conversation_id, created_at FROM logs ORDER BY created_at DESC, rowid DESC LIMIT ?"
      )
      .all(limit) as LogRow[];
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      level: row.level,
      message: row.message,
      conversationId: row.conversation_id,
      createdAt: row.created_at
    }));
  }

  public conversationCount(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM conversations")
      .get() as CountRow;
    return row.count;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS admin_credentials (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        stage TEXT NOT NULL CHECK (stage IN ('STT', 'AGENT', 'MCP', 'TTS')),
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private setSetting(key: string, value: string): void {
    this.database
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, new Date().toISOString());
  }
}

function mapConversation(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPipelineEvent(row: PipelineEventRow): PipelineEvent {
  return {
    id: row.id,
    stage: row.stage,
    status: row.status,
    message: row.message,
    createdAt: row.created_at
  };
}

function providerMode(value: string | undefined): SpeechProviderMode {
  if (
    value === "azure-openai" ||
    value === "openai-compatible" ||
    value === "alibaba-model-studio"
  ) {
    return value;
  }
  return "mock";
}

function llmMode(value: string | undefined): LlmMode {
  if (value === "azure-openai" || value === "openai-compatible") {
    return value;
  }
  return "mock";
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
