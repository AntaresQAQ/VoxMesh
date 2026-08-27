import type { StreamingAudioChunk } from "@voxmesh/audio";
import {
  BoundedAsyncQueue,
  BoundedQueueError,
  VOICE_STREAM_LIMITS,
  VOICE_STREAM_PROTOCOL_VERSION,
  VoiceStreamClientProtocolState,
  VoiceStreamServerProtocolState,
  decodeVoiceStreamBinaryFrame,
  encodeVoiceStreamBinaryFrame,
  parseVoiceStreamControlMessage,
  type VoiceStreamClientMessage,
  type VoiceStreamServerMessage
} from "@voxmesh/shared";

import {
  BrowserStreamingAudioCapture,
  BrowserStreamingAudioPlayback,
  supportsBrowserStreamingVoice,
  type StreamingAudioCapture,
  type StreamingAudioPlayback
} from "./browser-streaming-audio.js";

const WEB_SOCKET_OPEN_STATE = 1;

export type BrowserVoiceStreamState =
  | "connecting"
  | "capturing"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed";

export interface BrowserVoiceStreamCallbacks {
  onState: (state: BrowserVoiceStreamState) => void;
  onLevel: (level: number) => void;
  onPartialTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onAssistantText: (text: string) => void;
  onTool: (message: string) => void;
  onPressure: (level: "normal" | "high") => void;
  onError: (message: string) => void;
}

export interface BrowserVoiceStreamSession {
  start(): Promise<void>;
  finishInput(): Promise<void>;
  cancel(): void;
}

export interface BrowserVoiceStreamSessionOptions {
  allowTools: boolean;
  callbacks: BrowserVoiceStreamCallbacks;
  createCapture?: () => StreamingAudioCapture;
  createPlayback?: () => StreamingAudioPlayback;
  createSocket?: (url: string) => BrowserWebSocket;
  createId?: () => string;
  url?: string;
}

export interface BrowserWebSocket extends EventTarget {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

/** Returns whether the browser can run the streaming voice experience. */
export function supportsBrowserVoiceStream(): boolean {
  return (
    supportsBrowserStreamingVoice() &&
    typeof globalThis.crypto?.randomUUID === "function"
  );
}

/** Browser application client for one non-resumable voice WebSocket session. */
export class DefaultBrowserVoiceStreamSession implements BrowserVoiceStreamSession {
  private readonly capture: StreamingAudioCapture;
  private readonly playback: StreamingAudioPlayback;
  private readonly createSocket: (url: string) => BrowserWebSocket;
  private readonly createId: () => string;
  private socket: BrowserWebSocket | null = null;
  private clientState = new VoiceStreamClientProtocolState();
  private serverState: VoiceStreamServerProtocolState | null = null;
  private startMessage:
    Extract<VoiceStreamClientMessage, { type: "voice.start" }> | undefined;
  private nextClientControlSequence = 1;
  private assistantText = "";
  private processing: Promise<void> = Promise.resolve();
  private inputQueue: BoundedAsyncQueue<StreamingAudioChunk> | null = null;
  private inputPump: Promise<void> = Promise.resolve();
  private readonly pendingInputEnqueues = new Set<Promise<void>>();
  private ready = false;
  private terminal = false;
  private finishRequested = false;

  public constructor(
    private readonly options: BrowserVoiceStreamSessionOptions
  ) {
    this.capture =
      options.createCapture?.() ?? new BrowserStreamingAudioCapture();
    this.playback =
      options.createPlayback?.() ?? new BrowserStreamingAudioPlayback();
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  public async start(): Promise<void> {
    if (
      !supportsBrowserVoiceStream() &&
      (!this.options.createSocket || !this.options.createId)
    ) {
      throw new Error("Browser streaming voice is not supported");
    }
    this.options.callbacks.onState("connecting");
    const start: Extract<VoiceStreamClientMessage, { type: "voice.start" }> = {
      version: VOICE_STREAM_PROTOCOL_VERSION,
      type: "voice.start",
      sessionId: this.createId(),
      sequence: 0,
      runId: this.createId(),
      toolMode: this.options.allowTools ? "enabled" : "disabled",
      inputFormat: {
        encoding: "pcm16le",
        sampleRate: 16_000,
        channels: 1,
        frameDurationMs: 20
      }
    };
    this.startMessage = start;
    this.serverState = new VoiceStreamServerProtocolState(start);
    const socket = this.createSocket(this.options.url ?? voiceStreamUrl());
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    const ready = new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        try {
          this.sendControl(start);
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Voice start control failed")
          );
        }
      };
      const onMessage: EventListener = (event) => {
        if (!(event instanceof MessageEvent)) return;
        this.processing = this.processing.then(() =>
          this.handleMessage(event.data)
        );
        void this.processing.then(
          () => {
            if (this.ready) resolve();
            else if (this.terminal) {
              reject(new Error("Voice session was rejected"));
            }
          },
          (error: unknown) => {
            const message =
              error instanceof Error ? error.message : "Voice session failed";
            this.fail(message);
            reject(
              error instanceof Error ? error : new Error("Voice session failed")
            );
          }
        );
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("message", onMessage);
      socket.addEventListener(
        "error",
        () => reject(new Error("Voice WebSocket connection failed")),
        { once: true }
      );
      socket.addEventListener("close", () => {
        this.processing = this.processing.then(() => {
          if (!this.terminal) this.fail("Voice WebSocket disconnected");
          if (!this.ready) {
            reject(new Error("Voice WebSocket closed before it was ready"));
          }
        });
        void this.processing.catch((error: unknown) => {
          this.fail(
            error instanceof Error ? error.message : "Voice session failed"
          );
        });
      });
    });
    await ready;
    this.inputQueue = new BoundedAsyncQueue(
      {
        maxItems: Math.ceil(
          VOICE_STREAM_LIMITS.maxInputQueueDurationMs /
            VOICE_STREAM_LIMITS.inputFrameDurationMs
        ),
        maxBytes: VOICE_STREAM_LIMITS.maxInputQueueBytes,
        maxDurationMs: VOICE_STREAM_LIMITS.maxInputQueueDurationMs
      },
      (chunk) => ({
        bytes: chunk.data.byteLength,
        durationMs: VOICE_STREAM_LIMITS.inputFrameDurationMs
      })
    );
    this.inputPump = this.pumpInput();
    void this.inputPump.catch((error: unknown) =>
      this.fail(
        error instanceof Error ? error.message : "Voice input queue failed"
      )
    );
    await this.capture.start({
      onChunk: (chunk) => this.enqueueInput(chunk),
      onLevel: this.options.callbacks.onLevel
    });
    this.options.callbacks.onState("capturing");
  }

  public async finishInput(): Promise<void> {
    if (this.terminal || this.finishRequested) return;
    this.finishRequested = true;
    await this.capture.finish();
    await Promise.all(this.pendingInputEnqueues);
    this.inputQueue?.close();
    await this.inputPump;
    this.options.callbacks.onLevel(0);
    this.sendControl({
      version: VOICE_STREAM_PROTOCOL_VERSION,
      type: "voice.input_finished",
      sessionId: this.requireStart().sessionId,
      sequence: this.nextClientControlSequence
    });
    this.nextClientControlSequence += 1;
    this.options.callbacks.onState("processing");
  }

  public cancel(): void {
    if (this.terminal) return;
    this.capture.cancel();
    this.inputQueue?.fail(
      new BoundedQueueError("CANCELLED", "Voice input queue cancelled")
    );
    this.playback.cancel();
    this.options.callbacks.onLevel(0);
    if (
      this.socket?.readyState === WEB_SOCKET_OPEN_STATE &&
      this.startMessage
    ) {
      try {
        this.sendControl({
          version: VOICE_STREAM_PROTOCOL_VERSION,
          type: "voice.cancel",
          sessionId: this.startMessage.sessionId,
          sequence: this.nextClientControlSequence,
          reason: "user"
        });
        this.nextClientControlSequence += 1;
      } catch {
        // Socket teardown below remains authoritative.
      }
    }
    this.terminal = true;
    this.socket?.close(1000, "Voice session cancelled");
    this.options.callbacks.onState("cancelled");
  }

  private async handleMessage(data: unknown): Promise<void> {
    if (this.terminal) return;
    if (typeof data !== "string") {
      const buffer =
        data instanceof ArrayBuffer
          ? data
          : data instanceof Blob
            ? await data.arrayBuffer()
            : null;
      if (!buffer) throw new Error("Voice WebSocket sent invalid binary data");
      const frame = decodeVoiceStreamBinaryFrame(buffer);
      this.requireServerState().acceptAudio(frame);
      await this.playback.enqueue({
        sequence: frame.sequence,
        format: frame.format,
        data: frame.data
      });
      return;
    }
    const parsed = parseVoiceStreamControlMessage(data);
    if (!parsed || !isServerMessage(parsed)) {
      throw new Error("Voice WebSocket sent an invalid control message");
    }
    this.requireServerState().acceptControl(parsed);
    await this.applyServerControl(parsed);
  }

  private async applyServerControl(
    message: VoiceStreamServerMessage
  ): Promise<void> {
    switch (message.type) {
      case "voice.ready":
        this.ready = true;
        return;
      case "voice.rejected":
      case "voice.failed":
        throw new Error(message.message);
      case "voice.partial_transcript":
        this.options.callbacks.onPartialTranscript(message.text);
        return;
      case "voice.final_transcript":
        this.options.callbacks.onFinalTranscript(message.text);
        return;
      case "voice.llm_text_delta":
        this.assistantText += message.delta;
        this.options.callbacks.onAssistantText(this.assistantText);
        return;
      case "voice.llm_tool_delta":
        if (message.complete && message.toolName) {
          this.options.callbacks.onTool(message.toolName);
        }
        return;
      case "voice.tool_started":
        this.options.callbacks.onTool(message.toolName);
        return;
      case "voice.tool_finished":
        return;
      case "voice.llm_finished":
        if (message.finishReason === "tool_call") this.assistantText = "";
        if (message.finishReason === "stop") {
          this.assistantText = message.text;
          this.options.callbacks.onAssistantText(message.text);
        }
        return;
      case "voice.pressure":
        this.options.callbacks.onPressure(message.level);
        return;
      case "voice.output_segment_started":
      case "voice.output_segment_finished":
        return;
      case "voice.output_finished":
        await this.playback.finish();
        return;
      case "voice.completed":
        this.complete();
        return;
      case "voice.cancelled":
        this.terminal = true;
        this.capture.cancel();
        this.inputQueue?.fail(
          new BoundedQueueError("CANCELLED", "Voice session was cancelled")
        );
        this.playback.cancel();
        this.options.callbacks.onLevel(0);
        this.options.callbacks.onPressure("normal");
        this.options.callbacks.onState("cancelled");
        this.socket?.close(1000, "Voice session cancelled");
        return;
    }
  }

  private sendControl(message: VoiceStreamClientMessage): void {
    const socket = this.requireOpenSocket();
    this.clientState.acceptControl(message);
    socket.send(JSON.stringify(message));
  }

  private sendAudio(chunk: StreamingAudioChunk): void {
    if (this.terminal) return;
    const socket = this.requireOpenSocket();
    const frame = {
      version: VOICE_STREAM_PROTOCOL_VERSION,
      direction: "input" as const,
      sequence: chunk.sequence,
      format: chunk.format,
      frameSamples: chunk.data.byteLength / (chunk.format.channels * 2),
      data: chunk.data
    };
    this.clientState.acceptAudio(frame);
    socket.send(encodeVoiceStreamBinaryFrame(frame));
  }

  private enqueueInput(chunk: StreamingAudioChunk): void {
    if (this.terminal || this.finishRequested) return;
    const queue = this.inputQueue;
    if (!queue) return;
    try {
      const enqueue = queue.enqueue(chunk, {
        timeoutMs: VOICE_STREAM_LIMITS.providerStageTimeoutMs
      });
      this.pendingInputEnqueues.add(enqueue);
      void enqueue
        .catch((error: unknown) =>
          this.fail(
            error instanceof Error ? error.message : "Voice input queue failed"
          )
        )
        .finally(() => this.pendingInputEnqueues.delete(enqueue));
    } catch (error) {
      this.fail(
        error instanceof Error ? error.message : "Voice input queue failed"
      );
    }
  }

  private async pumpInput(): Promise<void> {
    const queue = this.inputQueue;
    if (!queue) return;
    for await (const chunk of queue) this.sendAudio(chunk);
  }

  private complete(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.capture.cancel();
    this.inputQueue?.close();
    this.options.callbacks.onLevel(0);
    this.options.callbacks.onPressure("normal");
    this.options.callbacks.onState("completed");
    this.socket?.close(1000, "Voice session completed");
  }

  private fail(message: string): void {
    if (this.terminal) return;
    this.terminal = true;
    this.capture.cancel();
    this.inputQueue?.fail(
      new BoundedQueueError("QUEUE_FAILED", "Voice input queue failed")
    );
    this.playback.cancel();
    this.options.callbacks.onLevel(0);
    this.options.callbacks.onPressure("normal");
    this.options.callbacks.onError(message);
    this.options.callbacks.onState("failed");
    this.socket?.close();
  }

  private requireStart() {
    if (!this.startMessage) throw new Error("Voice session has not started");
    return this.startMessage;
  }

  private requireServerState(): VoiceStreamServerProtocolState {
    if (!this.serverState) throw new Error("Voice protocol is not initialized");
    return this.serverState;
  }

  private requireOpenSocket(): BrowserWebSocket {
    if (!this.socket || this.socket.readyState !== WEB_SOCKET_OPEN_STATE) {
      throw new Error("Voice WebSocket is not open");
    }
    return this.socket;
  }
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

function voiceStreamUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/voice-stream`;
}
