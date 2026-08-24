import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import type {
  AgentMessage,
  ConversationDetail,
  ConversationRun,
  ConversationRunKind,
  ConversationRunStatus,
  ConversationSummary,
  LogCategory,
  LogEntry,
  LogLevel,
  LlmMode,
  MessageRole,
  Message,
  ModelDeploymentInput,
  PipelineEvent,
  PipelineStage,
  PipelineStatus,
  ProviderConnectionInput,
  NormalizedRuntimeRouteInput,
  RuntimeRouteSummary,
  RuntimeRouteInput,
  RuntimeRoutingSummary,
  SpeechProviderMode,
  StreamingRuntimeAvailability,
  VoicePipelineMode
} from "@voxmesh/shared";

import {
  RuntimeRoutingStore,
  type RuntimeReadinessError,
  type RuntimeRouteReadinessTest,
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
  run_id: string | null;
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
  run_id: string | null;
  correlation_id: string | null;
  stage: PipelineStage;
  status: PipelineStatus;
  duration_ms: number | null;
  message: string;
  created_at: string;
}

interface ConversationRunRow {
  id: string;
  conversation_id: string;
  kind: ConversationRunKind;
  status: ConversationRunStatus;
  correlation_id: string;
  input_message_id: string | null;
  retry_of_run_id: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
}

interface LocalDatabaseLease {
  ownerId: string;
  references: number;
}

const localDatabaseLeases = new Map<string, LocalDatabaseLease>();
const OWNER_HEARTBEAT_MS = 5_000;
const OWNER_STALE_MS = 30_000;
const MAX_CHAT_HISTORY_MESSAGES = 32;
const MAX_CHAT_HISTORY_CHARACTERS = 24_000;

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

export interface StoredChatContext {
  inputMessage: string;
  history: AgentMessage[];
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

export type StorageObservabilityEvent =
  | { type: "log.created"; log: LogEntry }
  | { type: "run.created"; run: ConversationRun }
  | { type: "run.updated"; run: ConversationRun }
  | {
      type: "message.created";
      conversationId: string;
      message: Message;
    }
  | {
      type: "pipeline.created";
      conversationId: string;
      event: PipelineEvent;
    };

export class VoxMeshStore {
  private readonly database: Database.Database;
  private readonly runtimeRouting: RuntimeRoutingStore;
  private readonly leaseKey: string;
  private readonly ownerId: string;
  private ownershipHeartbeat: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly observabilityListeners = new Set<
    (event: StorageObservabilityEvent) => void
  >();

  public constructor(
    path: string,
    streamingAvailability?: StreamingRuntimeAvailability
  ) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    const database = new Database(path);
    const lease = acquireLocalDatabaseLease(path);
    this.leaseKey = lease.key;
    this.ownerId = lease.ownerId;
    this.database = database;
    let ownershipClaimed = false;
    try {
      this.database.pragma("journal_mode = WAL");
      this.database.pragma("foreign_keys = ON");
      this.bootstrapProcessOwner();
      ownershipClaimed = this.claimDatabaseOwnership();
      this.migrate();
      if (ownershipClaimed) {
        this.reconcileInterruptedRuns();
      }
      this.runtimeRouting = new RuntimeRoutingStore(
        this.database,
        streamingAvailability
      );
      this.runtimeRouting.initializeDefaults();
      if (ownershipClaimed) {
        this.runtimeRouting.reconcileInterruptedReadinessTests();
      }
      this.startOwnershipHeartbeat();
    } catch (error) {
      const lastLease = releaseLocalDatabaseLease(this.leaseKey);
      if (ownershipClaimed && lastLease) {
        this.releaseDatabaseOwnership();
      }
      this.database.close();
      throw error;
    }
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ownershipHeartbeat) {
      clearInterval(this.ownershipHeartbeat);
      this.ownershipHeartbeat = null;
    }
    if (releaseLocalDatabaseLease(this.leaseKey)) {
      this.releaseDatabaseOwnership();
    }
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
    return this.runtimeRouting.createRoute(normalizeRuntimeRouteInput(input));
  }

  public updateRuntimeRoute(
    id: string,
    input: RuntimeRouteInput
  ): RuntimeRoutingSummary {
    return this.runtimeRouting.updateRoute(
      id,
      normalizeRuntimeRouteInput(input)
    );
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

  public beginRuntimeRouteReadinessTest(
    snapshot: RuntimeRouteVerificationSnapshot
  ): RuntimeRouteReadinessTest {
    return this.runtimeRouting.beginRouteReadinessTest(snapshot);
  }

  public beginRuntimeConnectionReadinessTest(
    test: RuntimeRouteReadinessTest,
    role: "stt" | "chat" | "tts" | "native"
  ): void {
    this.runtimeRouting.beginConnectionReadinessTest(test, role);
  }

  public markRuntimeConnectionReadinessReady(
    test: RuntimeRouteReadinessTest,
    role: "stt" | "chat" | "tts" | "native"
  ): void {
    this.runtimeRouting.markConnectionReadinessReady(test, role);
  }

  public markRuntimeConnectionReadinessFailed(
    test: RuntimeRouteReadinessTest,
    role: "stt" | "chat" | "tts" | "native",
    error: RuntimeReadinessError
  ): void {
    this.runtimeRouting.markConnectionReadinessFailed(test, role, error);
  }

  public markRuntimeRouteReadinessReady(test: RuntimeRouteReadinessTest): void {
    this.runtimeRouting.markRouteReadinessReady(test);
  }

  public markRuntimeRouteReadinessFailed(
    test: RuntimeRouteReadinessTest,
    error: RuntimeReadinessError
  ): void {
    this.runtimeRouting.markRouteReadinessFailed(test, error);
  }

  public createConversation(userMessage: string): string {
    const result = this.database.transaction(() => {
      const conversationId = this.createPendingConversation(
        conversationTitle(userMessage)
      );
      const message = this.insertMessage(
        conversationId,
        "user",
        userMessage,
        null,
        new Date().toISOString()
      );
      return { conversationId, message };
    })();
    this.emitObservabilityEvent({
      type: "message.created",
      conversationId: result.conversationId,
      message: result.message
    });
    return result.conversationId;
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

  public createChatRun(
    runId: string,
    userMessage: string,
    existingConversationId?: string
  ): ConversationRun {
    const conversationId = existingConversationId ?? randomUUID();
    const correlationId = randomUUID();
    const startedAt = new Date().toISOString();
    const create = this.database.transaction(() => {
      if (existingConversationId) {
        this.requireConversation(existingConversationId);
        this.requireNoActiveRun(existingConversationId);
      } else {
        this.database
          .prepare(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
          )
          .run(
            conversationId,
            conversationTitle(userMessage),
            startedAt,
            startedAt
          );
      }
      const inserted = this.database
        .prepare(
          `INSERT INTO conversation_runs (
             id, conversation_id, kind, status, correlation_id,
             input_message_id, retry_of_run_id, started_at, completed_at,
             duration_ms, error_code
           ) VALUES (?, ?, 'chat', 'in_progress', ?, NULL, NULL, ?, NULL, NULL, NULL)
           ON CONFLICT(id) DO NOTHING`
        )
        .run(runId, conversationId, correlationId, startedAt);
      if (inserted.changes !== 1) {
        throw Object.assign(new Error("Conversation run ID already exists"), {
          statusCode: 409
        });
      }
      const message = this.insertMessage(
        conversationId,
        "user",
        userMessage,
        runId,
        startedAt
      );
      this.database
        .prepare(
          "UPDATE conversation_runs SET input_message_id = ? WHERE id = ?"
        )
        .run(message.id, runId);
      const run = this.getConversationRun(runId);
      const event = this.insertPipelineEvent({
        conversationId,
        runId,
        correlationId,
        stage: "AGENT",
        status: "started",
        message: "Agent run started",
        durationMs: null
      });
      return { run, message, event };
    });
    const { run, message, event } = create.immediate();
    this.emitObservabilityEvent({ type: "run.created", run });
    this.emitObservabilityEvent({
      type: "message.created",
      conversationId,
      message
    });
    this.emitObservabilityEvent({
      type: "pipeline.created",
      conversationId,
      event
    });
    return run;
  }

  public createChatRetry(runId: string, retryOfRunId: string): ConversationRun {
    const correlationId = randomUUID();
    const startedAt = new Date().toISOString();
    const create = this.database.transaction(() => {
      const source = this.getConversationRun(retryOfRunId);
      if (source.status !== "failed" && source.status !== "cancelled") {
        throw conflict("Only failed or cancelled runs can be retried");
      }
      if (!source.inputMessageId) {
        throw conflict("Conversation run has no retryable input message");
      }
      this.requireLatestRetryableAttempt(source);
      this.requireNoActiveRun(source.conversationId);
      const inserted = this.database
        .prepare(
          `INSERT INTO conversation_runs (
             id, conversation_id, kind, status, correlation_id,
             input_message_id, retry_of_run_id, started_at, completed_at,
             duration_ms, error_code
           ) VALUES (?, ?, 'chat', 'in_progress', ?, ?, ?, ?, NULL, NULL, NULL)
           ON CONFLICT(id) DO NOTHING`
        )
        .run(
          runId,
          source.conversationId,
          correlationId,
          source.inputMessageId,
          source.id,
          startedAt
        );
      if (inserted.changes !== 1) {
        throw conflict("Conversation run ID already exists");
      }
      this.database
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(startedAt, source.conversationId);
      const run = this.getConversationRun(runId);
      const event = this.insertPipelineEvent({
        conversationId: source.conversationId,
        runId,
        correlationId,
        stage: "AGENT",
        status: "started",
        message: "Agent retry started",
        durationMs: null
      });
      return { run, event };
    });
    const { run, event } = create.immediate();
    this.emitObservabilityEvent({ type: "run.created", run });
    this.emitObservabilityEvent({
      type: "pipeline.created",
      conversationId: run.conversationId,
      event
    });
    return run;
  }

  public getConversationRun(runId: string): ConversationRun {
    const row = this.database
      .prepare(
        `SELECT id, conversation_id, kind, status, correlation_id,
                input_message_id, retry_of_run_id, started_at, completed_at,
                duration_ms, error_code
         FROM conversation_runs WHERE id = ?`
      )
      .get(runId) as ConversationRunRow | undefined;
    if (!row) throw notFound("Conversation run was not found");
    return mapConversationRun(row);
  }

  public listConversationRuns(conversationId: string): ConversationRun[] {
    return (
      this.database
        .prepare(
          `SELECT id, conversation_id, kind, status, correlation_id,
                  input_message_id, retry_of_run_id, started_at, completed_at,
                  duration_ms, error_code
           FROM conversation_runs
           WHERE conversation_id = ?
           ORDER BY started_at, rowid`
        )
        .all(conversationId) as ConversationRunRow[]
    ).map(mapConversationRun);
  }

  public getChatContext(runId: string): StoredChatContext {
    const run = this.getConversationRun(runId);
    if (!run.inputMessageId) {
      throw new Error("Conversation run has no input message");
    }
    const input = this.database
      .prepare(
        `SELECT content
         FROM messages
         WHERE id = ? AND conversation_id = ? AND role = 'user'`
      )
      .get(run.inputMessageId, run.conversationId) as
      { content: string } | undefined;
    if (!input) throw new Error("Conversation run input message was not found");
    const recentHistory = this.database
      .prepare(
        `SELECT role, content
         FROM messages
         WHERE conversation_id = ?
           AND role IN ('user', 'assistant')
           AND rowid < (SELECT rowid FROM messages WHERE id = ?)
         ORDER BY rowid DESC
         LIMIT ?`
      )
      .all(
        run.conversationId,
        run.inputMessageId,
        MAX_CHAT_HISTORY_MESSAGES * 2
      ) as Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    return {
      inputMessage: input.content,
      history: selectChatHistory(recentHistory)
    };
  }

  public completeChatRun(input: {
    runId: string;
    messages: Array<{ role: MessageRole; content: string }>;
    events: Array<{
      category: LogCategory;
      level: LogLevel;
      message: string;
    }>;
  }): { run: ConversationRun; transitioned: boolean } {
    return this.finalizeChatRun({
      runId: input.runId,
      status: "completed",
      errorCode: null,
      terminalMessage: "Agent run completed",
      messages: input.messages,
      events: input.events
    });
  }

  public failChatRun(
    runId: string,
    errorCode: string,
    message: string
  ): { run: ConversationRun; transitioned: boolean } {
    return this.finalizeChatRun({
      runId,
      status: "failed",
      errorCode,
      terminalMessage: message,
      messages: [],
      events: [{ category: "ERROR", level: "ERROR", message }]
    });
  }

  public cancelChatRun(runId: string): {
    run: ConversationRun;
    transitioned: boolean;
  } {
    return this.finalizeChatRun({
      runId,
      status: "cancelled",
      errorCode: "RUN_CANCELLED",
      terminalMessage: "Agent run cancelled",
      messages: [],
      events: [
        {
          category: "AGENT",
          level: "WARN",
          message: "Agent run cancelled"
        }
      ]
    });
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
    content: string,
    runId: string | null = null
  ): Message {
    const message = this.insertMessage(
      conversationId,
      role,
      content,
      runId,
      new Date().toISOString()
    );
    this.emitObservabilityEvent({
      type: "message.created",
      conversationId,
      message
    });
    return message;
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
        "SELECT id, role, run_id, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid"
      )
      .all(id) as MessageRow[];
    const events = this.database
      .prepare(
        `SELECT id, run_id, correlation_id, stage, status, duration_ms,
                message, created_at
         FROM conversation_events
         WHERE conversation_id = ?
         ORDER BY created_at, rowid`
      )
      .all(id) as PipelineEventRow[];
    return {
      ...mapConversation(row),
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        runId: message.run_id,
        content: message.content,
        createdAt: message.created_at
      })),
      events: events.map(mapPipelineEvent),
      runs: this.listConversationRuns(id)
    };
  }

  public addPipelineEvent(input: {
    conversationId: string;
    runId?: string | null;
    correlationId?: string | null;
    stage: PipelineStage;
    status: PipelineStatus;
    durationMs?: number | null;
    message: string;
  }): void {
    const event = this.insertPipelineEvent({
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      correlationId: input.correlationId ?? null,
      stage: input.stage,
      status: input.status,
      durationMs: input.durationMs ?? null,
      message: input.message
    });
    this.emitObservabilityEvent({
      type: "pipeline.created",
      conversationId: input.conversationId,
      event
    });
  }

  public addLog(input: {
    category: LogCategory;
    level: LogLevel;
    message: string;
    conversationId?: string;
  }): void {
    const log = this.insertLog({
      category: input.category,
      level: input.level,
      message: input.message,
      conversationId: input.conversationId ?? null
    });
    this.emitObservabilityEvent({ type: "log.created", log });
  }

  /**
   * Subscribes to already-persisted safe observability events.
   *
   * Listener failures are isolated from successful database writes.
   */
  public subscribeObservability(
    listener: (event: StorageObservabilityEvent) => void
  ): () => void {
    this.observabilityListeners.add(listener);
    return () => this.observabilityListeners.delete(listener);
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

  private requireConversation(conversationId: string): void {
    const row = this.database
      .prepare("SELECT 1 FROM conversations WHERE id = ?")
      .get(conversationId);
    if (!row) throw notFound("Conversation was not found");
  }

  private requireNoActiveRun(conversationId: string): void {
    const row = this.database
      .prepare(
        `SELECT 1 FROM conversation_runs
         WHERE conversation_id = ? AND status = 'in_progress'`
      )
      .get(conversationId);
    if (row) throw conflict("Conversation already has an active run");
  }

  private requireLatestRetryableAttempt(source: ConversationRun): void {
    const latestInput = this.database
      .prepare(
        `SELECT id FROM messages
         WHERE conversation_id = ? AND role = 'user'
         ORDER BY rowid DESC
         LIMIT 1`
      )
      .get(source.conversationId) as { id: string } | undefined;
    if (latestInput?.id !== source.inputMessageId) {
      throw conflict("Only the latest conversation turn can be retried");
    }
    const latestAttempt = this.database
      .prepare(
        `SELECT id FROM conversation_runs
         WHERE input_message_id = ?
         ORDER BY started_at DESC, rowid DESC
         LIMIT 1`
      )
      .get(source.inputMessageId) as { id: string } | undefined;
    if (latestAttempt?.id !== source.id) {
      throw conflict("Only the latest attempt can be retried");
    }
  }

  private finalizeChatRun(input: {
    runId: string;
    status: Exclude<ConversationRunStatus, "in_progress">;
    errorCode: string | null;
    terminalMessage: string;
    messages: Array<{ role: MessageRole; content: string }>;
    events: Array<{
      category: LogCategory;
      level: LogLevel;
      message: string;
    }>;
  }): { run: ConversationRun; transitioned: boolean } {
    const emittedMessages: Message[] = [];
    const emittedLogs: LogEntry[] = [];
    const emittedEvents: PipelineEvent[] = [];
    let transitioned = false;
    let run: ConversationRun | undefined;
    this.database.transaction(() => {
      const current = this.getConversationRun(input.runId);
      if (current.status !== "in_progress") {
        run = current;
        return;
      }
      const completedAt = new Date().toISOString();
      const durationMs = Math.max(
        0,
        Date.parse(completedAt) - Date.parse(current.startedAt)
      );
      const update = this.database
        .prepare(
          `UPDATE conversation_runs
           SET status = ?, completed_at = ?, duration_ms = ?, error_code = ?
           WHERE id = ? AND status = 'in_progress'`
        )
        .run(
          input.status,
          completedAt,
          durationMs,
          input.errorCode,
          input.runId
        );
      if (update.changes !== 1) {
        run = this.getConversationRun(input.runId);
        return;
      }
      transitioned = true;
      for (const message of input.messages) {
        emittedMessages.push(
          this.insertMessage(
            current.conversationId,
            message.role,
            message.content,
            current.id,
            completedAt
          )
        );
      }
      for (const event of input.events) {
        emittedLogs.push(
          this.insertLog({
            ...event,
            conversationId: current.conversationId
          })
        );
        if (event.category === "MCP") {
          emittedEvents.push(
            this.insertPipelineEvent({
              conversationId: current.conversationId,
              runId: current.id,
              correlationId: current.correlationId,
              stage: "MCP",
              status: "completed",
              message: event.message,
              durationMs: null
            })
          );
        }
      }
      emittedEvents.push(
        this.insertPipelineEvent({
          conversationId: current.conversationId,
          runId: current.id,
          correlationId: current.correlationId,
          stage: "AGENT",
          status: input.status,
          message: input.terminalMessage,
          durationMs
        })
      );
      this.database
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(completedAt, current.conversationId);
      run = this.getConversationRun(input.runId);
    })();
    if (!run) throw new Error("Conversation run finalization produced no run");
    if (transitioned) {
      this.emitObservabilityEvent({ type: "run.updated", run });
      for (const message of emittedMessages) {
        this.emitObservabilityEvent({
          type: "message.created",
          conversationId: run.conversationId,
          message
        });
      }
      for (const log of emittedLogs) {
        this.emitObservabilityEvent({ type: "log.created", log });
      }
      for (const event of emittedEvents) {
        this.emitObservabilityEvent({
          type: "pipeline.created",
          conversationId: run.conversationId,
          event
        });
      }
    }
    return { run, transitioned };
  }

  private insertMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    runId: string | null,
    createdAt: string
  ): Message {
    const message: Message = {
      id: randomUUID(),
      role,
      runId,
      content,
      createdAt
    };
    this.database
      .prepare(
        `INSERT INTO messages (
           id, conversation_id, run_id, role, content, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        conversationId,
        message.runId,
        message.role,
        message.content,
        message.createdAt
      );
    this.database
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(createdAt, conversationId);
    return message;
  }

  private insertPipelineEvent(input: {
    conversationId: string;
    runId: string | null;
    correlationId: string | null;
    stage: PipelineStage;
    status: PipelineStatus;
    durationMs: number | null;
    message: string;
  }): PipelineEvent {
    const event: PipelineEvent = {
      id: randomUUID(),
      runId: input.runId,
      correlationId: input.correlationId,
      stage: input.stage,
      status: input.status,
      durationMs: input.durationMs,
      message: redactObservabilityText(input.message),
      createdAt: new Date().toISOString()
    };
    this.database
      .prepare(
        `INSERT INTO conversation_events (
           id, conversation_id, run_id, correlation_id, stage, status,
           duration_ms, message, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        input.conversationId,
        event.runId,
        event.correlationId,
        event.stage,
        event.status,
        event.durationMs,
        event.message,
        event.createdAt
      );
    return event;
  }

  private insertLog(input: {
    category: LogCategory;
    level: LogLevel;
    message: string;
    conversationId: string | null;
  }): LogEntry {
    const log: LogEntry = {
      id: randomUUID(),
      category: input.category,
      level: input.level,
      message: redactObservabilityText(input.message),
      conversationId: input.conversationId,
      createdAt: new Date().toISOString()
    };
    this.database
      .prepare(
        "INSERT INTO logs (id, category, level, message, conversation_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        log.id,
        log.category,
        log.level,
        log.message,
        log.conversationId,
        log.createdAt
      );
    return log;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS admin_credentials (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS storage_process_owner (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner_id TEXT NOT NULL,
        process_id INTEGER NOT NULL,
        claimed_at TEXT NOT NULL
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
        run_id TEXT REFERENCES conversation_runs(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('chat', 'voice-composed', 'voice-native')),
        status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled')),
        correlation_id TEXT NOT NULL,
        input_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        retry_of_run_id TEXT REFERENCES conversation_runs(id) ON DELETE SET NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        error_code TEXT
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
        chat_streaming_enabled INTEGER NOT NULL DEFAULT 0 CHECK (chat_streaming_enabled IN (0, 1)),
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

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES conversation_runs(id) ON DELETE SET NULL,
        correlation_id TEXT,
        stage TEXT NOT NULL CHECK (stage IN ('STT', 'AGENT', 'MCP', 'TTS')),
        status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'cancelled')),
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn(
      "messages",
      "run_id",
      "TEXT REFERENCES conversation_runs(id) ON DELETE SET NULL"
    );
    this.migrateConversationEvents();
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversation_runs_conversation
      ON conversation_runs(conversation_id, started_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_runs_active
      ON conversation_runs(conversation_id)
      WHERE status = 'in_progress';
      CREATE INDEX IF NOT EXISTS idx_messages_run
      ON messages(run_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_events_run
      ON conversation_events(run_id, created_at);
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
    this.applyMigration("2026-08-24-full-chain-streaming-routing-v1", () => {
      this.ensureColumn(
        "runtime_routes",
        "stt_streaming_enabled",
        "INTEGER NOT NULL DEFAULT 0 CHECK (stt_streaming_enabled IN (0, 1))"
      );
      this.ensureColumn(
        "runtime_routes",
        "chat_streaming_enabled",
        "INTEGER NOT NULL DEFAULT 0 CHECK (chat_streaming_enabled IN (0, 1))"
      );
      this.ensureColumn(
        "runtime_routes",
        "tts_streaming_enabled",
        "INTEGER NOT NULL DEFAULT 0 CHECK (tts_streaming_enabled IN (0, 1))"
      );
      this.database
        .prepare(
          `UPDATE runtime_routes
           SET stt_streaming_enabled = 0,
               chat_streaming_enabled = 0,
               tts_streaming_enabled = 0,
               updated_at = ?
           WHERE mode = 'native-multimodal'`
        )
        .run(new Date().toISOString());
      const models = this.database
        .prepare(
          `SELECT id, declared_capabilities, verified_capabilities
           FROM model_deployments`
        )
        .all() as Array<{
        id: string;
        declared_capabilities: string;
        verified_capabilities: string;
      }>;
      const update = this.database.prepare(
        `UPDATE model_deployments
         SET declared_capabilities = ?, verified_capabilities = ?, updated_at = ?
         WHERE id = ?`
      );
      const now = new Date().toISOString();
      for (const model of models) {
        const declared = parseStoredCapabilityStrings(
          model.declared_capabilities
        );
        const verified = parseStoredCapabilityStrings(
          model.verified_capabilities
        );
        const nextDeclared = declared.includes("non-streaming")
          ? declared
          : [...declared, "non-streaming"];
        const qualifiedVerified = verified.filter(
          (capability) => capability !== "streaming"
        );
        const nextVerified =
          hasVerifiedBufferedRole(qualifiedVerified) &&
          !qualifiedVerified.includes("non-streaming")
            ? [...qualifiedVerified, "non-streaming"]
            : qualifiedVerified;
        update.run(
          JSON.stringify(nextDeclared),
          JSON.stringify(nextVerified),
          now,
          model.id
        );
      }
    });
    this.ensureColumn(
      "runtime_routes",
      "enabled",
      "INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))"
    );
    this.applyMigration("2026-08-22-provider-readiness-v1", () => {
      for (const table of ["provider_connections", "runtime_routes"]) {
        this.ensureColumn(
          table,
          "readiness_state",
          "TEXT NOT NULL DEFAULT 'unknown' CHECK (readiness_state IN ('unknown', 'testing', 'ready', 'failed'))"
        );
        this.ensureColumn(table, "readiness_last_tested_at", "TEXT");
        this.ensureColumn(
          table,
          "readiness_error_category",
          "TEXT CHECK (readiness_error_category IS NULL OR readiness_error_category IN ('authentication', 'quota', 'timeout', 'invalid-response', 'configuration', 'cancelled', 'provider'))"
        );
        this.ensureColumn(
          table,
          "readiness_error_message",
          "TEXT CHECK (readiness_error_message IS NULL OR length(readiness_error_message) <= 500)"
        );
        this.ensureColumn(
          table,
          "readiness_generation",
          "INTEGER NOT NULL DEFAULT 0 CHECK (readiness_generation >= 0)"
        );
      }
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS runtime_readiness_sequence (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          generation INTEGER NOT NULL CHECK (generation >= 0)
        );
        INSERT OR IGNORE INTO runtime_readiness_sequence (id, generation)
        VALUES (1, 0);
      `);
    });
  }

  private applyMigration(id: string, migrate: () => void): void {
    const applied = this.database
      .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
      .get(id);
    if (applied) return;
    this.database.transaction(() => {
      migrate();
      this.database
        .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(id, new Date().toISOString());
    })();
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

  private migrateConversationEvents(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(conversation_events)")
      .all() as Array<{ name: string }>;
    const definition = this.database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversation_events'"
      )
      .get() as { sql: string } | undefined;
    const current =
      columns.some((column) => column.name === "run_id") &&
      columns.some((column) => column.name === "correlation_id") &&
      columns.some((column) => column.name === "duration_ms") &&
      definition?.sql.includes("'cancelled'");
    if (current) return;
    this.database.transaction(() => {
      this.database.exec(`
        CREATE TABLE conversation_events_next (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES conversation_runs(id) ON DELETE SET NULL,
          correlation_id TEXT,
          stage TEXT NOT NULL CHECK (stage IN ('STT', 'AGENT', 'MCP', 'TTS')),
          status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'cancelled')),
          duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO conversation_events_next (
          id, conversation_id, run_id, correlation_id, stage, status,
          duration_ms, message, created_at
        )
        SELECT id, conversation_id, NULL, NULL, stage, status,
               NULL, message, created_at
        FROM conversation_events;
        DROP TABLE conversation_events;
        ALTER TABLE conversation_events_next RENAME TO conversation_events;
      `);
    })();
  }

  /**
   * Claims exclusive process ownership while allowing multiple Store
   * connections inside the same Node.js process.
   */
  private bootstrapProcessOwner(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS storage_process_owner (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner_id TEXT NOT NULL,
        process_id INTEGER NOT NULL,
        claimed_at TEXT NOT NULL
      );
    `);
  }

  private claimDatabaseOwnership(): boolean {
    const claim = this.database.transaction(() => {
      const existing = this.database
        .prepare(
          `SELECT owner_id, process_id, claimed_at
           FROM storage_process_owner WHERE id = 1`
        )
        .get() as
        | { owner_id: string; process_id: number; claimed_at: string }
        | undefined;
      if (existing?.owner_id === this.ownerId) return false;
      const heartbeatAge = existing
        ? Date.now() - Date.parse(existing.claimed_at)
        : Number.POSITIVE_INFINITY;
      if (
        existing &&
        existing.process_id !== process.pid &&
        heartbeatAge < OWNER_STALE_MS &&
        isProcessAlive(existing.process_id)
      ) {
        throw conflict("VoxMesh database is active in another process");
      }
      this.database
        .prepare(
          `INSERT INTO storage_process_owner (
             id, owner_id, process_id, claimed_at
           ) VALUES (1, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             owner_id = excluded.owner_id,
             process_id = excluded.process_id,
             claimed_at = excluded.claimed_at`
        )
        .run(this.ownerId, process.pid, new Date().toISOString());
      return true;
    });
    return claim.immediate();
  }

  private startOwnershipHeartbeat(): void {
    this.ownershipHeartbeat = setInterval(() => {
      try {
        this.database
          .prepare(
            `UPDATE storage_process_owner
             SET claimed_at = ?
             WHERE id = 1 AND owner_id = ?`
          )
          .run(new Date().toISOString(), this.ownerId);
      } catch (error) {
        console.error("Database ownership heartbeat failed", error);
      }
    }, OWNER_HEARTBEAT_MS);
    this.ownershipHeartbeat.unref();
  }

  private releaseDatabaseOwnership(): void {
    this.database
      .prepare(
        "DELETE FROM storage_process_owner WHERE id = 1 AND owner_id = ?"
      )
      .run(this.ownerId);
  }

  private reconcileInterruptedRuns(): void {
    const completedAt = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE conversation_runs
         SET status = 'failed',
             completed_at = ?,
             duration_ms = MAX(
               0,
               CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
             ),
             error_code = 'SERVER_RESTARTED'
         WHERE status = 'in_progress'`
      )
      .run(completedAt, completedAt);
  }

  private emitObservabilityEvent(event: StorageObservabilityEvent): void {
    for (const listener of this.observabilityListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Storage observability listener failed", error);
      }
    }
  }
}

function redactObservabilityText(value: string): string {
  const structured = redactStructuredJson(value);
  if (structured !== null) return structured;
  return redactObservabilityTextValue(value);
}

function redactObservabilityTextValue(value: string): string {
  return value
    .replace(
      /(["'])(authorization|api[-_ ]?key|token|secret)\1(\s*:\s*)(["'])[^"']*\4/gi,
      redactQuotedCredential
    )
    .replace(/\bAuthorization\s*[:=]\s*[^\r\n]*/gi, "Authorization: [REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|api[-_ ]?key|token|secret)\b(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[REDACTED]"
    )
    .replace(/([?&])([a-z0-9_-]+)=([^&\s]+)/gi, redactSensitiveQueryParameter);
}

function redactSensitiveQueryParameter(
  match: string,
  prefix: string,
  key: string
): string {
  return isSensitiveObservabilityKey(key)
    ? `${prefix}${key}=[REDACTED]`
    : match;
}

function redactStructuredJson(value: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  return JSON.stringify(redactStructuredValue(parsed));
}

function redactStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactStructuredValue);
  if (typeof value === "string") return redactObservabilityTextValue(value);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveObservabilityKey(key)
        ? "[REDACTED]"
        : redactStructuredValue(entry)
    ])
  );
}

function isSensitiveObservabilityKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[-_ ]/g, "");
  return (
    normalized.endsWith("authorization") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("accesskey") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.endsWith("credential")
  );
}

function redactQuotedCredential(
  _match: string,
  keyQuote: string,
  key: string,
  separator: string,
  valueQuote: string
): string {
  return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[REDACTED]${valueQuote}`;
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
    runId: row.run_id,
    correlationId: row.correlation_id,
    stage: row.stage,
    status: row.status,
    durationMs: row.duration_ms,
    message: row.message,
    createdAt: row.created_at
  };
}

function mapConversationRun(row: ConversationRunRow): ConversationRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    status: row.status,
    correlationId: row.correlation_id,
    inputMessageId: row.input_message_id,
    retryOfRunId: row.retry_of_run_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    errorCode: row.error_code
  };
}

function notFound(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function conflict(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function acquireLocalDatabaseLease(path: string): {
  key: string;
  ownerId: string;
} {
  const key = path === ":memory:" ? randomUUID() : resolve(path);
  const existing = localDatabaseLeases.get(key);
  if (existing) {
    existing.references += 1;
    return { key, ownerId: existing.ownerId };
  }
  const ownerId = randomUUID();
  localDatabaseLeases.set(key, { ownerId, references: 1 });
  return { key, ownerId };
}

function releaseLocalDatabaseLease(key: string): boolean {
  const lease = localDatabaseLeases.get(key);
  if (!lease) return false;
  lease.references -= 1;
  if (lease.references > 0) return false;
  localDatabaseLeases.delete(key);
  return true;
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

function parseStoredCapabilityStrings(value: string): string[] {
  const capabilities = JSON.parse(value) as unknown;
  if (
    !Array.isArray(capabilities) ||
    !capabilities.every((capability) => typeof capability === "string")
  ) {
    throw new Error("Stored model capabilities are invalid");
  }
  return capabilities;
}

function hasVerifiedBufferedRole(capabilities: readonly string[]): boolean {
  return [
    ["audio-input", "text-output", "transcription"],
    ["text-input", "text-output", "tool-calling"],
    ["text-input", "audio-output", "speech-synthesis"],
    [
      "audio-input",
      "audio-output",
      "text-output",
      "tool-calling",
      "native-multimodal"
    ]
  ].some((required) =>
    required.every((capability) => capabilities.includes(capability))
  );
}

function normalizeRuntimeRouteInput(
  input: RuntimeRouteInput
): NormalizedRuntimeRouteInput {
  return {
    ...input,
    chatStreamingEnabled: input.chatStreamingEnabled ?? false
  };
}

function selectChatHistory(newestFirst: AgentMessage[]): AgentMessage[] {
  const selected: AgentMessage[] = [];
  let characters = 0;
  for (const message of newestFirst) {
    if (selected.length >= MAX_CHAT_HISTORY_MESSAGES) break;
    if (
      selected.length > 0 &&
      characters + message.content.length > MAX_CHAT_HISTORY_CHARACTERS
    ) {
      break;
    }
    selected.push(message);
    characters += message.content.length;
  }
  selected.reverse();
  while (selected[0]?.role === "assistant") selected.shift();
  return selected;
}

function conversationTitle(message: string): string {
  return message.length > 64 ? `${message.slice(0, 61)}...` : message;
}
