import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { VoxMeshStore } from "./store.js";

let store: VoxMeshStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

it("does not publish a message event when conversation creation rolls back", () => {
  const directory = mkdtempSync(join(tmpdir(), "voxmesh-rollback-"));
  const databasePath = join(directory, "voxmesh.sqlite");
  try {
    store = new VoxMeshStore(databasePath);
    const database = new Database(databasePath);
    database
      .prepare(
        `CREATE TRIGGER reject_test_message
         BEFORE INSERT ON messages
         BEGIN
           SELECT RAISE(ABORT, 'rejected test message');
         END`
      )
      .run();
    database.close();
    const observed: string[] = [];
    store.subscribeObservability((event) => observed.push(event.type));

    expect(() => store?.createConversation("Rollback")).toThrow(
      "rejected test message"
    );
    expect(store.listConversations()).toEqual([]);
    expect(observed).toEqual([]);
  } finally {
    store?.close();
    store = undefined;
    rmSync(directory, { recursive: true, force: true });
  }
});

it("rejects a database owned by another live process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voxmesh-owner-"));
  const databasePath = join(directory, "voxmesh.sqlite");
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => undefined, 30000)"],
    { stdio: "ignore" }
  );
  try {
    await once(child, "spawn");
    if (!child.pid) throw new Error("Child process did not expose a PID");
    store = new VoxMeshStore(databasePath);
    store.close();
    store = undefined;
    const database = new Database(databasePath);
    database
      .prepare(
        `INSERT INTO storage_process_owner (
           id, owner_id, process_id, claimed_at
         ) VALUES (1, ?, ?, ?)`
      )
      .run("external-owner", child.pid, new Date().toISOString());
    database.close();

    expect(() => new VoxMeshStore(databasePath)).toThrow(
      "VoxMesh database is active in another process"
    );

    const staleDatabase = new Database(databasePath);
    staleDatabase
      .prepare("UPDATE storage_process_owner SET claimed_at = ? WHERE id = 1")
      .run("2026-08-19T00:00:00.000Z");
    staleDatabase.close();
    store = new VoxMeshStore(databasePath);
    expect(store.hasAdmin()).toBe(false);
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    store?.close();
    store = undefined;
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("VoxMeshStore", () => {
  it("creates an administrator only once", () => {
    store = new VoxMeshStore(":memory:");

    expect(store.hasAdmin()).toBe(false);
    expect(store.createAdmin("hash")).toBe(true);
    expect(store.createAdmin("other")).toBe(false);
    expect(store.getAdminPasswordHash()).toBe("hash");
  });

  it("stores conversations, messages, and logs", () => {
    store = new VoxMeshStore(":memory:");

    const id = store.createConversation("Check the light");
    store.addMessage(id, "tool", '{"state":"on"}');
    store.addMessage(id, "assistant", "The light is on.");
    store.addLog({
      category: "AGENT",
      level: "INFO",
      message: "Completed",
      conversationId: id
    });
    store.addPipelineEvent({
      conversationId: id,
      stage: "AGENT",
      status: "completed",
      message: "Agent completed"
    });

    expect(store.listConversations()).toHaveLength(1);
    expect(store.getConversation(id)?.messages).toHaveLength(3);
    expect(store.getConversation(id)?.events).toHaveLength(1);
    expect(store.listLogs()[0]?.conversationId).toBe(id);
  });

  it("publishes persisted observability events with sensitive values redacted", () => {
    store = new VoxMeshStore(":memory:");
    const events: Array<{ type: string }> = [];
    const unsubscribe = store.subscribeObservability((event) =>
      events.push(event)
    );
    const conversationId = store.createConversation("Observe events");

    store.addLog({
      category: "SYSTEM",
      level: "ERROR",
      message: [
        "Author",
        "ization: AWS4-HMAC-SHA256 Credential=value, SignedHeaders=host;x-amz-date, Signature=signature-value"
      ].join("")
    });
    store.addPipelineEvent({
      conversationId,
      stage: "AGENT",
      status: "failed",
      message: "apiKey=hidden-value request failed"
    });
    store.addLog({
      category: "SYSTEM",
      level: "WARN",
      message: JSON.stringify({
        apiKey: "value-one",
        token: 'prefix"secret-suffix',
        access_token: "oauth-access",
        refreshToken: "oauth-refresh",
        client_secret: "oauth-client",
        nested: {
          databasePassword: "value-three",
          service_credential: "value-four",
          safe: "visible",
          detail: "apiKey=embedded-value"
        }
      })
    });
    store.addLog({
      category: "SYSTEM",
      level: "WARN",
      message:
        "https://example.test?client_secret=url-value&safe=visible token=abc123"
    });
    unsubscribe();

    expect(events.map((event) => event.type)).toEqual([
      "message.created",
      "log.created",
      "pipeline.created",
      "log.created",
      "log.created"
    ]);
    expect(store.listLogs()[0]?.message).toBe(
      "https://example.test?client_secret=[REDACTED]&safe=visible token=[REDACTED]"
    );
    expect(store.listLogs()[1]?.message).toBe(
      JSON.stringify({
        apiKey: "[REDACTED]",
        token: "[REDACTED]",
        access_token: "[REDACTED]",
        refreshToken: "[REDACTED]",
        client_secret: "[REDACTED]",
        nested: {
          databasePassword: "[REDACTED]",
          service_credential: "[REDACTED]",
          safe: "visible",
          detail: "apiKey=[REDACTED]"
        }
      })
    );
    expect(store.listLogs()[2]?.message).toBe(
      ["Author", "ization: [REDACTED]"].join("")
    );
    expect(store.getConversation(conversationId)?.events[0]?.message).toBe(
      "apiKey=[REDACTED] request failed"
    );
  });

  it("initializes default routing records", () => {
    store = new VoxMeshStore(":memory:");

    const routing = store.getRuntimeRoutingSummary();
    expect(routing.connections).toHaveLength(4);
    expect(routing.models).toHaveLength(4);
    expect(routing.routes).toHaveLength(2);
    expect(routing.activeRouteId).toBe("system-route-composed");
    expect(store.getRuntimeVoicePipelineConfiguration()).toMatchObject({
      mode: "composed",
      routeId: "system-route-composed"
    });
  });

  it("persists exactly one terminal state for a Chat run", () => {
    store = new VoxMeshStore(":memory:");
    const observed: string[] = [];
    store.subscribeObservability((event) => observed.push(event.type));
    const runId = "11111111-1111-4111-8111-111111111111";
    const run = store.createChatRun(runId, "Check the light");

    expect(run).toMatchObject({
      id: runId,
      kind: "chat",
      status: "in_progress",
      errorCode: null
    });
    const completed = store.completeChatRun({
      runId,
      messages: [
        { role: "tool", content: '{"state":"on"}' },
        { role: "assistant", content: "The light is on." }
      ],
      events: [
        {
          category: "MCP",
          level: "INFO",
          message: "Calling MCP tool mock.get_device_status"
        },
        {
          category: "AGENT",
          level: "INFO",
          message: "Agent run completed"
        }
      ]
    });
    const lateCancel = store.cancelChatRun(runId);
    const detail = store.getConversation(run.conversationId);

    expect(completed.transitioned).toBe(true);
    expect(completed.run.status).toBe("completed");
    expect(completed.run.durationMs).not.toBeNull();
    expect(lateCancel).toMatchObject({
      transitioned: false,
      run: { status: "completed" }
    });
    expect(detail?.messages.map((message) => message.role)).toEqual([
      "user",
      "tool",
      "assistant"
    ]);
    expect(detail?.runs).toHaveLength(1);
    expect(
      detail?.events.filter((event) => event.status === "completed")
    ).toHaveLength(2);
    expect(observed).toEqual(
      expect.arrayContaining([
        "run.created",
        "message.created",
        "pipeline.created",
        "run.updated"
      ])
    );
    const conversationCount = store.conversationCount();
    try {
      store.createChatRun(runId, "Duplicate");
      throw new Error("Expected duplicate run creation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        message: "Conversation run ID already exists",
        statusCode: 409
      });
    }
    expect(store.conversationCount()).toBe(conversationCount);
  });

  it("prevents late completion from overwriting cancellation", () => {
    store = new VoxMeshStore(":memory:");
    const runId = "22222222-2222-4222-8222-222222222222";
    const run = store.createChatRun(runId, "Cancel this run");

    const cancelled = store.cancelChatRun(runId);
    const lateCompletion = store.completeChatRun({
      runId,
      messages: [{ role: "assistant", content: "Too late" }],
      events: []
    });

    expect(cancelled).toMatchObject({
      transitioned: true,
      run: { status: "cancelled", errorCode: "RUN_CANCELLED" }
    });
    expect(lateCompletion).toMatchObject({
      transitioned: false,
      run: { status: "cancelled" }
    });
    expect(store.getConversation(run.conversationId)?.messages).toHaveLength(1);
  });

  it("reuses a conversation and selects only durable prior Chat history", () => {
    store = new VoxMeshStore(":memory:");
    const firstRun = store.createChatRun(
      "66666666-6666-4666-8666-666666666666",
      "First question"
    );
    store.completeChatRun({
      runId: firstRun.id,
      messages: [
        { role: "tool", content: "Internal tool result" },
        { role: "assistant", content: "First answer" }
      ],
      events: []
    });
    const secondRun = store.createChatRun(
      "77777777-7777-4777-8777-777777777777",
      "Second question",
      firstRun.conversationId
    );

    expect(store.getChatContext(secondRun.id)).toEqual({
      inputMessage: "Second question",
      history: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" }
      ]
    });
    expect(
      store
        .getConversation(firstRun.conversationId)
        ?.messages.map(({ role, content }) => ({ role, content }))
    ).toEqual([
      { role: "user", content: "First question" },
      { role: "tool", content: "Internal tool result" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" }
    ]);
    expect(() =>
      store?.createChatRun(
        "88888888-8888-4888-8888-888888888888",
        "Conflicting question",
        firstRun.conversationId
      )
    ).toThrow("Conversation already has an active run");
  });

  it("bounds durable Chat history to the most recent turns", () => {
    store = new VoxMeshStore(":memory:");
    const conversationId = store.createConversation("Question 0");
    store.addMessage(conversationId, "assistant", "Answer 0");
    for (let index = 1; index <= 40; index += 1) {
      store.addMessage(conversationId, "user", `Question ${index}`);
      store.addMessage(conversationId, "assistant", `Answer ${index}`);
    }
    const run = store.createChatRun(
      "89898989-8989-4989-8989-898989898989",
      "Current question",
      conversationId
    );

    const context = store.getChatContext(run.id);

    expect(context.history).toHaveLength(32);
    expect(context.history[0]).toEqual({
      role: "user",
      content: "Question 25"
    });
    expect(context.history.at(-1)).toEqual({
      role: "assistant",
      content: "Answer 40"
    });
  });

  it("retries a cancelled run without duplicating its user message", () => {
    store = new VoxMeshStore(":memory:");
    const source = store.createChatRun(
      "99999999-9999-4999-8999-999999999999",
      "Retry this question"
    );
    store.cancelChatRun(source.id);
    const messageCount = store.getConversation(
      source.conversationId
    )?.messageCount;

    const retry = store.createChatRetry(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      source.id
    );

    expect(retry).toMatchObject({
      conversationId: source.conversationId,
      inputMessageId: source.inputMessageId,
      retryOfRunId: source.id,
      status: "in_progress"
    });
    expect(store.getChatContext(retry.id)).toEqual({
      inputMessage: "Retry this question",
      history: []
    });
    expect(store.getConversation(source.conversationId)?.messageCount).toBe(
      messageCount
    );
    expect(() =>
      store?.createChatRetry("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", source.id)
    ).toThrow("Only the latest attempt can be retried");
    expect(() =>
      store?.createChatRetry("cccccccc-cccc-4ccc-8ccc-cccccccccccc", retry.id)
    ).toThrow("Only failed or cancelled runs can be retried");
    store.completeChatRun({
      runId: retry.id,
      messages: [{ role: "assistant", content: "Retry answer" }],
      events: []
    });
    store.createChatRun(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "Later question",
      source.conversationId
    );
    expect(() =>
      store?.createChatRetry("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", source.id)
    ).toThrow("Only the latest conversation turn can be retried");
  });

  it("keeps active runs intact across simultaneous Store connections", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-connections-"));
    const databasePath = join(directory, "voxmesh.sqlite");
    let secondStore: VoxMeshStore | undefined;
    try {
      store = new VoxMeshStore(databasePath);
      const run = store.createChatRun(
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
        "Active request"
      );
      secondStore = new VoxMeshStore(databasePath);

      expect(secondStore.getConversationRun(run.id).status).toBe("in_progress");
      expect(() =>
        secondStore?.createChatRun(
          "12121212-1212-4212-8212-121212121212",
          "Conflicting request",
          run.conversationId
        )
      ).toThrow("Conversation already has an active run");
    } finally {
      secondStore?.close();
      store?.close();
      store = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("releases database ownership when initialization fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-init-failure-"));
    const databasePath = join(directory, "voxmesh.sqlite");
    try {
      const database = new Database(databasePath);
      database.exec("CREATE TABLE provider_connections (id TEXT PRIMARY KEY)");
      database.close();

      expect(() => new VoxMeshStore(databasePath)).toThrow();

      const inspected = new Database(databasePath);
      const ownerCount = inspected
        .prepare("SELECT COUNT(*) AS count FROM storage_process_owner")
        .get() as { count: number };
      inspected.close();
      expect(ownerCount.count).toBe(0);
    } finally {
      store?.close();
      store = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not acquire a local lease when opening SQLite fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-open-failure-"));
    try {
      expect(() => new VoxMeshStore(directory)).toThrow();
      expect(() => new VoxMeshStore(directory)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("marks interrupted runs as failed after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-runs-"));
    const databasePath = join(directory, "voxmesh.sqlite");
    try {
      store = new VoxMeshStore(databasePath);
      const runId = "33333333-3333-4333-8333-333333333333";
      store.createChatRun(runId, "Interrupted run");
      store.close();
      store = new VoxMeshStore(databasePath);

      const restartedRun = store.getConversationRun(runId);
      expect(restartedRun).toMatchObject({
        status: "failed",
        errorCode: "SERVER_RESTARTED"
      });
      expect(typeof restartedRun.completedAt).toBe("string");
      expect(typeof restartedRun.durationMs).toBe("number");
    } finally {
      store?.close();
      store = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates legacy messages and pipeline events without losing data", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-migration-"));
    const databasePath = join(directory, "voxmesh.sqlite");
    try {
      store = new VoxMeshStore(databasePath);
      const conversationId = store.createConversation("Legacy message");
      store.addPipelineEvent({
        conversationId,
        stage: "AGENT",
        status: "completed",
        message: "Legacy event"
      });
      store.close();
      store = undefined;

      const database = new Database(databasePath);
      database.pragma("foreign_keys = OFF");
      database.exec(`
        DROP INDEX idx_messages_run;
        DROP INDEX idx_conversation_events_run;
        DROP INDEX idx_conversation_runs_conversation;
        DROP TABLE conversation_runs;

        ALTER TABLE messages RENAME TO messages_current;
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO messages (id, conversation_id, role, content, created_at)
        SELECT id, conversation_id, role, content, created_at
        FROM messages_current;
        DROP TABLE messages_current;

        ALTER TABLE conversation_events RENAME TO conversation_events_current;
        CREATE TABLE conversation_events (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          stage TEXT NOT NULL CHECK (stage IN ('STT', 'AGENT', 'MCP', 'TTS')),
          status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO conversation_events (
          id, conversation_id, stage, status, message, created_at
        )
        SELECT id, conversation_id, stage, status, message, created_at
        FROM conversation_events_current;
        DROP TABLE conversation_events_current;
      `);
      database.close();

      store = new VoxMeshStore(databasePath);
      const detail = store.getConversation(conversationId);

      expect(detail?.messages).toEqual([
        expect.objectContaining({
          role: "user",
          runId: null,
          content: "Legacy message"
        })
      ]);
      expect(detail?.events).toEqual([
        expect.objectContaining({
          runId: null,
          correlationId: null,
          durationMs: null,
          status: "completed",
          message: "Legacy event"
        })
      ]);
      expect(detail?.runs).toEqual([]);
    } finally {
      store?.close();
      store = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows deleting an inactive seeded route without recreating it", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-routing-"));
    const databasePath = join(directory, "voxmesh.sqlite");
    try {
      store = new VoxMeshStore(databasePath);
      store.deleteRuntimeRoute("system-route-native");
      store.close();
      store = new VoxMeshStore(databasePath);

      expect(
        store
          .getRuntimeRoutingSummary()
          .routes.some((route) => route.id === "system-route-native")
      ).toBe(false);
    } finally {
      store?.close();
      store = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("manages editable routing records with streaming and deletion protection", () => {
    store = new VoxMeshStore(":memory:");
    const activeStore = store;

    let routing = activeStore.createRuntimeConnection({
      providerId: "mock",
      displayName: "Streaming Mock",
      endpoint: "",
      enabled: true
    });
    const connection = routing.connections.find(
      (entry) => entry.displayName === "Streaming Mock"
    );
    expect(connection).toBeDefined();

    routing = activeStore.createRuntimeModel({
      connectionId: connection?.id ?? "",
      displayName: "Streaming Mock STT",
      modelName: "mock-streaming-stt",
      apiVersion: "",
      providerOptions: { language: "en" },
      declaredCapabilities: [
        "audio-input",
        "text-output",
        "transcription",
        "non-streaming",
        "streaming"
      ],
      enabled: true
    });
    const sttModel = routing.models.find(
      (entry) => entry.displayName === "Streaming Mock STT"
    );
    expect(sttModel?.verifiedCapabilities).toContain("transcription");
    expect(sttModel?.verifiedCapabilities).not.toContain("streaming");

    routing = activeStore.createRuntimeRoute({
      displayName: "Streaming Composed",
      mode: "composed",
      sttModelDeploymentId: sttModel?.id ?? null,
      chatModelDeploymentId: "system-model-chat",
      ttsModelDeploymentId: "system-model-tts",
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: false,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const route = routing.routes.find(
      (entry) => entry.displayName === "Streaming Composed"
    );
    expect(route?.sttStreamingEnabled).toBe(false);
    expect(route?.chatStreamingEnabled).toBe(false);
    expect(route?.ttsStreamingEnabled).toBe(false);

    activeStore.activateRuntimeRoute(route?.id ?? "");
    expect(activeStore.getRuntimeRoutingSummary().activeRouteId).toBe(
      route?.id
    );

    expect(() => activeStore.deleteRuntimeModel(sttModel?.id ?? "")).toThrow(
      "still referenced"
    );
    expect(() =>
      activeStore.deleteRuntimeConnection(connection?.id ?? "")
    ).toThrow("still referenced");
    expect(() => activeStore.deleteRuntimeRoute(route?.id ?? "")).toThrow(
      "Active runtime route cannot be deleted"
    );
  });

  it("defaults omitted Chat streaming input to false at the storage boundary", () => {
    store = new VoxMeshStore(":memory:");
    const routing = store.createRuntimeRoute({
      displayName: "Legacy Storage Client Route",
      mode: "composed",
      sttModelDeploymentId: "system-model-stt",
      chatModelDeploymentId: "system-model-chat",
      ttsModelDeploymentId: "system-model-tts",
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });

    expect(
      routing.routes.find(
        (route) => route.displayName === "Legacy Storage Client Route"
      )?.chatStreamingEnabled
    ).toBe(false);
  });

  it("rejects streaming routes until the assigned model is verified", () => {
    store = new VoxMeshStore(":memory:");
    const activeStore = store;
    let routing = activeStore.createRuntimeConnection({
      providerId: "openai-compatible",
      displayName: "Remote Speech",
      endpoint: "https://provider.example.com/v1",
      apiKey: "secret",
      enabled: true
    });
    const connection = routing.connections.find(
      (entry) => entry.displayName === "Remote Speech"
    );
    routing = activeStore.createRuntimeModel({
      connectionId: connection?.id ?? "",
      displayName: "Unverified Streaming STT",
      modelName: "streaming-stt",
      apiVersion: "",
      providerOptions: { language: "en" },
      declaredCapabilities: [
        "audio-input",
        "text-output",
        "transcription",
        "non-streaming",
        "streaming"
      ],
      enabled: true
    });
    const model = routing.models.find(
      (entry) => entry.displayName === "Unverified Streaming STT"
    );

    routing = activeStore.createRuntimeRoute({
      displayName: "Unverified Streaming Route",
      mode: "composed",
      sttModelDeploymentId: model?.id ?? null,
      chatModelDeploymentId: "system-model-chat",
      ttsModelDeploymentId: "system-model-tts",
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: true,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const route = routing.routes.find(
      (entry) => entry.displayName === "Unverified Streaming Route"
    );
    expect(() => activeStore.activateRuntimeRoute(route?.id ?? "")).toThrow(
      "missing verified capabilities: audio-input"
    );
    activeStore.markRuntimeRouteVerified(
      activeStore.captureRuntimeRouteVerification(route?.id ?? "")
    );
    expect(() => activeStore.activateRuntimeRoute(route?.id ?? "")).toThrow(
      "requires verified streaming capability"
    );
  });

  it("rejects buffered provider resolution after compatibility is removed", () => {
    store = new VoxMeshStore(":memory:");
    let routing = store.createRuntimeConnection({
      providerId: "mock",
      displayName: "Buffered Compatibility",
      endpoint: "",
      enabled: true
    });
    const connection = routing.connections.find(
      (entry) => entry.displayName === "Buffered Compatibility"
    );
    routing = store.createRuntimeModel({
      connectionId: connection?.id ?? "",
      displayName: "Buffered Multi-role",
      modelName: "buffered-multi-role",
      apiVersion: "",
      providerOptions: {},
      declaredCapabilities: [
        "audio-input",
        "audio-output",
        "text-input",
        "text-output",
        "transcription",
        "speech-synthesis",
        "tool-calling",
        "non-streaming"
      ],
      enabled: true
    });
    const model = routing.models.find(
      (entry) => entry.displayName === "Buffered Multi-role"
    );
    routing = store.createRuntimeRoute({
      displayName: "Buffered Compatibility Route",
      mode: "composed",
      sttModelDeploymentId: model?.id ?? null,
      chatModelDeploymentId: model?.id ?? null,
      ttsModelDeploymentId: model?.id ?? null,
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: false,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const route = routing.routes.find(
      (entry) => entry.displayName === "Buffered Compatibility Route"
    );
    store.updateRuntimeModel(model?.id ?? "", {
      connectionId: connection?.id ?? "",
      displayName: "Buffered Multi-role",
      modelName: "buffered-multi-role",
      apiVersion: "",
      providerOptions: {},
      declaredCapabilities:
        model?.declaredCapabilities.filter(
          (capability) => capability !== "non-streaming"
        ) ?? [],
      enabled: true
    });

    expect(() => store?.getRuntimeLlmConfiguration(route?.id)).toThrow(
      "missing declared capabilities: non-streaming"
    );
    expect(() => store?.getRuntimeSpeechConfiguration(route?.id)).toThrow(
      "missing declared capabilities: non-streaming"
    );
  });

  it("gates Chat streaming activation on transport, browser, and adapter availability", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-streaming-route-"));
    const databasePath = join(directory, "voxmesh.sqlite");
    try {
      store = new VoxMeshStore(databasePath);
      let routing = store.createRuntimeModel({
        connectionId: "system-connection-chat",
        displayName: "Streaming Mock Chat",
        modelName: "mock-streaming-chat",
        apiVersion: "",
        providerOptions: {},
        declaredCapabilities: [
          "text-input",
          "text-output",
          "tool-calling",
          "non-streaming",
          "streaming"
        ],
        enabled: true
      });
      const model = routing.models.find(
        (entry) => entry.displayName === "Streaming Mock Chat"
      );
      routing = store.createRuntimeRoute({
        displayName: "Chat Streaming Route",
        mode: "composed",
        sttModelDeploymentId: "system-model-stt",
        chatModelDeploymentId: model?.id ?? null,
        ttsModelDeploymentId: "system-model-tts",
        nativeModelDeploymentId: null,
        fallbackRouteId: null,
        sttStreamingEnabled: false,
        chatStreamingEnabled: true,
        ttsStreamingEnabled: false,
        enabled: true
      });
      const routeId =
        routing.routes.find(
          (entry) => entry.displayName === "Chat Streaming Route"
        )?.id ?? "";
      const snapshot = store.captureRuntimeRouteVerification(routeId);
      store.updateRuntimeRoute(routeId, {
        ...routeInput(store.getRuntimeRoute(routeId)),
        chatStreamingEnabled: false
      });
      expect(() => store?.markRuntimeRouteVerified(snapshot)).toThrow(
        "configuration changed during testing"
      );
      store.updateRuntimeRoute(routeId, {
        ...routeInput(store.getRuntimeRoute(routeId)),
        chatStreamingEnabled: true
      });
      store.close();
      store = undefined;

      const database = new Database(databasePath);
      database
        .prepare(
          "UPDATE model_deployments SET verified_capabilities = declared_capabilities WHERE id = ?"
        )
        .run(model?.id ?? "");
      database.close();

      store = new VoxMeshStore(databasePath);
      expect(() => store?.activateRuntimeRoute(routeId)).toThrow(
        "Streaming voice transport is unavailable"
      );
      store.close();
      store = new VoxMeshStore(databasePath, {
        transportAvailable: true,
        browserClientAvailable: true,
        sttProviderIds: [],
        chatProviderIds: [],
        ttsProviderIds: []
      });
      expect(() => store?.activateRuntimeRoute(routeId)).toThrow(
        "Chat streaming adapter is unavailable for provider mock"
      );
      store.close();
      store = new VoxMeshStore(databasePath, {
        transportAvailable: true,
        browserClientAvailable: true,
        sttProviderIds: [],
        chatProviderIds: ["mock"],
        ttsProviderIds: []
      });
      expect(store.activateRuntimeRoute(routeId).activeRouteId).toBe(routeId);
      expect(() =>
        store?.updateRuntimeRoute(routeId, {
          ...routeInput(store.getRuntimeRoute(routeId)),
          chatStreamingEnabled: false
        })
      ).toThrow("Active runtime route cannot be changed");
      store.close();
      store = new VoxMeshStore(databasePath);
      expect(() => store?.getRuntimeLlmConfiguration()).toThrow(
        "Streaming voice transport is unavailable"
      );
      expect(() => store?.getRuntimeVoicePipelineConfiguration()).toThrow(
        "Streaming voice transport is unavailable"
      );
    } finally {
      store?.close();
      store = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("protects active routing dependencies from runtime changes", () => {
    store = new VoxMeshStore(":memory:");
    const active = store.getRuntimeRoutingSummary();
    const activeRoute = active.routes.find(
      (route) => route.id === active.activeRouteId
    );
    const chatModel = active.models.find(
      (model) => model.id === activeRoute?.chatModelDeploymentId
    );
    const chatConnection = active.connections.find(
      (connection) => connection.id === chatModel?.connectionId
    );

    expect(() =>
      store?.updateRuntimeConnection(chatConnection?.id ?? "", {
        providerId: chatConnection?.providerId ?? "mock",
        displayName: chatConnection?.displayName ?? "Chat",
        endpoint: chatConnection?.endpoint ?? "",
        enabled: false
      })
    ).toThrow("assigned to the active runtime route");
    expect(() =>
      store?.updateRuntimeModel(chatModel?.id ?? "", {
        connectionId: chatModel?.connectionId ?? "",
        displayName: chatModel?.displayName ?? "Chat",
        modelName: chatModel?.modelName ?? "",
        apiVersion: chatModel?.apiVersion ?? "",
        providerOptions: chatModel?.providerOptions ?? {},
        declaredCapabilities: chatModel?.declaredCapabilities ?? [],
        enabled: false
      })
    ).toThrow("assigned to the active runtime route");
    expect(() =>
      store?.updateRuntimeRoute(activeRoute?.id ?? "", {
        ...routeInput(activeRoute),
        enabled: false
      })
    ).toThrow("Active runtime route cannot be changed");

    expect(() =>
      store?.updateRuntimeConnection(chatConnection?.id ?? "", {
        providerId: chatConnection?.providerId ?? "mock",
        displayName: "Renamed active connection",
        endpoint: chatConnection?.endpoint ?? "",
        enabled: true
      })
    ).not.toThrow();
    expect(() =>
      store?.updateRuntimeModel(chatModel?.id ?? "", {
        connectionId: chatModel?.connectionId ?? "",
        displayName: "Renamed active model",
        modelName: chatModel?.modelName ?? "",
        apiVersion: chatModel?.apiVersion ?? "",
        providerOptions: chatModel?.providerOptions ?? {},
        declaredCapabilities: chatModel?.declaredCapabilities ?? [],
        enabled: true
      })
    ).not.toThrow();
    expect(() =>
      store?.updateRuntimeRoute(activeRoute?.id ?? "", {
        ...routeInput(activeRoute),
        displayName: "Renamed active route"
      })
    ).not.toThrow();
  });

  it("protects the active native route fallback dependency graph", () => {
    store = new VoxMeshStore(":memory:");
    let routing = store.createRuntimeRoute({
      displayName: "Native With Fallback",
      mode: "native-multimodal",
      sttModelDeploymentId: null,
      chatModelDeploymentId: null,
      ttsModelDeploymentId: null,
      nativeModelDeploymentId: "system-model-native",
      fallbackRouteId: "system-route-composed",
      sttStreamingEnabled: true,
      chatStreamingEnabled: true,
      ttsStreamingEnabled: true,
      enabled: true
    });
    const native = routing.routes.find(
      (route) => route.displayName === "Native With Fallback"
    );
    expect(native).toMatchObject({
      sttStreamingEnabled: false,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false
    });
    store.activateRuntimeRoute(native?.id ?? "");
    routing = store.getRuntimeRoutingSummary();
    const fallback = routing.routes.find(
      (route) => route.id === "system-route-composed"
    );
    const chatModel = routing.models.find(
      (model) => model.id === fallback?.chatModelDeploymentId
    );
    const chatConnection = routing.connections.find(
      (connection) => connection.id === chatModel?.connectionId
    );

    expect(() =>
      store?.updateRuntimeRoute(fallback?.id ?? "", {
        ...routeInput(fallback),
        enabled: false
      })
    ).toThrow("Active runtime route cannot be changed");
    expect(() =>
      store?.updateRuntimeModel(chatModel?.id ?? "", {
        connectionId: chatModel?.connectionId ?? "",
        displayName: chatModel?.displayName ?? "Chat",
        modelName: chatModel?.modelName ?? "",
        apiVersion: chatModel?.apiVersion ?? "",
        providerOptions: chatModel?.providerOptions ?? {},
        declaredCapabilities: chatModel?.declaredCapabilities ?? [],
        enabled: false
      })
    ).toThrow("assigned to the active runtime route");
    expect(() =>
      store?.updateRuntimeConnection(chatConnection?.id ?? "", {
        providerId: chatConnection?.providerId ?? "mock",
        displayName: chatConnection?.displayName ?? "Chat",
        endpoint: chatConnection?.endpoint ?? "",
        enabled: false
      })
    ).toThrow("assigned to the active runtime route");
  });

  it("resolves Native chat through its explicit fallback after seeded deletion", () => {
    store = new VoxMeshStore(":memory:");
    let routing = store.createRuntimeRoute({
      displayName: "Custom Composed Fallback",
      mode: "composed",
      sttModelDeploymentId: "system-model-stt",
      chatModelDeploymentId: "system-model-chat",
      ttsModelDeploymentId: "system-model-tts",
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: false,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const fallback = routing.routes.find(
      (route) => route.displayName === "Custom Composed Fallback"
    );
    routing = store.createRuntimeRoute({
      displayName: "Native With Custom Fallback",
      mode: "native-multimodal",
      sttModelDeploymentId: null,
      chatModelDeploymentId: null,
      ttsModelDeploymentId: null,
      nativeModelDeploymentId: "system-model-native",
      fallbackRouteId: fallback?.id ?? null,
      sttStreamingEnabled: false,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const native = routing.routes.find(
      (route) => route.displayName === "Native With Custom Fallback"
    );
    store.activateRuntimeRoute(fallback?.id ?? "");
    store.deleteRuntimeRoute("system-route-composed");
    store.activateRuntimeRoute(native?.id ?? "");

    expect(store.getRuntimeLlmConfiguration()).toMatchObject({
      mode: "mock",
      model: ""
    });
    expect(store.getRuntimeSpeechConfiguration()).toMatchObject({
      sttMode: "mock",
      ttsMode: "mock"
    });
  });

  it("binds verification to the tested route configuration and role", () => {
    store = new VoxMeshStore(":memory:");
    let routing = store.createRuntimeConnection({
      providerId: "openai-compatible",
      displayName: "Remote Multi-role",
      endpoint: "https://provider.example.com/v1",
      apiKey: "secret",
      enabled: true
    });
    const connection = routing.connections.find(
      (entry) => entry.displayName === "Remote Multi-role"
    );
    routing = store.createRuntimeModel({
      connectionId: connection?.id ?? "",
      displayName: "Remote STT",
      modelName: "remote-stt",
      apiVersion: "",
      providerOptions: {},
      declaredCapabilities: [
        "audio-input",
        "audio-output",
        "text-input",
        "text-output",
        "transcription",
        "speech-synthesis",
        "tool-calling",
        "non-streaming"
      ],
      enabled: true
    });
    const model = routing.models.find(
      (entry) => entry.displayName === "Remote STT"
    );
    routing = store.createRuntimeRoute({
      displayName: "Verification Route",
      mode: "composed",
      sttModelDeploymentId: model?.id ?? null,
      chatModelDeploymentId: "system-model-chat",
      ttsModelDeploymentId: "system-model-tts",
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: false,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const route = routing.routes.find(
      (entry) => entry.displayName === "Verification Route"
    );
    const snapshot = store.captureRuntimeRouteVerification(route?.id ?? "");
    store.markRuntimeRouteVerified(snapshot);
    const verified = store
      .getRuntimeRoutingSummary()
      .models.find((entry) => entry.id === model?.id)?.verifiedCapabilities;
    expect(verified).toEqual([
      "audio-input",
      "text-output",
      "transcription",
      "non-streaming"
    ]);
    store.updateRuntimeModel(model?.id ?? "", {
      connectionId: model?.connectionId ?? "",
      displayName: "Renamed Remote STT",
      modelName: model?.modelName ?? "",
      apiVersion: model?.apiVersion ?? "",
      providerOptions: model?.providerOptions ?? {},
      declaredCapabilities: model?.declaredCapabilities ?? [],
      enabled: true
    });
    expect(
      store
        .getRuntimeRoutingSummary()
        .models.find((entry) => entry.id === model?.id)?.verifiedCapabilities
    ).toEqual(verified);
    const ttsRouting = store.createRuntimeRoute({
      displayName: "Shared Model TTS Route",
      mode: "composed",
      sttModelDeploymentId: "system-model-stt",
      chatModelDeploymentId: "system-model-chat",
      ttsModelDeploymentId: model?.id ?? null,
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: false,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const ttsRoute = ttsRouting.routes.find(
      (entry) => entry.displayName === "Shared Model TTS Route"
    );
    store.markRuntimeRouteVerified(
      store.captureRuntimeRouteVerification(ttsRoute?.id ?? "")
    );
    expect(
      store
        .getRuntimeRoutingSummary()
        .models.find((entry) => entry.id === model?.id)?.verifiedCapabilities
    ).toEqual(
      expect.arrayContaining([
        "audio-input",
        "text-output",
        "transcription",
        "text-input",
        "audio-output",
        "speech-synthesis",
        "non-streaming"
      ])
    );

    const changed = store.createRuntimeRoute({
      displayName: "Replacement Route",
      mode: "composed",
      sttModelDeploymentId: "system-model-stt",
      chatModelDeploymentId: "system-model-chat",
      ttsModelDeploymentId: "system-model-tts",
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: false,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const replacement = changed.routes.find(
      (entry) => entry.displayName === "Replacement Route"
    );
    store.updateRuntimeRoute(route?.id ?? "", {
      ...routeInput(route),
      sttModelDeploymentId: replacement?.sttModelDeploymentId ?? null
    });
    expect(() => store?.markRuntimeRouteVerified(snapshot)).toThrow(
      "configuration changed during testing"
    );
  });

  it("persists route and connection readiness for explicit tests", () => {
    store = new VoxMeshStore(":memory:");
    const snapshot = store.captureRuntimeRouteVerification(
      "system-route-composed"
    );
    const test = store.beginRuntimeRouteReadinessTest(snapshot);

    expect(
      store
        .getRuntimeRoutingSummary()
        .routes.find((route) => route.id === "system-route-composed")?.readiness
    ).toEqual({
      state: "testing",
      lastTestedAt: null,
      lastError: null
    });

    for (const role of ["chat", "tts", "stt"] as const) {
      store.beginRuntimeConnectionReadinessTest(test, role);
      store.markRuntimeConnectionReadinessReady(test, role);
    }
    store.markRuntimeRouteReadinessReady(test);

    const routing = store.getRuntimeRoutingSummary();
    const routeReadiness = routing.routes.find(
      (route) => route.id === "system-route-composed"
    )?.readiness;
    expect(routeReadiness).toMatchObject({
      state: "ready",
      lastError: null
    });
    expect(typeof routeReadiness?.lastTestedAt).toBe("string");
    expect(
      routing.connections
        .filter((connection) =>
          snapshot.assignments.some(
            (assignment) => assignment.connectionId === connection.id
          )
        )
        .every(
          (connection) =>
            connection.readiness.state === "ready" &&
            typeof connection.readiness.lastTestedAt === "string"
        )
    ).toBe(true);
  });

  it("records safe failures only for the current readiness generation", () => {
    store = new VoxMeshStore(":memory:");
    const snapshot = store.captureRuntimeRouteVerification(
      "system-route-composed"
    );
    const first = store.beginRuntimeRouteReadinessTest(snapshot);
    const second = store.beginRuntimeRouteReadinessTest(snapshot);

    expect(() => store?.markRuntimeRouteReadinessReady(first)).toThrow(
      "superseded"
    );
    store.beginRuntimeConnectionReadinessTest(second, "chat");
    const unsafeCallerError = {
      category: "authentication",
      message: "https://workspace.example.test api-key=caller-provided-secret"
    } as const;
    store.markRuntimeConnectionReadinessFailed(
      second,
      "chat",
      unsafeCallerError
    );
    store.markRuntimeRouteReadinessFailed(second, unsafeCallerError);

    const routing = store.getRuntimeRoutingSummary();
    const routeReadiness = routing.routes.find(
      (route) => route.id === "system-route-composed"
    )?.readiness;
    expect(routeReadiness).toMatchObject({
      state: "failed",
      lastError: {
        category: "authentication",
        message: "Provider authentication failed."
      }
    });
    expect(typeof routeReadiness?.lastTestedAt).toBe("string");
    expect(JSON.stringify(routing)).not.toContain("caller-provided-secret");
    expect(JSON.stringify(routing)).not.toContain("workspace.example.test");
    const chatConnectionId = snapshot.assignments.find(
      (assignment) => assignment.role === "chat"
    )?.connectionId;
    expect(
      routing.connections.find(
        (connection) => connection.id === chatConnectionId
      )?.readiness
    ).toMatchObject({
      state: "failed",
      lastError: { category: "authentication" }
    });
  });

  it("invalidates readiness after related runtime configuration changes", () => {
    store = new VoxMeshStore(":memory:");
    let routing = store.createRuntimeConnection({
      providerId: "mock",
      displayName: "Readiness Connection",
      endpoint: "",
      enabled: true
    });
    const connection = routing.connections.find(
      (entry) => entry.displayName === "Readiness Connection"
    );
    routing = store.createRuntimeModel({
      connectionId: connection?.id ?? "",
      displayName: "Readiness Model",
      modelName: "readiness-model",
      apiVersion: "",
      providerOptions: {},
      declaredCapabilities: [
        "audio-input",
        "audio-output",
        "text-input",
        "text-output",
        "transcription",
        "speech-synthesis",
        "tool-calling",
        "non-streaming"
      ],
      enabled: true
    });
    const model = routing.models.find(
      (entry) => entry.displayName === "Readiness Model"
    );
    routing = store.createRuntimeRoute({
      displayName: "Readiness Route",
      mode: "composed",
      sttModelDeploymentId: model?.id ?? null,
      chatModelDeploymentId: model?.id ?? null,
      ttsModelDeploymentId: model?.id ?? null,
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: false,
      chatStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const route = routing.routes.find(
      (entry) => entry.displayName === "Readiness Route"
    );
    const test = store.beginRuntimeRouteReadinessTest(
      store.captureRuntimeRouteVerification(route?.id ?? "")
    );
    for (const role of ["chat", "tts", "stt"] as const) {
      store.beginRuntimeConnectionReadinessTest(test, role);
      store.markRuntimeConnectionReadinessReady(test, role);
    }
    store.markRuntimeRouteReadinessReady(test);

    store.updateRuntimeModel(model?.id ?? "", {
      connectionId: connection?.id ?? "",
      displayName: "Readiness Model",
      modelName: "changed-readiness-model",
      apiVersion: "",
      providerOptions: {},
      declaredCapabilities: model?.declaredCapabilities ?? [],
      enabled: true
    });

    const invalidated = store.getRuntimeRoutingSummary();
    expect(
      invalidated.connections.find((entry) => entry.id === connection?.id)
        ?.readiness
    ).toEqual({
      state: "unknown",
      lastTestedAt: null,
      lastError: null
    });
    expect(
      invalidated.routes.find((entry) => entry.id === route?.id)?.readiness
    ).toEqual({
      state: "unknown",
      lastTestedAt: null,
      lastError: null
    });
    expect(() => store?.markRuntimeRouteReadinessReady(test)).toThrow(
      "configuration changed during testing"
    );
  });

  it("resets interrupted readiness tests to unknown after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-readiness-"));
    const databasePath = join(directory, "voxmesh.sqlite");
    try {
      store = new VoxMeshStore(databasePath);
      const snapshot = store.captureRuntimeRouteVerification(
        "system-route-composed"
      );
      const test = store.beginRuntimeRouteReadinessTest(snapshot);
      store.beginRuntimeConnectionReadinessTest(test, "chat");
      store.close();
      store = new VoxMeshStore(databasePath);

      const routing = store.getRuntimeRoutingSummary();
      expect(
        routing.routes.find((route) => route.id === "system-route-composed")
          ?.readiness
      ).toEqual({
        state: "unknown",
        lastTestedAt: null,
        lastError: null
      });
      const chatConnectionId = snapshot.assignments.find(
        (assignment) => assignment.role === "chat"
      )?.connectionId;
      expect(
        routing.connections.find(
          (connection) => connection.id === chatConnectionId
        )?.readiness
      ).toEqual({
        state: "unknown",
        lastTestedAt: null,
        lastError: null
      });
    } finally {
      store?.close();
      store = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates existing provider records to unknown readiness", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-readiness-migrate-"));
    const databasePath = join(directory, "voxmesh.sqlite");
    try {
      const database = new Database(databasePath);
      database.exec(`
        CREATE TABLE provider_connections (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          api_key TEXT,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO provider_connections (
          id, provider_id, display_name, endpoint, api_key, enabled,
          created_at, updated_at
        ) VALUES (
          'legacy-connection', 'mock', 'Legacy Connection', '', NULL, 1,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
      `);
      database.close();

      store = new VoxMeshStore(databasePath);
      expect(
        store
          .getRuntimeRoutingSummary()
          .connections.find(
            (connection) => connection.id === "legacy-connection"
          )?.readiness
      ).toEqual({
        state: "unknown",
        lastTestedAt: null,
        lastError: null
      });

      store.close();
      store = undefined;

      const migrated = new Database(databasePath);
      const migration = migrated
        .prepare(
          "SELECT id FROM schema_migrations WHERE id = '2026-08-22-provider-readiness-v1'"
        )
        .get() as { id: string } | undefined;
      migrated.close();
      expect(migration?.id).toBe("2026-08-22-provider-readiness-v1");
    } finally {
      store?.close();
      store = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates full-chain streaming route controls with safe defaults", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxmesh-streaming-migrate-"));
    const databasePath = join(directory, "voxmesh.sqlite");
    try {
      const database = new Database(databasePath);
      database.exec(`
        CREATE TABLE provider_connections (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          api_key TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          readiness_state TEXT NOT NULL DEFAULT 'unknown',
          readiness_last_tested_at TEXT,
          readiness_error_category TEXT,
          readiness_error_message TEXT,
          readiness_generation INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE model_deployments (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          model_name TEXT NOT NULL,
          api_version TEXT NOT NULL,
          declared_capabilities TEXT NOT NULL,
          verified_capabilities TEXT NOT NULL,
          provider_options TEXT NOT NULL,
          configuration_fingerprint TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE runtime_routes (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          mode TEXT NOT NULL,
          stt_model_deployment_id TEXT,
          chat_model_deployment_id TEXT,
          tts_model_deployment_id TEXT,
          native_model_deployment_id TEXT,
          fallback_route_id TEXT,
          stt_streaming_enabled INTEGER NOT NULL DEFAULT 0,
          tts_streaming_enabled INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          readiness_state TEXT NOT NULL DEFAULT 'unknown',
          readiness_last_tested_at TEXT,
          readiness_error_category TEXT,
          readiness_error_message TEXT,
          readiness_generation INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE active_runtime_route (
          id INTEGER PRIMARY KEY,
          active_route_id TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE runtime_readiness_sequence (
          id INTEGER PRIMARY KEY,
          generation INTEGER NOT NULL
        );
        INSERT INTO schema_migrations (id, applied_at) VALUES (
          '2026-08-22-provider-readiness-v1',
          '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO runtime_readiness_sequence (id, generation)
        VALUES (1, 0);
        INSERT INTO provider_connections (
          id, provider_id, display_name, endpoint, api_key, enabled,
          created_at, updated_at
        ) VALUES (
          'legacy-streaming-connection', 'mock', 'Legacy Streaming', '',
          NULL, 1, '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO model_deployments (
          id, connection_id, display_name, model_name, api_version,
          declared_capabilities, verified_capabilities, provider_options,
          configuration_fingerprint, enabled, created_at, updated_at
        ) VALUES (
          'legacy-streaming-model', 'legacy-streaming-connection',
          'Legacy Streaming Model', 'legacy', '',
          '["audio-input","audio-output","text-input","text-output","transcription","speech-synthesis","tool-calling","streaming"]',
          '["audio-input","audio-output","text-input","text-output","transcription","speech-synthesis","tool-calling","streaming"]',
          '{}',
          'legacy-fingerprint', 1, '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO model_deployments (
          id, connection_id, display_name, model_name, api_version,
          declared_capabilities, verified_capabilities, provider_options,
          configuration_fingerprint, enabled, created_at, updated_at
        ) VALUES (
          'legacy-unreferenced-model', 'legacy-streaming-connection',
          'Legacy Unreferenced Model', 'legacy-unused', '',
          '["text-input","text-output","tool-calling"]', '[]', '{}',
          'legacy-unused-fingerprint', 1, '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO model_deployments (
          id, connection_id, display_name, model_name, api_version,
          declared_capabilities, verified_capabilities, provider_options,
          configuration_fingerprint, enabled, created_at, updated_at
        ) VALUES (
          'legacy-native-model', 'legacy-streaming-connection',
          'Legacy Native Model', 'legacy-native', '',
          '["audio-input","audio-output","text-output","tool-calling","native-multimodal","streaming"]',
          '["audio-input","audio-output","text-output","tool-calling","native-multimodal","streaming"]',
          '{}', 'legacy-native-fingerprint', 1,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO runtime_routes (
          id, display_name, mode, stt_model_deployment_id,
          chat_model_deployment_id, tts_model_deployment_id,
          native_model_deployment_id, fallback_route_id,
          stt_streaming_enabled, tts_streaming_enabled, enabled,
          readiness_state, readiness_last_tested_at,
          readiness_error_category, readiness_error_message,
          readiness_generation, created_at, updated_at
        ) VALUES (
          'legacy-streaming-route', 'Legacy Streaming Route', 'composed',
          'legacy-streaming-model', 'legacy-streaming-model',
          'legacy-streaming-model', NULL, NULL, 0, 0, 1,
          'ready', '2026-01-01T00:00:00.000Z', NULL, NULL, 0,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO runtime_routes (
          id, display_name, mode, stt_model_deployment_id,
          chat_model_deployment_id, tts_model_deployment_id,
          native_model_deployment_id, fallback_route_id,
          stt_streaming_enabled, tts_streaming_enabled, enabled,
          readiness_state, readiness_last_tested_at,
          readiness_error_category, readiness_error_message,
          readiness_generation, created_at, updated_at
        ) VALUES (
          'legacy-inactive-streaming-intent',
          'Legacy Inactive Streaming Intent', 'composed',
          'legacy-streaming-model', 'legacy-streaming-model',
          'legacy-streaming-model', NULL, NULL, 1, 1, 1,
          'unknown', NULL, NULL, NULL, 0,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO runtime_routes (
          id, display_name, mode, stt_model_deployment_id,
          chat_model_deployment_id, tts_model_deployment_id,
          native_model_deployment_id, fallback_route_id,
          stt_streaming_enabled, tts_streaming_enabled, enabled,
          readiness_state, readiness_last_tested_at,
          readiness_error_category, readiness_error_message,
          readiness_generation, created_at, updated_at
        ) VALUES (
          'legacy-composed-streaming-intent',
          'Legacy Composed Streaming Intent', 'composed',
          'legacy-streaming-model', 'legacy-streaming-model',
          'legacy-streaming-model', NULL, NULL, 1, 1, 1,
          'unknown', NULL, NULL, NULL, 0,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO runtime_routes (
          id, display_name, mode, stt_model_deployment_id,
          chat_model_deployment_id, tts_model_deployment_id,
          native_model_deployment_id, fallback_route_id,
          stt_streaming_enabled, tts_streaming_enabled, enabled,
          readiness_state, readiness_last_tested_at,
          readiness_error_category, readiness_error_message,
          readiness_generation, created_at, updated_at
        ) VALUES (
          'legacy-native-route', 'Legacy Native Route', 'native-multimodal',
          NULL, NULL, NULL, 'legacy-native-model',
          'legacy-composed-streaming-intent', 1, 1, 1,
          'ready', '2026-01-01T00:00:00.000Z', NULL, NULL, 0,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO active_runtime_route (id, active_route_id, updated_at)
        VALUES (
          1, 'legacy-native-route', '2026-01-01T00:00:00.000Z'
        );
      `);
      database.close();

      store = new VoxMeshStore(databasePath);
      expect(
        store
          .getRuntimeRoutingSummary()
          .routes.every((route) => route.chatStreamingEnabled === false)
      ).toBe(true);
      const migratedSummary = store.getRuntimeRoutingSummary();
      const legacyModel = migratedSummary.models.find(
        (model) => model.id === "legacy-streaming-model"
      );
      expect(legacyModel?.declaredCapabilities).toContain("non-streaming");
      expect(legacyModel?.verifiedCapabilities).toContain("non-streaming");
      expect(legacyModel?.verifiedCapabilities).not.toContain("streaming");
      const unreferencedModel = migratedSummary.models.find(
        (model) => model.id === "legacy-unreferenced-model"
      );
      expect(unreferencedModel?.declaredCapabilities).toContain(
        "non-streaming"
      );
      expect(unreferencedModel?.verifiedCapabilities).not.toContain(
        "non-streaming"
      );
      expect(
        migratedSummary.routes.find(
          (route) => route.id === "legacy-streaming-route"
        )?.readiness.state
      ).toBe("ready");
      expect(
        migratedSummary.routes.find(
          (route) => route.id === "legacy-composed-streaming-intent"
        )
      ).toMatchObject({
        sttStreamingEnabled: false,
        chatStreamingEnabled: false,
        ttsStreamingEnabled: false
      });
      expect(
        migratedSummary.routes.find(
          (route) => route.id === "legacy-inactive-streaming-intent"
        )
      ).toMatchObject({
        sttStreamingEnabled: true,
        chatStreamingEnabled: false,
        ttsStreamingEnabled: true
      });
      expect(
        store.activateRuntimeRoute("legacy-streaming-route").activeRouteId
      ).toBe("legacy-streaming-route");
      const legacyNativeRoute = store.getRuntimeRoute("legacy-native-route");
      expect(legacyNativeRoute).toMatchObject({
        sttStreamingEnabled: false,
        chatStreamingEnabled: false,
        ttsStreamingEnabled: false
      });
      expect(
        store.activateRuntimeRoute("legacy-native-route").activeRouteId
      ).toBe("legacy-native-route");
      expect(
        migratedSummary.models.find(
          (model) => model.id === "legacy-native-model"
        )?.verifiedCapabilities
      ).not.toContain("streaming");
      store.close();
      store = undefined;

      const migrated = new Database(databasePath);
      const columns = migrated
        .prepare("PRAGMA table_info(runtime_routes)")
        .all() as Array<{ name: string }>;
      const migration = migrated
        .prepare(
          "SELECT id FROM schema_migrations WHERE id = '2026-08-24-full-chain-streaming-routing-v1'"
        )
        .get() as { id: string } | undefined;
      migrated.close();
      expect(columns.map((column) => column.name)).toContain(
        "chat_streaming_enabled"
      );
      expect(migration?.id).toBe("2026-08-24-full-chain-streaming-routing-v1");
    } finally {
      store?.close();
      store = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function routeInput(
  route: ReturnType<VoxMeshStore["getRuntimeRoute"]> | undefined
) {
  if (!route) throw new Error("Expected a runtime route");
  return {
    displayName: route.displayName,
    mode: route.mode,
    sttModelDeploymentId: route.sttModelDeploymentId,
    chatModelDeploymentId: route.chatModelDeploymentId,
    ttsModelDeploymentId: route.ttsModelDeploymentId,
    nativeModelDeploymentId: route.nativeModelDeploymentId,
    fallbackRouteId: route.fallbackRouteId,
    sttStreamingEnabled: route.sttStreamingEnabled,
    chatStreamingEnabled: route.chatStreamingEnabled,
    ttsStreamingEnabled: route.ttsStreamingEnabled,
    enabled: route.enabled
  };
}
