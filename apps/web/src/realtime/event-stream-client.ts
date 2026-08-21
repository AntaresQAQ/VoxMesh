import {
  parseEventStreamMessage,
  type EventStreamMessage,
  type RealtimeEvent
} from "@voxmesh/shared/event-stream";

export type EventStreamStatus =
  "connecting" | "connected" | "reconnecting" | "failed" | "disconnected";

interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(code?: number, reason?: string): void;
}

export interface EventStreamClientOptions {
  onStatus: (status: EventStreamStatus) => void;
  onEvent: (event: RealtimeEvent) => void;
  onGap: (gap: Extract<EventStreamMessage, { type: "stream.gap" }>) => void;
  onStreamReset?: () => void;
  onAuthenticationRequired: () => void;
  onProtocolError: (message: string) => void;
  verifyAuthentication?: () => Promise<boolean | null>;
  createSocket?: (url: string) => WebSocketLike;
  scheduleReconnect?: (callback: () => void, delayMs: number) => number;
  cancelReconnect?: (timer: number) => void;
}

/** Owns ordered event-stream reconnection without hiding replay gaps. */
export class EventStreamClient {
  private socket: WebSocketLike | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private lastSequence = 0;
  private streamId: string | null = null;
  private stopped = true;
  private fatal = false;

  public constructor(private readonly options: EventStreamClientOptions) {}

  public start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.fatal = false;
    this.connect("connecting");
  }

  public stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      this.cancelReconnect(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(1000, "Client stopped");
    this.socket = null;
    this.options.onStatus("disconnected");
  }

  private connect(status: "connecting" | "reconnecting"): void {
    if (this.stopped || this.fatal) return;
    this.options.onStatus(status);
    let socket: WebSocketLike;
    try {
      socket = this.createSocket(eventStreamUrl(this.lastSequence));
    } catch (error) {
      this.failProtocol(
        error instanceof Error
          ? error.message
          : "Live event WebSocket is unavailable"
      );
      return;
    }
    this.socket = socket;
    socket.onopen = () => undefined;
    socket.onmessage = (event) => this.handleMessage(event);
    socket.onerror = () => undefined;
    socket.onclose = (event) => this.handleClose(event);
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") {
      this.failProtocol("Event stream returned a non-text control message");
      return;
    }
    const message = parseEventStreamMessage(event.data);
    if (!message) {
      this.failProtocol("Event stream returned an invalid message");
      return;
    }
    switch (message.type) {
      case "stream.ready":
        if (this.streamId !== null && this.streamId !== message.streamId) {
          this.streamId = message.streamId;
          this.lastSequence = 0;
          this.options.onStreamReset?.();
          this.socket?.close(4000, "Event stream restarted");
          return;
        }
        this.streamId = message.streamId;
        this.reconnectAttempt = 0;
        this.options.onStatus("connected");
        return;
      case "stream.event":
        if (this.streamId !== message.event.streamId) {
          this.failProtocol("Event stream identifier changed unexpectedly");
          return;
        }
        if (message.event.sequence <= this.lastSequence) return;
        this.lastSequence = message.event.sequence;
        this.options.onEvent(message.event);
        return;
      case "stream.gap":
        if (this.streamId !== message.streamId) {
          this.failProtocol("Replay gap belongs to another event stream");
          return;
        }
        this.options.onGap(message);
        return;
      case "stream.heartbeat":
        return;
      case "stream.error":
        this.failProtocol(`${message.code}: ${message.message}`);
    }
  }

  private handleClose(event: CloseEvent): void {
    this.socket = null;
    if (this.stopped || this.fatal) return;
    if (event.code === 4401) {
      this.authenticationRequired();
      return;
    }
    if (event.code === 1006 && this.options.verifyAuthentication) {
      this.options.onStatus("reconnecting");
      void this.options.verifyAuthentication().then(
        (authenticated) => {
          if (this.stopped || this.fatal) return;
          if (authenticated === false) {
            this.authenticationRequired();
          } else {
            this.scheduleNextReconnect();
          }
        },
        () => {
          if (!this.stopped && !this.fatal) this.scheduleNextReconnect();
        }
      );
      return;
    }
    this.scheduleNextReconnect();
  }

  private scheduleNextReconnect(): void {
    const delay = Math.min(10_000, 250 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.options.onStatus("reconnecting");
    this.reconnectTimer = this.scheduleReconnect(() => {
      this.reconnectTimer = null;
      this.connect("reconnecting");
    }, delay);
  }

  private authenticationRequired(): void {
    this.stopped = true;
    this.options.onStatus("failed");
    this.options.onAuthenticationRequired();
  }

  private failProtocol(message: string): void {
    this.fatal = true;
    this.options.onStatus("failed");
    this.options.onProtocolError(message);
    this.socket?.close(1002, "Protocol error");
  }

  private createSocket(url: string): WebSocketLike {
    return this.options.createSocket?.(url) ?? new WebSocket(url);
  }

  private scheduleReconnect(callback: () => void, delayMs: number): number {
    return (
      this.options.scheduleReconnect?.(callback, delayMs) ??
      window.setTimeout(callback, delayMs)
    );
  }

  private cancelReconnect(timer: number): void {
    if (this.options.cancelReconnect) {
      this.options.cancelReconnect(timer);
    } else {
      window.clearTimeout(timer);
    }
  }
}

export function eventStreamUrl(afterSequence: number): string {
  const url = new URL("/api/events", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("after", String(afterSequence));
  return url.toString();
}
