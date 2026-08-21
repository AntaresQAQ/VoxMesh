import type { AddressInfo } from "node:net";

import type { FastifyInstance } from "fastify";
import WebSocket, { type RawData } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseEventStreamMessage,
  type EventStreamMessage
} from "@voxmesh/shared/event-stream";
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
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  store?.close();
  store = undefined;
});

describe("real-time observability WebSocket", () => {
  it("authenticates, replays, and streams redacted persisted events", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({ config, store, eventHeartbeatMs: 100 });
    const cookie = await authenticate(app);
    store.addLog({
      category: "SYSTEM",
      level: "INFO",
      message: "apiKey=before-connect"
    });
    const baseUrl = await listen(app);
    const client = await connect(`${baseUrl}/api/events?after=2`, cookie);

    expect(await client.next("stream.ready")).toMatchObject({
      latestSequence: 3,
      oldestAvailableSequence: 1
    });
    expect(await client.next("stream.event")).toMatchObject({
      event: {
        sequence: 3,
        type: "log.created",
        payload: { log: { message: "apiKey=[REDACTED]" } }
      }
    });

    store.addLog({
      category: "AUTH",
      level: "WARN",
      message: "apiKey=live-value"
    });
    expect(await client.next("stream.event")).toMatchObject({
      event: {
        sequence: 4,
        payload: { log: { message: "apiKey=[REDACTED]" } }
      }
    });
    const conversationId = store.createConversation("Observe pipeline");
    store.addPipelineEvent({
      conversationId,
      stage: "AGENT",
      status: "completed",
      message: "Agent completed"
    });
    expect(await client.next("stream.event")).toMatchObject({
      event: {
        sequence: 5,
        type: "message.created",
        payload: { conversationId }
      }
    });
    expect(await client.next("stream.event")).toMatchObject({
      event: {
        sequence: 6,
        type: "pipeline.created",
        payload: {
          conversationId,
          event: { stage: "AGENT", status: "completed" }
        }
      }
    });

    client.socket.close();
  });

  it("reports replay gaps when the bounded buffer overflows", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({
      config,
      store,
      eventBufferCapacity: 2
    });
    const cookie = await authenticate(app);
    for (const message of ["one", "two", "three"]) {
      store.addLog({ category: "SYSTEM", level: "INFO", message });
    }
    const baseUrl = await listen(app);
    const client = await connect(`${baseUrl}/api/events?after=0`, cookie);

    expect(await client.next("stream.ready")).toMatchObject({
      latestSequence: 5,
      oldestAvailableSequence: 4
    });
    const gap = await client.next("stream.gap");
    expect(typeof gap.streamId).toBe("string");
    expect(gap).toMatchObject({
      version: 1,
      type: "stream.gap",
      requestedAfter: 0,
      oldestAvailableSequence: 4,
      latestSequence: 5
    });
    expect(
      (await client.next("stream.event")).type === "stream.event"
        ? "event"
        : "unexpected"
    ).toBe("event");

    client.socket.close();
  });

  it("rejects unauthenticated and cross-origin upgrades", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({ config, store });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const origin = baseUrl.replace(/^ws/, "http");

    await expectRejected(`${baseUrl}/api/events`, undefined, origin, 401);
    await expectRejected(
      `${baseUrl}/api/events`,
      cookie,
      "http://attacker.example",
      403
    );
    await expectRejected(`${baseUrl}/api/events?after=-1`, cookie, origin, 400);
    await expectRejected(`${baseUrl}/api/events`, cookie, origin, 400, "[");
  });

  it("bounds concurrent event-stream clients", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({ config, store, eventMaxClients: 1 });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const first = await connect(`${baseUrl}/api/events`, cookie);

    await expectRejected(
      `${baseUrl}/api/events`,
      cookie,
      baseUrl.replace(/^ws/, "http"),
      503
    );

    first.socket.close();
  });

  it("closes an established stream when its session is revoked", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({ config, store, eventHeartbeatMs: 20 });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const client = await connect(`${baseUrl}/api/events`, cookie);
    await client.next("stream.ready");

    store.deleteAllSessions();
    const code = await new Promise<number>((resolve) =>
      client.socket.once("close", resolve)
    );

    expect(code).toBe(4401);
  });

  it("terminates connected clients during server shutdown", async () => {
    store = new VoxMeshStore(":memory:");
    app = await buildServer({ config, store });
    const cookie = await authenticate(app);
    const baseUrl = await listen(app);
    const client = await connect(`${baseUrl}/api/events`, cookie);
    await client.next("stream.ready");
    const runningApp = app;
    app = undefined;

    await expect(
      Promise.race([
        runningApp.close().then(() => "closed"),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("timed-out"), 500)
        )
      ])
    ).resolves.toBe("closed");
  });
});

async function authenticate(
  app: Awaited<ReturnType<typeof buildServer>>
): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/setup",
    payload: { password: "real-time administrator password" }
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: "real-time administrator password" }
  });
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
    ";"
  )[0];
  if (!cookie) throw new Error("Expected an authenticated session cookie");
  return cookie;
}

async function listen(
  app: Awaited<ReturnType<typeof buildServer>>
): Promise<string> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}`;
}

async function connect(url: string, cookie: string) {
  const origin = url.replace(/^ws/, "http").replace(/\/api\/.*$/, "");
  const socket = new WebSocket(url, {
    headers: { Cookie: cookie, Origin: origin }
  });
  const messages: EventStreamMessage[] = [];
  const waiters: Array<() => void> = [];
  socket.on("message", (data) => {
    const parsed = parseEventStreamMessage(rawDataText(data));
    if (!parsed) throw new Error("Server sent an invalid event-stream message");
    messages.push(parsed);
    waiters.shift()?.();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    next: async <T extends EventStreamMessage["type"]>(type: T) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const index = messages.findIndex((message) => message.type === type);
        if (index >= 0) {
          return messages.splice(index, 1)[0] as Extract<
            EventStreamMessage,
            { type: T }
          >;
        }
        await waitForMessage(waiters, deadline);
      }
      throw new Error(`Timed out waiting for ${type}`);
    }
  };
}

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
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

async function expectRejected(
  url: string,
  cookie: string | undefined,
  origin: string,
  expectedStatus: number,
  host?: string
): Promise<void> {
  const socket = new WebSocket(url, {
    headers: {
      Origin: origin,
      ...(host ? { Host: host } : {}),
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
