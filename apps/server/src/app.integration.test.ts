import { afterEach, describe, expect, it } from "vitest";

import type { ConversationDetail, VoiceResponse } from "@voxmesh/shared";
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
        apiVersion: "2024-10-21"
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
