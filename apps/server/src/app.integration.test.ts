import { afterEach, describe, expect, it } from "vitest";

import type { LlmProvider } from "@voxmesh/agent-core";
import type {
  AgentMessage,
  ConversationDetail,
  Dashboard,
  RuntimeRoutingSummary,
  VoiceResponse
} from "@voxmesh/shared";
import { VoxMeshStore } from "@voxmesh/storage";

import { buildServer } from "./app.js";
import type { ServerConfig } from "./config.js";
import type { DeviceStatusProvider } from "./device-status.js";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 3000,
  databasePath: ":memory:",
  cookieSecure: false,
  sessionTtlSeconds: 3600,
  webRoot: "/does-not-exist"
};

let store: VoxMeshStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

describe("server API", () => {
  it("completes setup, login, and a tool-assisted chat", async () => {
    store = new VoxMeshStore(":memory:");
    const app = await buildServer({ config, store });

    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { password: "a secure administrator password" }
    });
    expect(setup.statusCode).toBe(201);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "a secure administrator password" }
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
      ";"
    )[0];
    expect(cookie).toBeTruthy();

    const routing = await app.inject({
      method: "GET",
      url: "/api/runtime-routing",
      headers: { cookie }
    });
    expect(routing.statusCode).toBe(200);
    const routingBody = JSON.parse(routing.body) as RuntimeRoutingSummary;
    expect(routingBody).toMatchObject({
      activeRouteId: "system-route-composed"
    });
    expect(routingBody.connections).toHaveLength(4);
    expect(routingBody.models).toHaveLength(4);
    expect(
      routingBody.connections.every(
        (connection) => !Object.hasOwn(connection, "apiKey")
      )
    ).toBe(true);

    const createdConnection = await app.inject({
      method: "POST",
      url: "/api/runtime-routing/connections",
      headers: { cookie },
      payload: {
        providerId: "mock",
        displayName: "Custom Mock",
        endpoint: "",
        enabled: true
      }
    });
    expect(createdConnection.statusCode).toBe(201);
    const connectionId = createdConnection
      .json<RuntimeRoutingSummary>()
      .connections.find((entry) => entry.displayName === "Custom Mock")?.id;

    const createdModel = await app.inject({
      method: "POST",
      url: "/api/runtime-routing/models",
      headers: { cookie },
      payload: {
        connectionId,
        displayName: "Custom Streaming STT",
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
      }
    });
    expect(createdModel.statusCode).toBe(201);
    const modelId = createdModel
      .json<RuntimeRoutingSummary>()
      .models.find((entry) => entry.displayName === "Custom Streaming STT")?.id;

    const createdRoute = await app.inject({
      method: "POST",
      url: "/api/runtime-routing/routes",
      headers: { cookie },
      payload: {
        displayName: "Custom Streaming Composed",
        mode: "composed",
        sttModelDeploymentId: modelId,
        chatModelDeploymentId: "system-model-chat",
        ttsModelDeploymentId: "system-model-tts",
        nativeModelDeploymentId: null,
        fallbackRouteId: null,
        sttStreamingEnabled: false,
        ttsStreamingEnabled: false,
        enabled: true
      }
    });
    expect(createdRoute.statusCode).toBe(201);
    const routeId = createdRoute
      .json<RuntimeRoutingSummary>()
      .routes.find(
        (entry) => entry.displayName === "Custom Streaming Composed"
      )?.id;
    const routeTest = await app.inject({
      method: "POST",
      url: `/api/runtime-routing/routes/${routeId}/test`,
      headers: { cookie }
    });
    expect(routeTest.statusCode).toBe(200);
    const activation = await app.inject({
      method: "PUT",
      url: "/api/runtime-routing/active",
      headers: { cookie },
      payload: { routeId }
    });
    expect(activation.statusCode).toBe(200);
    expect(activation.json()).toMatchObject({ activeRouteId: routeId });

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie }
    });
    expect(dashboard.statusCode).toBe(200);
    const dashboardBody = dashboard.json<Dashboard>();
    expect(dashboardBody).toMatchObject({
      status: "online",
      routing: {
        activeRouteId: routeId
      }
    });
    expect(
      dashboardBody.routing.routes.find((route) => route.id === routeId)
    ).toMatchObject({
      displayName: "Custom Streaming Composed"
    });
    expect(dashboardBody).not.toHaveProperty("providers");

    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: {
        runId: "11111111-1111-4111-8111-111111111111",
        message: "Check the light status"
      }
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json()).toMatchObject({
      runId: "11111111-1111-4111-8111-111111111111",
      usedTools: ["mock.get_device_status"]
    });

    const conversations = await app.inject({
      method: "GET",
      url: "/api/conversations",
      headers: { cookie }
    });
    expect(conversations.json()).toMatchObject({
      conversations: [expect.objectContaining({ messageCount: 3 })]
    });

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie }
    });
    expect(logout.statusCode).toBe(204);

    await app.close();
  });

  it("changes the administrator password and revokes sessions", async () => {
    store = new VoxMeshStore(":memory:");
    const app = await buildServer({ config, store });
    await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { password: "original administrator password" }
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "original administrator password" }
    });
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
      ";"
    )[0];

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie },
      payload: {
        currentPassword: "original administrator password",
        newPassword: "replacement administrator password"
      }
    });
    expect(changed.statusCode).toBe(204);

    const expiredSession = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie }
    });
    expect(expiredSession.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "replacement administrator password" }
    });
    expect(newLogin.statusCode).toBe(200);
    await app.close();
  });

  it("continues Chat in one conversation with durable history", async () => {
    store = new VoxMeshStore(":memory:");
    const requests: AgentMessage[][] = [];
    const provider: LlmProvider = {
      complete: async ({ messages }) => {
        requests.push(messages.map((message) => ({ ...message })));
        return {
          type: "message",
          content: requests.length === 1 ? "First answer" : "Second answer"
        };
      }
    };
    const app = await buildServer({
      config,
      store,
      createLlm: () => provider
    });

    await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { password: "a secure administrator password" }
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "a secure administrator password" }
    });
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
      ";"
    )[0];
    const first = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: {
        runId: "77777777-7777-4777-8777-777777777777",
        message: "First question"
      }
    });
    const conversationId = first.json<{ conversationId: string }>()
      .conversationId;
    const second = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: {
        runId: "88888888-8888-4888-8888-888888888888",
        conversationId,
        message: "Second question"
      }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      conversationId,
      response: "Second answer"
    });
    expect(requests[1]).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" }
    ]);
    expect(store.getConversation(conversationId)?.messages).toHaveLength(4);

    await app.close();
  });

  it("returns authenticated platform-independent device status", async () => {
    store = new VoxMeshStore(":memory:");
    const observedAt = "2026-08-21T00:00:00.000Z";
    const deviceStatusProvider: DeviceStatusProvider = {
      getStatus: async () => ({
        device: {
          status: "degraded",
          displayName: "Mock edge device",
          detailCode: "thermal-throttling",
          observedAt
        },
        audio: {
          input: {
            status: "ready",
            displayName: "Mock microphone",
            detailCode: null,
            observedAt
          },
          output: {
            status: "failed",
            displayName: "Mock speaker",
            detailCode: "playback-unavailable",
            observedAt
          }
        },
        system: {
          cpuUsage: {
            status: "stale",
            value: 42,
            unit: "percent",
            detailCode: "stale-sample",
            observedAt
          },
          memoryUsage: {
            status: "ready",
            value: 134_217_728,
            unit: "bytes",
            detailCode: null,
            observedAt
          },
          temperature: {
            status: "unavailable",
            value: null,
            unit: "celsius",
            detailCode: "sensor-unavailable",
            observedAt: null
          }
        }
      })
    };
    const app = await buildServer({ config, store, deviceStatusProvider });
    await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { password: "a secure administrator password" }
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "a secure administrator password" }
    });
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
      ";"
    )[0];

    const response = await app.inject({
      method: "GET",
      url: "/api/device",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      device: { status: "degraded", displayName: "Mock edge device" },
      audio: {
        input: { status: "ready" },
        output: { status: "failed" }
      },
      system: {
        cpuUsage: { status: "stale", value: 42 },
        temperature: { status: "unavailable", value: null }
      }
    });

    await app.close();
  });

  it("cancels an active Chat run idempotently", async () => {
    store = new VoxMeshStore(":memory:");
    let completionCount = 0;
    const delayedLlm: LlmProvider = {
      complete: async ({ signal }) => {
        completionCount += 1;
        if (completionCount > 1) {
          return { type: "message", content: "Retry completed" };
        }
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      }
    };
    const app = await buildServer({
      config,
      store,
      createLlm: () => delayedLlm
    });
    await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { password: "a secure administrator password" }
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "a secure administrator password" }
    });
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
      ";"
    )[0];
    const runId = "44444444-4444-4444-8444-444444444444";
    const chatRequest = app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { runId, message: "Wait until cancelled" }
    });
    let runStarted = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        store.getConversationRun(runId);
        runStarted = true;
        break;
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("statusCode" in error) ||
          error.statusCode !== 404
        ) {
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(runStarted).toBe(true);

    const externallyCancelled = store.cancelChatRun(runId);
    const cancellation = await app.inject({
      method: "POST",
      url: `/api/chat/runs/${runId}/cancel`,
      headers: { cookie }
    });
    const repeatedCancellation = await app.inject({
      method: "POST",
      url: `/api/chat/runs/${runId}/cancel`,
      headers: { cookie }
    });
    const chat = await chatRequest;
    const run = await app.inject({
      method: "GET",
      url: `/api/chat/runs/${runId}`,
      headers: { cookie }
    });

    expect(externallyCancelled.transitioned).toBe(true);
    expect(cancellation.statusCode).toBe(200);
    expect(cancellation.json()).toMatchObject({
      status: "cancelled",
      errorCode: "RUN_CANCELLED"
    });
    expect(repeatedCancellation.statusCode).toBe(200);
    expect(repeatedCancellation.json()).toMatchObject({
      status: "cancelled"
    });
    expect(chat.statusCode).toBe(409);
    expect(chat.json()).toMatchObject({
      error: { code: "RUN_CANCELLED" }
    });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({
      id: runId,
      status: "cancelled"
    });
    const retryRunId = "66666666-6666-4666-8666-666666666666";
    const retry = await app.inject({
      method: "POST",
      url: `/api/chat/runs/${runId}/retry`,
      headers: { cookie },
      payload: { runId: retryRunId }
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({
      runId: retryRunId,
      response: "Retry completed"
    });
    const conversation = store.getConversation(
      cancellation.json<{ conversationId: string }>().conversationId
    );
    expect(conversation?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant"
    ]);
    expect(conversation?.runs).toEqual([
      expect.objectContaining({ id: runId, status: "cancelled" }),
      expect.objectContaining({
        id: retryRunId,
        status: "completed",
        retryOfRunId: runId
      })
    ]);

    await app.close();
  });

  it("cancels an active Chat run when the HTTP client disconnects", async () => {
    store = new VoxMeshStore(":memory:");
    let providerSignal: AbortSignal | undefined;
    const delayedLlm: LlmProvider = {
      complete: async ({ signal }) => {
        providerSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      }
    };
    const app = await buildServer({
      config,
      store,
      createLlm: () => delayedLlm
    });
    await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { password: "a secure administrator password" }
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "a secure administrator password" }
    });
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
      ";"
    )[0];
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const runId = "55555555-5555-4555-8555-555555555555";
    const controller = new AbortController();
    const request = fetch(`${address}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookie ?? ""
      },
      body: JSON.stringify({ runId, message: "Disconnect this request" }),
      signal: controller.signal
    });
    for (let attempt = 0; attempt < 40 && !providerSignal; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(providerSignal).toBeDefined();

    controller.abort();
    await expect(request).rejects.toThrow();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (store.getConversationRun(runId).status === "cancelled") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(providerSignal?.aborted).toBe(true);
    expect(store.getConversationRun(runId)).toMatchObject({
      status: "cancelled",
      errorCode: "RUN_CANCELLED"
    });

    await app.close();
  });

  it("runs the complete Mock Voice pipeline", async () => {
    store = new VoxMeshStore(":memory:");
    const app = await buildServer({ config, store });
    await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { password: "voice administrator password" }
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "voice administrator password" }
    });
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
      ";"
    )[0];

    const voice = await app.inject({
      method: "POST",
      url: "/api/voice",
      headers: {
        cookie,
        "content-type": "audio/webm"
      },
      payload: Buffer.from("mock audio")
    });

    expect(voice.statusCode).toBe(200);
    const voiceBody = JSON.parse(voice.body) as VoiceResponse;
    expect(voiceBody).toMatchObject({
      transcript: "Check the light status",
      usedTools: ["mock.get_device_status"],
      audio: {
        mimeType: "audio/wav"
      }
    });
    expect(voiceBody.audio.base64).toMatch(/^UklGR/);

    const detail = await app.inject({
      method: "GET",
      url: `/api/conversations/${voiceBody.conversationId}`,
      headers: { cookie }
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = JSON.parse(detail.body) as ConversationDetail;
    expect(
      detailBody.events.map((event) => `${event.stage}:${event.status}`)
    ).toEqual(
      expect.arrayContaining([
        "STT:completed",
        "AGENT:completed",
        "MCP:completed",
        "TTS:completed"
      ])
    );
    await app.close();
  });

  it("runs the Mock Native Multimodal pipeline", async () => {
    store = new VoxMeshStore(":memory:");
    const app = await buildServer({ config, store });
    await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { password: "native administrator password" }
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "native administrator password" }
    });
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
      ";"
    )[0];
    const route = await app.inject({
      method: "PUT",
      url: "/api/runtime-routing/active",
      headers: { cookie },
      payload: { routeId: "system-route-native" }
    });
    expect(route.statusCode).toBe(200);

    const voice = await app.inject({
      method: "POST",
      url: "/api/voice",
      headers: { cookie, "content-type": "audio/webm" },
      payload: Buffer.from("mock native audio")
    });

    expect(voice.statusCode).toBe(200);
    expect(voice.json()).toMatchObject({
      transcript: "Check the light status",
      response: "Native multimodal model reports living-room-light is on.",
      usedTools: ["mock.get_device_status"],
      audio: { mimeType: "audio/wav" }
    });
    await app.close();
  });

  it("protects authenticated routes", async () => {
    store = new VoxMeshStore(":memory:");
    const app = await buildServer({ config, store });

    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" }
    });
    const device = await app.inject({
      method: "GET",
      url: "/api/device"
    });
    expect(device.statusCode).toBe(401);
    await app.close();
  });
});
