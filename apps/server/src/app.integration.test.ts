import { afterEach, describe, expect, it } from "vitest";

import type {
  ConversationDetail,
  Dashboard,
  RuntimeRoutingSummary,
  VoiceResponse
} from "@voxmesh/shared";
import { VoxMeshStore } from "@voxmesh/storage";

import { buildServer } from "./app.js";
import type { ServerConfig } from "./config.js";

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
      payload: { message: "Check the light status" }
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json()).toMatchObject({
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
    await app.close();
  });
});
