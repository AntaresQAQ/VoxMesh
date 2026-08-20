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
  ModelDeploymentInput,
  PipelineEvent,
  PipelineStage,
  PipelineStatus,
  ProviderConnectionInput,
  RuntimeRouteSummary,
  RuntimeRouteInput,
  RuntimeRoutingSummary,
  SpeechProviderMode,
  VoicePipelineMode
} from "@voxmesh/shared";

import {
  RuntimeRoutingStore,
  type RuntimeRouteVerificationSnapshot
} from "./runtime-routing-store.js";

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
  routeId?: string;
  fallbackRouteId?: string | null;
}

const DEFAULT_LLM_CONFIGURATION: StoredLlmConfiguration = {
  mode: "mock",
  endpoint: "",
  deployment: "",
  apiVersion: "",
  baseUrl: "",
  model: "Mock Chat",
  timeoutMs: 30_000,
  maxOutputTokens: 1_024,
  apiKey: null
};

const DEFAULT_SPEECH_CONFIGURATION: StoredSpeechConfiguration = {
  sttMode: "mock",
  ttsMode: "mock",
  sttEndpoint: "",
  sttDeployment: "Mock STT",
  sttApiVersion: "",
  sttLanguage: "en",
  sttApiKey: null,
  ttsEndpoint: "",
  ttsDeployment: "Mock TTS",
  ttsApiVersion: "",
  ttsVoice: "mock",
  ttsInstructions: "",
  ttsApiKey: null
};

const DEFAULT_VOICE_CONFIGURATION: StoredVoicePipelineConfiguration = {
  mode: "composed",
  nativeProviderId: "mock-native"
};

export class VoxMeshStore {
  private readonly database: Database.Database;
  private readonly runtimeRouting: RuntimeRoutingStore;

  public constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.database = new Database(path);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.migrate();
    this.runtimeRouting = new RuntimeRoutingStore(this.database);
    this.runtimeRouting.initializeDefaults();
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

  /** Returns the migrated connection, model, and route records without secrets. */
  public getRuntimeRoutingSummary(): RuntimeRoutingSummary {
    return this.runtimeRouting.getSummary();
  }

  public createRuntimeConnection(
    input: ProviderConnectionInput
  ): RuntimeRoutingSummary {
    return this.runtimeRouting.createConnection(input);
  }

  public updateRuntimeConnection(
    id: string,
    input: ProviderConnectionInput
  ): RuntimeRoutingSummary {
    return this.runtimeRouting.updateConnection(id, input);
  }

  public deleteRuntimeConnection(id: string): RuntimeRoutingSummary {
    return this.runtimeRouting.deleteConnection(id);
  }

  public createRuntimeModel(
    input: ModelDeploymentInput
  ): RuntimeRoutingSummary {
    return this.runtimeRouting.createModel(input);
  }

  public updateRuntimeModel(
    id: string,
    input: ModelDeploymentInput
  ): RuntimeRoutingSummary {
    return this.runtimeRouting.updateModel(id, input);
  }

  public deleteRuntimeModel(id: string): RuntimeRoutingSummary {
    return this.runtimeRouting.deleteModel(id);
  }

  public createRuntimeRoute(input: RuntimeRouteInput): RuntimeRoutingSummary {
    return this.runtimeRouting.createRoute(input);
  }

  public updateRuntimeRoute(
    id: string,
    input: RuntimeRouteInput
  ): RuntimeRoutingSummary {
    return this.runtimeRouting.updateRoute(id, input);
  }

  public deleteRuntimeRoute(id: string): RuntimeRoutingSummary {
    return this.runtimeRouting.deleteRoute(id);
  }

  public activateRuntimeRoute(id: string): RuntimeRoutingSummary {
    return this.runtimeRouting.activateRoute(id);
  }

  /** Resolves the Chat provider from routing records. */
  public getRuntimeLlmConfiguration(routeId?: string): StoredLlmConfiguration {
    return this.runtimeRouting.resolveLlm(DEFAULT_LLM_CONFIGURATION, routeId);
  }

  /** Resolves STT and TTS from routing records. */
  public getRuntimeSpeechConfiguration(
    routeId?: string
  ): StoredSpeechConfiguration {
    return this.runtimeRouting.resolveSpeech(
      DEFAULT_SPEECH_CONFIGURATION,
      routeId
    );
  }

  /** Resolves the selected pipeline mode through the active runtime route. */
  public getRuntimeVoicePipelineConfiguration(): StoredVoicePipelineConfiguration {
    return this.runtimeRouting.resolveVoice(DEFAULT_VOICE_CONFIGURATION);
  }

  public getRuntimeVoiceRouteConfiguration(
    routeId: string
  ): StoredVoicePipelineConfiguration {
    return this.runtimeRouting.resolveVoice(
      DEFAULT_VOICE_CONFIGURATION,
      routeId
    );
  }

  public getRuntimeRoute(id: string): RuntimeRouteSummary {
    return this.runtimeRouting.getRouteSummary(id);
  }

  public captureRuntimeRouteVerification(
    id: string
  ): RuntimeRouteVerificationSnapshot {
    return this.runtimeRouting.captureRouteVerification(id);
  }

  public markRuntimeRouteVerified(
    snapshot: RuntimeRouteVerificationSnapshot
  ): void {
    this.runtimeRouting.markRouteVerified(snapshot);
  }

  public createConversation(userMessage: string): string {
    let id = "";
    this.database.transaction(() => {
      id = this.createPendingConversation(conversationTitle(userMessage));
      this.addMessage(id, "user", userMessage);
    })();
    return id;
  }

  /** Creates a conversation record before a provider produces user text. */
  public createPendingConversation(title: string): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(id, title, now, now);
    return id;
  }

  public updateConversationTitle(
    conversationId: string,
    userMessage: string
  ): void {
    this.database
      .prepare("UPDATE conversations SET title = ? WHERE id = ?")
      .run(conversationTitle(userMessage), conversationId);
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

      CREATE TABLE IF NOT EXISTS provider_connections (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        api_key TEXT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_deployments (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE RESTRICT,
        display_name TEXT NOT NULL,
        model_name TEXT NOT NULL,
        api_version TEXT NOT NULL,
        declared_capabilities TEXT NOT NULL,
        verified_capabilities TEXT NOT NULL,
        provider_options TEXT NOT NULL,
        configuration_fingerprint TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_routes (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('composed', 'native-multimodal')),
        stt_model_deployment_id TEXT REFERENCES model_deployments(id) ON DELETE RESTRICT,
        chat_model_deployment_id TEXT REFERENCES model_deployments(id) ON DELETE RESTRICT,
        tts_model_deployment_id TEXT REFERENCES model_deployments(id) ON DELETE RESTRICT,
        native_model_deployment_id TEXT REFERENCES model_deployments(id) ON DELETE RESTRICT,
        fallback_route_id TEXT REFERENCES runtime_routes(id) ON DELETE RESTRICT,
        stt_streaming_enabled INTEGER NOT NULL DEFAULT 0 CHECK (stt_streaming_enabled IN (0, 1)),
        tts_streaming_enabled INTEGER NOT NULL DEFAULT 0 CHECK (tts_streaming_enabled IN (0, 1)),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS active_runtime_route (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_route_id TEXT NOT NULL REFERENCES runtime_routes(id) ON DELETE RESTRICT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_routing_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        initialized INTEGER NOT NULL CHECK (initialized IN (0, 1))
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
    this.ensureColumn(
      "provider_connections",
      "enabled",
      "INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))"
    );
    this.ensureColumn(
      "model_deployments",
      "enabled",
      "INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))"
    );
    this.ensureColumn(
      "runtime_routes",
      "stt_streaming_enabled",
      "INTEGER NOT NULL DEFAULT 0 CHECK (stt_streaming_enabled IN (0, 1))"
    );
    this.ensureColumn(
      "runtime_routes",
      "tts_streaming_enabled",
      "INTEGER NOT NULL DEFAULT 0 CHECK (tts_streaming_enabled IN (0, 1))"
    );
    this.ensureColumn(
      "runtime_routes",
      "enabled",
      "INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))"
    );
  }

  private ensureColumn(
    table: string,
    column: string,
    definition: string
  ): void {
    const columns = this.database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.database.exec(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
      );
    }
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

function conversationTitle(message: string): string {
  return message.length > 64 ? `${message.slice(0, 61)}...` : message;
}
