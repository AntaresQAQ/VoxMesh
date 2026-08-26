import type { AddressInfo } from "node:net";

import type { FastifyInstance } from "fastify";
import WebSocket, { type RawData } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { MockLlmProvider, MockStreamingLlmProvider } from "@voxmesh/agent-core";
import {
  MockSpeechToTextProvider,
  MockStreamingSpeechToTextProvider,
  MockStreamingTextToSpeechProvider,
  MockTextToSpeechProvider
} from "@voxmesh/audio";
import {
  VOICE_STREAM_LIMITS,
  VOICE_STREAM_PROTOCOL_VERSION,
  VoiceStreamServerProtocolState,
  decodeVoiceStreamBinaryFrame,
  encodeVoiceStreamBinaryFrame,
  parseVoiceStreamControlMessage,
  type VoiceStreamClientMessage,
  type VoiceStreamServerMessage
} from "@voxmesh/shared";
import { VoxMeshStore } from "@voxmesh/storage";

import { buildServer } from "./app.js";
import type { ServerConfig } from "./config.js";
import type { StreamingVoiceRunPreparation } from "./streaming-voice-coordinator.js";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 3000,
  databasePath: ":memory:",
  cookieSecure: false,
  sessionTtlSeconds: 3600,
  webRoot: "/does-not-exist"
};

let store: VoxMeshStore | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  store?.close();
  store = undefined;
});

describe("voice stream WebSocket", () => {
  for (let mask = 0; mask < 8; mask += 1) {
    const profile = {
      stt: (mask & 4) !== 0,
      chat: (mask & 2) !== 0,
      tts: (mask & 1) !== 0
    };
    it(`completes raw Mock profile ${mask}`, async () => {
      store = new VoxMeshStore(":memory:");
      app = await buildServer({
        config,
        store,
        prepareStreamingVoiceRun: () => preparation(profile)
      });
      const cookie = await authenticate(app);
      const baseUrl = await listen(app);
      const start = startMessage(runId(mask));
      const client = await connectVoice(
        `${baseUrl}/api/voice-stream`,
        cookie,
        start
      );

      expect(await client.nextControl("voice.ready")).toMatchObject({
        runId: start.runId,
        profile: {
          stt: transport(profile.stt),
          chat: transport(profile.chat),
          tts: transport(profile.tts)
        }
      });
      client.sendAudio(1);
      client.sendAudio(2);
      client.sendControl({
        ...baseClientControl(start, "voice.input_finished", 1)
      });

      const completed = await client.nextControl("voice.completed");
      expect(completed.runId).toBe(start.runId);
      const run = store.getConversationRun(start.runId);
      expect(run).toMatchObject({
        kind: "voice-composed",
        status: "completed"
      });
      expect(
        store
          .getConversation(run.conversationId)
          ?.messages.map(({ role, content }) => ({ role, content }))
      ).toEqual([
        { role: "user", content: "Check the light status" },
        {
          role: "assistant",
          content: "Mock tool reports living-room-light is on."
        }
      ]);
      client.socket.close();
    });
  }

  it("rejects unauthenticated and cross-origin upgrades without affecting events", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({ config, store });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const origin = baseUrl.replace(/^ws/, "http");

    await expectRejected(`${baseUrl}/api/voice-stream`, undefined, origin, 401);
    await expectRejected(
      `${baseUrl}/api/voice-stream`,
      cookie,
      "http://attacker.example",
      403
    );
    await expectRejected(`${baseUrl}/api/unknown`, cookie, origin, 404);
    const events = await connectRawWithFirstMessage(
      `${baseUrl}/api/events`,
      cookie
    );
    events.close();
  });

  it("rejects invalid control and binary ordering", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({
      config,
      store,
      prepareStreamingVoiceRun: () =>
        preparation({ stt: true, chat: true, tts: true })
    });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const start = startMessage("71717171-7171-4171-8171-717171717171");
    const client = await connectVoice(
      `${baseUrl}/api/voice-stream`,
      cookie,
      start
    );
    await client.nextControl("voice.ready");

    client.sendAudio(2);
    await expect(client.nextControl("voice.failed")).resolves.toMatchObject({
      stage: "transport",
      code: "INVALID_SEQUENCE"
    });
  });

  it("rejects invalid version and session correlation", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({
      config,
      store,
      prepareStreamingVoiceRun: () =>
        preparation({ stt: true, chat: true, tts: true })
    });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);

    const versionStart = startMessage("74747474-7474-4474-8474-747474747474");
    const versionClient = await connectVoice(
      `${baseUrl}/api/voice-stream`,
      cookie,
      versionStart
    );
    await versionClient.nextControl("voice.ready");
    const versionClosed = waitForClose(versionClient.socket);
    versionClient.socket.send(
      JSON.stringify({
        ...baseClientControl(versionStart, "voice.input_finished", 1),
        version: 2
      })
    );
    await expect(
      versionClient.nextControl("voice.failed")
    ).resolves.toMatchObject({ code: "INVALID_MESSAGE" });
    expect(await versionClosed).toBe(1008);

    const sessionStart = startMessage("75757575-7575-4575-8575-757575757575");
    const sessionClient = await connectVoice(
      `${baseUrl}/api/voice-stream`,
      cookie,
      sessionStart
    );
    await sessionClient.nextControl("voice.ready");
    const invalidSessionControl = JSON.stringify({
      ...baseClientControl(sessionStart, "voice.input_finished", 1),
      sessionId: crypto.randomUUID()
    });
    sessionClient.socket.send(invalidSessionControl);
    sessionClient.socket.send(invalidSessionControl);
    await expect(
      sessionClient.nextControl("voice.failed")
    ).resolves.toMatchObject({ code: "INVALID_MESSAGE" });
  });

  it("rejects control messages before start and invalid frame versions", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({
      config,
      store,
      prepareStreamingVoiceRun: () =>
        preparation({ stt: true, chat: true, tts: true })
    });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const raw = await connectRaw(`${baseUrl}/api/voice-stream`, cookie);
    raw.send(
      JSON.stringify({
        version: 1,
        type: "voice.input_finished",
        sessionId: crypto.randomUUID(),
        sequence: 1
      })
    );
    expect(await waitForClose(raw)).toBe(1008);

    const start = startMessage("76767676-7676-4676-8676-767676767676");
    const client = await connectVoice(
      `${baseUrl}/api/voice-stream`,
      cookie,
      start
    );
    await client.nextControl("voice.ready");
    const frame = encodeVoiceStreamBinaryFrame({
      version: 1,
      direction: "input",
      sequence: 1,
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      frameSamples: 320,
      data: new Uint8Array(640)
    });
    frame[0] = 2;
    client.socket.send(frame);
    await expect(client.nextControl("voice.failed")).resolves.toMatchObject({
      code: "UNSUPPORTED_VERSION"
    });
  });

  it("enforces the per-administrator session limit", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({ config, store });
    const cookie = await authenticate(app);
    const secondCookie = await login(
      app,
      "voice stream administrator password"
    );
    const baseUrl = await listen(app);
    const first = await connectRaw(`${baseUrl}/api/voice-stream`, cookie);

    await expectRejected(
      `${baseUrl}/api/voice-stream`,
      secondCookie,
      baseUrl.replace(/^ws/, "http"),
      503
    );
    first.close();
  });

  it("rate-limits input frames", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({
      config,
      store,
      prepareStreamingVoiceRun: () =>
        preparation({ stt: true, chat: false, tts: false })
    });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const start = startMessage("72727272-7272-4272-8272-727272727272");
    const client = await connectVoice(
      `${baseUrl}/api/voice-stream`,
      cookie,
      start
    );
    await client.nextControl("voice.ready");

    for (
      let sequence = 1;
      sequence <= VOICE_STREAM_LIMITS.maxInputFramesPerSecond + 1;
      sequence += 1
    ) {
      client.sendAudio(sequence);
    }
    await expect(client.nextControl("voice.failed")).resolves.toMatchObject({
      code: "RATE_LIMITED"
    });
  });

  it("cancels a run when the socket disconnects", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({
      config,
      store,
      prepareStreamingVoiceRun: () =>
        preparation({ stt: true, chat: true, tts: true })
    });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const start = startMessage("73737373-7373-4373-8373-737373737373");
    const client = await connectVoice(
      `${baseUrl}/api/voice-stream`,
      cookie,
      start
    );
    await client.nextControl("voice.ready");
    client.sendAudio(1);
    client.socket.terminate();

    await waitForRunStatus(store, start.runId, "cancelled");
  });

  it("cancels a run after an explicit client cancel", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({
      config,
      store,
      prepareStreamingVoiceRun: () =>
        preparation({ stt: true, chat: true, tts: true })
    });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const start = startMessage("78787878-7878-4878-8878-787878787878");
    const client = await connectVoice(
      `${baseUrl}/api/voice-stream`,
      cookie,
      start
    );
    await client.nextControl("voice.ready");
    client.sendControl({
      version: 1,
      type: "voice.cancel",
      sessionId: start.sessionId,
      sequence: 1,
      reason: "user"
    });

    await expect(client.nextControl("voice.cancelled")).resolves.toMatchObject({
      code: "RUN_CANCELLED"
    });
    await waitForRunStatus(store, start.runId, "cancelled");
  });

  it("closes a connection that does not start before setup timeout", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({
      config,
      store,
      voiceSetupTimeoutMs: 20
    });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const socket = await connectRaw(`${baseUrl}/api/voice-stream`, cookie);

    expect(await waitForClose(socket)).toBe(1013);
  });

  it("closes an established voice stream when its session is revoked", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({
      config,
      store,
      voiceHeartbeatMs: 20,
      prepareStreamingVoiceRun: () =>
        preparation({ stt: true, chat: true, tts: true })
    });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const start = startMessage("77777777-7777-4777-8777-777777777777");
    const client = await connectVoice(
      `${baseUrl}/api/voice-stream`,
      cookie,
      start
    );
    await client.nextControl("voice.ready");

    const closed = waitForClose(client.socket);
    store.deleteAllSessions();
    expect(await closed).toBe(4401);
    await waitForRunStatus(store, start.runId, "cancelled");
    expect(
      client.controls.some((message) => message.type === "voice.failed")
    ).toBe(false);
  });

  it("terminates voice clients during server shutdown", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({ config, store });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const socket = await connectRaw(`${baseUrl}/api/voice-stream`, cookie);
    const closed = waitForClose(socket);
    const runningApp = app;
    app = undefined;

    await expect(
      Promise.race([
        runningApp.close().then(() => "closed"),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("timed-out"), 2_000)
        )
      ])
    ).resolves.toBe("closed");
    await closed;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});

function preparation(profile: {
  stt: boolean;
  chat: boolean;
  tts: boolean;
}): StreamingVoiceRunPreparation {
  const assignment = (
    role: "stt" | "chat" | "tts",
    streamingEnabled: boolean
  ) => ({
    role,
    modelDeploymentId: `mock-${role}`,
    modelDisplayName: `Mock ${role.toUpperCase()}`,
    providerId: "mock",
    providerDisplayName: "Mock",
    configurationFingerprint: `mock-${role}-fingerprint`,
    streamingEnabled
  });
  return {
    route: {
      routeId: "mock-route",
      routeDisplayName: "Mock Route",
      mode: "composed",
      configurationFingerprint: "mock-route-fingerprint",
      assignments: [
        assignment("stt", profile.stt),
        assignment("chat", profile.chat),
        assignment("tts", profile.tts)
      ]
    },
    providers: {
      bufferedStt: new MockSpeechToTextProvider(),
      streamingStt: new MockStreamingSpeechToTextProvider(),
      bufferedLlm: new MockLlmProvider(),
      streamingLlm: new MockStreamingLlmProvider(),
      bufferedTts: new MockTextToSpeechProvider(),
      streamingTts: new MockStreamingTextToSpeechProvider()
    }
  };
}

function startMessage(
  runId: string
): Extract<VoiceStreamClientMessage, { type: "voice.start" }> {
  return {
    version: VOICE_STREAM_PROTOCOL_VERSION,
    type: "voice.start",
    sessionId: crypto.randomUUID(),
    sequence: 0,
    runId,
    toolMode: "enabled",
    inputFormat: {
      encoding: "pcm16le",
      sampleRate: 16_000,
      channels: 1,
      frameDurationMs: 20
    }
  };
}

function baseClientControl(
  start: Extract<VoiceStreamClientMessage, { type: "voice.start" }>,
  type: "voice.input_finished",
  sequence: number
) {
  return {
    version: VOICE_STREAM_PROTOCOL_VERSION,
    type,
    sessionId: start.sessionId,
    sequence
  } as const;
}

async function authenticate(app: FastifyInstance): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/setup",
    payload: { password: "voice stream administrator password" }
  });
  return login(app, "voice stream administrator password");
}

async function login(app: FastifyInstance, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password }
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
    ";"
  )[0];
  if (!cookie) throw new Error("Expected an authenticated session cookie");
  return cookie;
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}`;
}

async function connectVoice(
  url: string,
  cookie: string,
  start: Extract<VoiceStreamClientMessage, { type: "voice.start" }>
) {
  const socket = await connectRaw(url, cookie);
  const state = new VoiceStreamServerProtocolState(start);
  const controls: VoiceStreamServerMessage[] = [];
  const waiters: Array<() => void> = [];
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      state.acceptAudio(decodeVoiceStreamBinaryFrame(rawDataBytes(data)));
    } else {
      const parsed = parseVoiceStreamControlMessage(rawDataText(data));
      if (!parsed || !isServerMessage(parsed)) {
        throw new Error("Server sent an invalid voice control");
      }
      state.acceptControl(parsed);
      controls.push(parsed);
    }
    waiters.shift()?.();
  });
  socket.send(JSON.stringify(start));
  return {
    socket,
    controls,
    sendAudio: (sequence: number) => {
      socket.send(
        encodeVoiceStreamBinaryFrame({
          version: VOICE_STREAM_PROTOCOL_VERSION,
          direction: "input",
          sequence,
          format: {
            encoding: "pcm16le",
            sampleRate: 16_000,
            channels: 1
          },
          frameSamples: 320,
          data: new Uint8Array(640)
        })
      );
    },
    sendControl: (message: VoiceStreamClientMessage) => {
      socket.send(JSON.stringify(message));
    },
    nextControl: async <T extends VoiceStreamServerMessage["type"]>(
      type: T
    ) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const index = controls.findIndex((message) => message.type === type);
        if (index >= 0) {
          return controls.splice(index, 1)[0] as Extract<
            VoiceStreamServerMessage,
            { type: T }
          >;
        }
        await waitForMessage(waiters, deadline);
      }
      throw new Error(`Timed out waiting for ${type}`);
    }
  };
}

async function connectRaw(url: string, cookie: string): Promise<WebSocket> {
  const origin = url.replace(/^ws/, "http").replace(/\/api\/.*$/, "");
  const socket = new WebSocket(url, {
    headers: { Cookie: cookie, Origin: origin }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

async function connectRawWithFirstMessage(
  url: string,
  cookie: string
): Promise<WebSocket> {
  const origin = url.replace(/^ws/, "http").replace(/\/api\/.*$/, "");
  const socket = new WebSocket(url, {
    headers: { Cookie: cookie, Origin: origin }
  });
  await new Promise<void>((resolve, reject) => {
    let opened = false;
    let received = false;
    const finish = () => {
      if (opened && received) resolve();
    };
    socket.once("open", () => {
      opened = true;
      finish();
    });
    socket.once("message", () => {
      received = true;
      finish();
    });
    socket.once("error", reject);
  });
  return socket;
}

function isServerMessage(
  message: ReturnType<typeof parseVoiceStreamControlMessage>
): message is VoiceStreamServerMessage {
  return (
    message !== null &&
    message.type !== "voice.start" &&
    message.type !== "voice.input_finished" &&
    message.type !== "voice.cancel"
  );
}

function rawDataBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function rawDataText(data: RawData): string {
  return Buffer.from(rawDataBytes(data)).toString("utf8");
}

function waitForMessage(
  waiters: Array<() => void>,
  deadline: number
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
    waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForClose(socket: WebSocket): Promise<number> {
  if (socket.readyState === WebSocket.CLOSED) return 1000;
  return new Promise<number>((resolve) => socket.once("close", resolve));
}

async function expectRejected(
  url: string,
  cookie: string | undefined,
  origin: string,
  expectedStatus: number
): Promise<void> {
  const socket = new WebSocket(url, {
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {})
    }
  });
  const status = await new Promise<number>((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
      response.destroy();
    });
    socket.once("error", reject);
  });
  expect(status).toBe(expectedStatus);
}

async function waitForRunStatus(
  store: VoxMeshStore,
  runId: string,
  status: "cancelled"
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      if (store.getConversationRun(runId).status === status) return;
    } catch {
      // Run creation races the first ready message.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for run ${status}`);
}

function transport(streaming: boolean): "buffered" | "streaming" {
  return streaming ? "streaming" : "buffered";
}

function runId(mask: number): string {
  return `80808080-8080-4080-8080-${String(mask).padStart(12, "0")}`;
}
