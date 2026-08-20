import { afterEach, describe, expect, it } from "vitest";

import type {
  ConversationDetail,
  ProviderCatalog,
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

    const providers = await app.inject({
      method: "GET",
      url: "/api/providers",
      headers: { cookie }
    });
    expect(providers.statusCode).toBe(200);
    const providerBody = JSON.parse(providers.body) as ProviderCatalog;
    expect(
      providerBody.providers.find((provider) => provider.id === "azure-openai")
        ?.capabilities
    ).toEqual(["llm", "stt", "tts"]);
    expect(
      providerBody.providers.find(
        (provider) => provider.id === "openai-compatible"
      )?.capabilities
    ).toEqual(["llm", "stt", "tts"]);
    expect(
      providerBody.providers.find(
        (provider) => provider.id === "alibaba-model-studio"
      )?.capabilities
    ).toEqual(["stt", "tts"]);

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

    const azureConfiguration = await app.inject({
      method: "PUT",
      url: "/api/config/llm",
      headers: { cookie },
      payload: {
        mode: "azure-openai",
        endpoint: "https://example.openai.azure.com",
        deployment: "gpt",
        apiVersion: "2025-01-01",
        baseUrl: "",
        model: "",
        timeoutMs: 30_000,
        maxOutputTokens: 1_024,
        apiKey: "write-only-secret"
      }
    });
    expect(azureConfiguration.statusCode).toBe(200);
    expect(azureConfiguration.json()).toMatchObject({
      mode: "azure-openai",
      apiKeyConfigured: true
    });
    expect(azureConfiguration.body).not.toContain("write-only-secret");

    await app.inject({
      method: "PUT",
      url: "/api/config/llm",
      headers: { cookie },
      payload: {
        mode: "mock",
        endpoint: "",
        deployment: "",
        apiVersion: "2024-10-21",
        baseUrl: "",
        model: "qwen-plus",
        timeoutMs: 30_000,
        maxOutputTokens: 1_024
      }
    });

    const compatibleConfiguration = await app.inject({
      method: "PUT",
      url: "/api/config/llm",
      headers: { cookie },
      payload: {
        mode: "openai-compatible",
        endpoint: "",
        deployment: "",
        apiVersion: "2024-10-21",
        baseUrl:
          "https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus",
        timeoutMs: 30_000,
        maxOutputTokens: 1_024,
        apiKey: "write-only-compatible-secret"
      }
    });
    expect(compatibleConfiguration.statusCode).toBe(200);
    expect(compatibleConfiguration.json()).toMatchObject({
      mode: "openai-compatible",
      model: "qwen-plus",
      apiKeyConfigured: true
    });
    expect(compatibleConfiguration.body).not.toContain(
      "write-only-compatible-secret"
    );

    await app.inject({
      method: "PUT",
      url: "/api/config/llm",
      headers: { cookie },
      payload: {
        mode: "mock",
        endpoint: "",
        deployment: "",
        apiVersion: "2024-10-21",
        baseUrl: "",
        model: "qwen-plus",
        timeoutMs: 30_000,
        maxOutputTokens: 1_024
      }
    });

    const speechConfiguration = await app.inject({
      method: "PUT",
      url: "/api/config/speech",
      headers: { cookie },
      payload: {
        sttMode: "azure-openai",
        ttsMode: "azure-openai",
        sttEndpoint: "https://stt.openai.azure.com",
        sttDeployment: "gpt-4o-mini-transcribe",
        sttApiVersion: "2025-04-01-preview",
        sttLanguage: "zh",
        sttApiKey: "write-only-stt-secret",
        ttsEndpoint: "https://tts.openai.azure.com",
        ttsDeployment: "gpt-4o-mini-tts",
        ttsApiVersion: "2025-03-01-preview",
        ttsVoice: "coral",
        ttsInstructions: "Speak warmly.",
        ttsApiKey: "write-only-tts-secret"
      }
    });
    expect(speechConfiguration.statusCode).toBe(200);
    expect(speechConfiguration.json()).toMatchObject({
      sttMode: "azure-openai",
      ttsMode: "azure-openai",
      sttApiKeyConfigured: true,
      ttsApiKeyConfigured: true
    });
    expect(speechConfiguration.body).not.toContain("write-only-stt-secret");
    expect(speechConfiguration.body).not.toContain("write-only-tts-secret");

    const alibabaSpeechConfiguration = await app.inject({
      method: "PUT",
      url: "/api/config/speech",
      headers: { cookie },
      payload: {
        sttMode: "alibaba-model-studio",
        ttsMode: "alibaba-model-studio",
        sttEndpoint:
          "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        sttDeployment: "fun-asr-realtime",
        sttApiVersion: "",
        sttLanguage: "zh",
        sttApiKey: "alibaba-stt-secret",
        ttsEndpoint:
          "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        ttsDeployment: "qwen-audio-3.0-tts-plus",
        ttsApiVersion: "",
        ttsVoice: "longanlingxin",
        ttsInstructions: "Speak naturally.",
        ttsApiKey: "alibaba-tts-secret"
      }
    });
    expect(alibabaSpeechConfiguration.statusCode).toBe(200);
    expect(alibabaSpeechConfiguration.json()).toMatchObject({
      sttMode: "alibaba-model-studio",
      ttsMode: "alibaba-model-studio",
      sttApiKeyConfigured: true,
      ttsApiKeyConfigured: true
    });
    expect(alibabaSpeechConfiguration.body).not.toContain("alibaba-stt-secret");
    expect(alibabaSpeechConfiguration.body).not.toContain("alibaba-tts-secret");

    await app.inject({
      method: "PUT",
      url: "/api/config/speech",
      headers: { cookie },
      payload: {
        sttMode: "mock",
        ttsMode: "mock",
        sttEndpoint: "",
        sttDeployment: "",
        sttApiVersion: "2025-04-01-preview",
        sttLanguage: "zh",
        ttsEndpoint: "",
        ttsDeployment: "",
        ttsApiVersion: "2025-03-01-preview",
        ttsVoice: "coral",
        ttsInstructions: "Speak clearly and naturally."
      }
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
      url: "/api/config/voice-pipeline",
      headers: { cookie },
      payload: {
        mode: "native-multimodal",
        nativeProviderId: "mock-native"
      }
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
