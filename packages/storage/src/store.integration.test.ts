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
      ttsStreamingEnabled: false,
      enabled: true
    });
    const route = routing.routes.find(
      (entry) => entry.displayName === "Streaming Composed"
    );
    expect(route?.sttStreamingEnabled).toBe(false);
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
      ttsStreamingEnabled: false,
      enabled: true
    });
    const route = routing.routes.find(
      (entry) => entry.displayName === "Unverified Streaming Route"
    );
    expect(() => activeStore.activateRuntimeRoute(route?.id ?? "")).toThrow(
      "Streaming routes cannot be activated"
    );
    activeStore.markRuntimeRouteVerified(
      activeStore.captureRuntimeRouteVerification(route?.id ?? "")
    );
    expect(() => activeStore.activateRuntimeRoute(route?.id ?? "")).toThrow(
      "Streaming routes cannot be activated"
    );
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
      sttStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const native = routing.routes.find(
      (route) => route.displayName === "Native With Fallback"
    );
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
    ttsStreamingEnabled: route.ttsStreamingEnabled,
    enabled: route.enabled
  };
}
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
