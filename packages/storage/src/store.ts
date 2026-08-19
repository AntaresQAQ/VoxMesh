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
  PipelineStatus
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
  apiKey: string | null;
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
    const mode = settings.get("llm.mode");
    return {
      mode: mode === "azure-openai" ? "azure-openai" : "mock",
      endpoint: settings.get("llm.endpoint") ?? "",
      deployment: settings.get("llm.deployment") ?? "",
      apiVersion: settings.get("llm.apiVersion") ?? "2024-10-21",
      apiKey: settings.get("llm.apiKey") ?? null
    };
  }

  public updateLlmConfiguration(input: {
    mode: LlmMode;
    endpoint: string;
    deployment: string;
    apiVersion: string;
    apiKey?: string;
    clearApiKey?: boolean;
  }): StoredLlmConfiguration {
    this.database.transaction(() => {
      this.setSetting("llm.mode", input.mode);
      this.setSetting("llm.endpoint", input.endpoint);
      this.setSetting("llm.deployment", input.deployment);
      this.setSetting("llm.apiVersion", input.apiVersion);
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
