import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import type { FastifyInstance } from "fastify";

import type { VoxMeshStore } from "@voxmesh/storage";

import { hashSessionToken } from "./security.js";

const SESSION_COOKIE = "voxmesh_session";

export type WebSocketAuthenticationResult =
  | {
      authenticated: true;
      tokenHash: string;
      principalId: "administrator";
    }
  | { authenticated: false; status: number; message: string };

/** Validates the shared administrator cookie for a WebSocket upgrade. */
export function authenticateWebSocketUpgrade(
  app: FastifyInstance,
  store: VoxMeshStore,
  request: IncomingMessage
): WebSocketAuthenticationResult {
  let cookies: Record<string, string>;
  try {
    cookies = app.parseCookie(request.headers.cookie ?? "");
  } catch {
    return {
      authenticated: false,
      status: 400,
      message: "Invalid Cookie"
    };
  }
  const token = cookies[SESSION_COOKIE];
  const tokenHash = token ? hashSessionToken(token) : null;
  if (!tokenHash || !store.getSessionExpiry(tokenHash)) {
    return {
      authenticated: false,
      status: 401,
      message: "Authentication Required"
    };
  }
  return {
    authenticated: true,
    tokenHash,
    principalId: "administrator"
  };
}

/** Requires an HTTP(S) Origin whose authority exactly matches Host. */
export function isSameWebSocketOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function rejectWebSocketUpgrade(
  socket: Socket,
  status: number,
  message: string
): void {
  if (socket.destroyed || socket.writableEnded) return;
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  );
}

/** Rejects upgrade paths not owned by a registered WebSocket transport. */
export function registerWebSocketUpgradeFallback(
  app: FastifyInstance,
  supportedPaths: ReadonlySet<string>
): { close(): void } {
  const rejectUnknown = (request: IncomingMessage, socket: Socket): void => {
    let pathname: string;
    try {
      pathname = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`
      ).pathname;
    } catch {
      rejectWebSocketUpgrade(socket, 400, "Invalid Request");
      return;
    }
    if (supportedPaths.has(pathname)) return;
    rejectWebSocketUpgrade(socket, 404, "Not Found");
  };
  app.server.on("upgrade", rejectUnknown);
  return {
    close: () => app.server.off("upgrade", rejectUnknown)
  };
}
