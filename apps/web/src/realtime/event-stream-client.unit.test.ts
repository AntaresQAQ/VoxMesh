// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { EventStreamClient } from "./event-stream-client.js";

describe("EventStreamClient", () => {
  it("reconnects from the last applied sequence", () => {
    const sockets: FakeSocket[] = [];
    const reconnects: Array<() => void> = [];
    const onEvent = vi.fn();
    const onStatus = vi.fn();
    const client = new EventStreamClient({
      onStatus,
      onEvent,
      onGap: vi.fn(),
      onAuthenticationRequired: vi.fn(),
      onProtocolError: vi.fn(),
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      scheduleReconnect: (callback) => {
        reconnects.push(callback);
        return reconnects.length;
      },
      cancelReconnect: vi.fn()
    });

    client.start();
    sockets[0]?.message(ready());
    sockets[0]?.message(logEvent(4));
    sockets[0]?.closeFromServer(1006);
    reconnects[0]?.();

    expect(onEvent).toHaveBeenCalledOnce();
    expect(sockets[1]?.url).toContain("after=4");
    expect(onStatus).toHaveBeenCalledWith("reconnecting");
    client.stop();
  });

  it("reports gaps and treats invalid protocol messages as fatal", () => {
    const socket = new FakeSocket("ws://example.test");
    const onGap = vi.fn();
    const onProtocolError = vi.fn();
    const client = new EventStreamClient({
      onStatus: vi.fn(),
      onEvent: vi.fn(),
      onGap,
      onAuthenticationRequired: vi.fn(),
      onProtocolError,
      createSocket: () => socket
    });
    client.start();
    socket.message(ready());
    socket.message({
      version: 1,
      type: "stream.gap",
      streamId: "stream-1",
      requestedAfter: 1,
      oldestAvailableSequence: 3,
      latestSequence: 5
    });
    socket.rawMessage("{");

    expect(onGap).toHaveBeenCalledOnce();
    expect(onProtocolError).toHaveBeenCalledOnce();
    expect(socket.closeCode).toBe(1002);
  });

  it("ends without reconnecting when authentication is revoked", () => {
    const socket = new FakeSocket("ws://example.test");
    const reconnect = vi.fn();
    const onAuthenticationRequired = vi.fn();
    const client = new EventStreamClient({
      onStatus: vi.fn(),
      onEvent: vi.fn(),
      onGap: vi.fn(),
      onAuthenticationRequired,
      onProtocolError: vi.fn(),
      createSocket: () => socket,
      scheduleReconnect: reconnect
    });
    client.start();
    socket.closeFromServer(4401);

    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("reports browsers without WebSocket support as a protocol failure", () => {
    const onProtocolError = vi.fn();
    const onStatus = vi.fn();
    const client = new EventStreamClient({
      onStatus,
      onEvent: vi.fn(),
      onGap: vi.fn(),
      onAuthenticationRequired: vi.fn(),
      onProtocolError,
      createSocket: () => {
        throw new Error("WebSocket unavailable");
      }
    });

    client.start();

    expect(onStatus).toHaveBeenLastCalledWith("failed");
    expect(onProtocolError).toHaveBeenCalledWith("WebSocket unavailable");
  });

  it("resets its replay cursor when the server stream identity changes", () => {
    const sockets: FakeSocket[] = [];
    const reconnects: Array<() => void> = [];
    const onStreamReset = vi.fn();
    const client = new EventStreamClient({
      onStatus: vi.fn(),
      onEvent: vi.fn(),
      onGap: vi.fn(),
      onStreamReset,
      onAuthenticationRequired: vi.fn(),
      onProtocolError: vi.fn(),
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      scheduleReconnect: (callback) => {
        reconnects.push(callback);
        return reconnects.length;
      }
    });
    client.start();
    sockets[0]?.message(ready("stream-1"));
    sockets[0]?.message(logEvent(9, "stream-1"));
    sockets[0]?.message(ready("stream-2"));
    sockets[0]?.closeFromServer(4000);
    reconnects[0]?.();

    expect(sockets[1]?.url).toContain("after=0");
    expect(onStreamReset).toHaveBeenCalledOnce();
  });

  it("checks HTTP authentication after an abnormal upgrade close", async () => {
    const socket = new FakeSocket("ws://example.test");
    const onAuthenticationRequired = vi.fn();
    const reconnect = vi.fn();
    const client = new EventStreamClient({
      onStatus: vi.fn(),
      onEvent: vi.fn(),
      onGap: vi.fn(),
      onAuthenticationRequired,
      onProtocolError: vi.fn(),
      verifyAuthentication: vi.fn(async () => false),
      createSocket: () => socket,
      scheduleReconnect: reconnect
    });
    client.start();
    socket.closeFromServer(1006);
    await Promise.resolve();

    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
    expect(reconnect).not.toHaveBeenCalled();
  });
});

class FakeSocket {
  public readonly readyState = WebSocket.OPEN;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public closeCode: number | undefined;

  public constructor(public readonly url: string) {}

  public close(code?: number): void {
    this.closeCode = code;
  }

  public message(value: unknown): void {
    this.rawMessage(JSON.stringify(value));
  }

  public rawMessage(value: string): void {
    this.onmessage?.(new MessageEvent("message", { data: value }));
  }

  public closeFromServer(code: number): void {
    this.onclose?.(new CloseEvent("close", { code }));
  }
}

function ready(streamId = "stream-1") {
  return {
    version: 1,
    type: "stream.ready",
    streamId,
    latestSequence: 0,
    oldestAvailableSequence: null
  };
}

function logEvent(sequence: number, streamId = "stream-1") {
  return {
    version: 1,
    type: "stream.event",
    event: {
      version: 1,
      streamId,
      sequence,
      eventId: `event-${sequence}`,
      emittedAt: "2026-08-21T00:00:00.000Z",
      type: "log.created",
      payload: {
        log: {
          id: `log-${sequence}`,
          category: "SYSTEM",
          level: "INFO",
          message: "Live",
          conversationId: null,
          createdAt: "2026-08-21T00:00:00.000Z"
        }
      }
    }
  };
}
