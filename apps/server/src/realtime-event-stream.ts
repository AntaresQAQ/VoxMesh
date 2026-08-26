import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import type { FastifyInstance } from "fastify";
import WebSocket, { WebSocketServer } from "ws";

import type { EventStreamMessage, RealtimeEvent } from "@voxmesh/shared";
import type { VoxMeshStore } from "@voxmesh/storage";

import type { RealtimeEventHub } from "./realtime-event-hub.js";
import {
  authenticateWebSocketUpgrade,
  isSameWebSocketOrigin,
  rejectWebSocketUpgrade
} from "./websocket-security.js";

interface EventStreamRegistration {
  close(): void;
}

interface ClientState {
  alive: boolean;
  tokenHash: string;
  unsubscribe: () => void;
}

/** Registers the authenticated server-to-client observability WebSocket. */
export function registerRealtimeEventStream(input: {
  app: FastifyInstance;
  store: VoxMeshStore;
  hub: RealtimeEventHub;
  heartbeatMs?: number;
  maxClients?: number;
  maxBufferedBytes?: number;
}): EventStreamRegistration {
  const heartbeatMs = input.heartbeatMs ?? 15_000;
  const maxClients = input.maxClients ?? 10;
  const maxBufferedBytes = input.maxBufferedBytes ?? 512 * 1024;
  const server = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const clients = new Map<WebSocket, ClientState>();

  const upgrade = (
    request: IncomingMessage,
    socket: Socket,
    head: Buffer
  ): void => {
    const host = request.headers.host;
    let url: URL;
    try {
      url = new URL(request.url ?? "/", `http://${host ?? "localhost"}`);
    } catch {
      rejectWebSocketUpgrade(socket, 400, "Invalid Request");
      return;
    }
    if (url.pathname !== "/api/events") {
      return;
    }
    if (!isSameWebSocketOrigin(request)) {
      rejectWebSocketUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (clients.size >= maxClients) {
      rejectWebSocketUpgrade(socket, 503, "Too Many Connections");
      return;
    }
    const afterSequence = parseAfterSequence(url.searchParams.get("after"));
    if (afterSequence === null) {
      rejectWebSocketUpgrade(socket, 400, "Invalid Replay Cursor");
      return;
    }
    const authentication = authenticateWebSocketUpgrade(
      input.app,
      input.store,
      request
    );
    if (!authentication.authenticated) {
      rejectWebSocketUpgrade(
        socket,
        authentication.status,
        authentication.message
      );
      return;
    }
    server.handleUpgrade(request, socket, head, (webSocket) => {
      initializeClient(webSocket, authentication.tokenHash, afterSequence);
    });
  };

  const initializeClient = (
    webSocket: WebSocket,
    tokenHash: string,
    afterSequence: number
  ): void => {
    const sendEvent = (event: RealtimeEvent) =>
      send(webSocket, { version: 1, type: "stream.event", event });
    const unsubscribe = input.hub.subscribe(sendEvent);
    const state: ClientState = { alive: true, tokenHash, unsubscribe };
    clients.set(webSocket, state);
    webSocket.on("pong", () => {
      state.alive = true;
    });
    webSocket.on("message", () => {
      webSocket.close(1008, "Client messages are not supported");
    });
    webSocket.on("error", () => undefined);
    webSocket.on("close", () => {
      state.unsubscribe();
      clients.delete(webSocket);
    });

    const snapshot = input.hub.snapshot(afterSequence);
    send(webSocket, snapshot.ready);
    if (snapshot.gap) send(webSocket, snapshot.gap);
    for (const event of snapshot.events) sendEvent(event);
  };

  const heartbeat = setInterval(() => {
    for (const [webSocket, state] of clients) {
      if (!input.store.getSessionExpiry(state.tokenHash)) {
        webSocket.close(4401, "Authentication required");
        continue;
      }
      if (!state.alive) {
        webSocket.terminate();
        continue;
      }
      state.alive = false;
      webSocket.ping();
      send(webSocket, {
        version: 1,
        type: "stream.heartbeat",
        streamId: input.hub.streamIdentifier(),
        emittedAt: new Date().toISOString(),
        latestSequence: input.hub.latestSequence()
      });
    }
  }, heartbeatMs);
  heartbeat.unref();

  input.app.server.on("upgrade", upgrade);

  return {
    close: () => {
      clearInterval(heartbeat);
      input.app.server.off("upgrade", upgrade);
      for (const [webSocket, state] of clients) {
        state.unsubscribe();
        webSocket.terminate();
      }
      clients.clear();
      server.close();
    }
  };

  function send(webSocket: WebSocket, message: EventStreamMessage): void {
    if (webSocket.readyState !== WebSocket.OPEN) return;
    if (webSocket.bufferedAmount > maxBufferedBytes) {
      webSocket.close(1013, "Client is too slow");
      return;
    }
    try {
      webSocket.send(JSON.stringify(message));
    } catch {
      webSocket.terminate();
    }
  }
}

function parseAfterSequence(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
