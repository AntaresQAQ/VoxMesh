import WebSocket, { type ClientOptions, type RawData } from "ws";

export type AlibabaWebSocketFactory = (
  url: string,
  options: ClientOptions
) => AlibabaWebSocket;

export interface AlibabaWebSocket {
  on(event: "open", listener: () => void): this;
  on(
    event: "message",
    listener: (data: RawData, isBinary: boolean) => void
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number, reason: Buffer) => void): this;
  send(data: string | Uint8Array): void;
  close(): void;
}

export interface AlibabaEvent {
  header: {
    event: string;
    errorCode: string | null;
    errorMessage: string | null;
  };
  payload: Record<string, unknown>;
}

export const defaultAlibabaWebSocketFactory: AlibabaWebSocketFactory = (
  url,
  options
) => new WebSocket(url, options);

/** Opens only a pre-validated Model Studio endpoint with write-only auth. */
export function createAlibabaWebSocket(
  createSocket: AlibabaWebSocketFactory,
  endpoint: string,
  apiKey: string
): AlibabaWebSocket {
  return createSocket(endpoint, {
    headers: {
      Authorization: ["Bearer", apiKey].join(" "),
      "User-Agent": "VoxMesh"
    }
  });
}

export function alibabaTaskHeader(action: string, taskId: string) {
  return {
    action,
    task_id: taskId,
    streaming: "duplex"
  };
}

export function parseAlibabaEvent(value: string): AlibabaEvent {
  const parsed: unknown = JSON.parse(value);
  const root = readAlibabaObject(parsed);
  const header = readAlibabaObject(root, "header");
  if (typeof header.event !== "string") {
    throw new Error("Alibaba event header requires an event name");
  }
  return {
    header: {
      event: header.event,
      errorCode:
        typeof header.error_code === "string" ? header.error_code : null,
      errorMessage:
        typeof header.error_message === "string" ? header.error_message : null
    },
    payload: readAlibabaObject(root, "payload")
  };
}

export function readAlibabaObject(
  value: unknown,
  key?: string
): Record<string, unknown> {
  const target =
    key === undefined && value !== null && typeof value === "object"
      ? value
      : value !== null && typeof value === "object" && key
        ? (value as Record<string, unknown>)[key]
        : undefined;
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    throw new Error(
      key ? `Alibaba response requires ${key}` : "Alibaba response must be JSON"
    );
  }
  return target as Record<string, unknown>;
}

export function alibabaRawDataToText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
    "utf8"
  );
}

export function alibabaRawDataToBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  );
}

export function throwIfSpeechAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Speech operation was aborted", "AbortError");
  }
}

export function normalizeAlibabaError(
  operation: string,
  error: unknown
): Error {
  return new Error(
    `Alibaba Model Studio ${operation}: ${
      error instanceof Error ? error.message : "unknown error"
    }`
  );
}
