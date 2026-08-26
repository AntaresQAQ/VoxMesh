import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import type { FastifyInstance } from "fastify";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { AgentRunCancelledError, type McpServer } from "@voxmesh/agent-core";
import type { StreamingAudioChunk } from "@voxmesh/audio";
import {
  BoundedAsyncQueue,
  BoundedQueueError,
  VOICE_STREAM_LIMITS,
  VOICE_STREAM_PROTOCOL_VERSION,
  VoiceStreamClientProtocolState,
  VoiceStreamProtocolError,
  VoiceStreamServerProtocolState,
  decodeVoiceStreamBinaryFrame,
  encodeVoiceStreamBinaryFrame,
  parseVoiceStreamControlMessage,
  type VoiceStreamClientMessage,
  type VoiceStreamFailureCode,
  type VoiceStreamFailureStage,
  type VoiceStreamServerMessage
} from "@voxmesh/shared";
import type { VoxMeshStore } from "@voxmesh/storage";

import {
  StreamingVoiceCoordinator,
  StreamingVoiceCoordinatorError,
  type StreamingVoiceCoordinatorEvent,
  type StreamingVoiceCoordinatorResult,
  type StreamingVoiceRunPreparation
} from "./streaming-voice-coordinator.js";
import { prepareStreamingVoiceRun } from "./streaming-voice-providers.js";
import {
  authenticateWebSocketUpgrade,
  isSameWebSocketOrigin,
  rejectWebSocketUpgrade
} from "./websocket-security.js";

export interface VoiceStreamRegistration {
  close(): Promise<void>;
}

type VoiceStreamServerPayload = VoiceStreamServerMessage extends infer Message
  ? Message extends VoiceStreamServerMessage
    ? Omit<Message, "version" | "sessionId" | "sequence">
    : never
  : never;

interface VoiceClientState {
  alive: boolean;
  tokenHash: string;
  principalId: string;
  controller: AbortController;
  clientProtocol: VoiceStreamClientProtocolState;
  serverProtocol: VoiceStreamServerProtocolState | null;
  inputQueue: BoundedAsyncQueue<StreamingAudioChunk> | null;
  unsubscribeInputPressure: () => void;
  sessionId: string | null;
  runId: string | null;
  controlSequence: number;
  controlRate: FixedWindowRate;
  frameRate: FixedWindowRate;
  setupTimer: ReturnType<typeof setTimeout>;
  sessionTimer: ReturnType<typeof setTimeout> | null;
  task: Promise<void>;
  pendingAudioWrites: Set<Promise<void>>;
  cancellationRequested: boolean;
  terminal: boolean;
}

/** Registers the authenticated, non-resumable full-chain voice WebSocket. */
export function registerVoiceStreamTransport(input: {
  app: FastifyInstance;
  store: VoxMeshStore;
  mcp: McpServer;
  prepare?: () => StreamingVoiceRunPreparation;
  maxClients?: number;
  maxClientsPerAdministrator?: number;
  maxBufferedBytes?: number;
  heartbeatMs?: number;
  setupTimeoutMs?: number;
  sessionTimeoutMs?: number;
}): VoiceStreamRegistration {
  const maxClients =
    input.maxClients ?? VOICE_STREAM_LIMITS.maxActiveSessionsGlobal;
  const maxClientsPerAdministrator =
    input.maxClientsPerAdministrator ??
    VOICE_STREAM_LIMITS.maxActiveSessionsPerAdministrator;
  const maxBufferedBytes =
    input.maxBufferedBytes ?? VOICE_STREAM_LIMITS.maxWebSocketBufferedBytes;
  const heartbeatMs = input.heartbeatMs ?? 15_000;
  const setupTimeoutMs =
    input.setupTimeoutMs ?? VOICE_STREAM_LIMITS.sessionSetupTimeoutMs;
  const sessionTimeoutMs =
    input.sessionTimeoutMs ?? VOICE_STREAM_LIMITS.maxSessionDurationMs;
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: VOICE_STREAM_LIMITS.maxBinaryMessageBytes
  });
  const clients = new Map<WebSocket, VoiceClientState>();

  const upgrade = (
    request: IncomingMessage,
    socket: Socket,
    head: Buffer
  ): void => {
    let url: URL;
    try {
      url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`
      );
    } catch {
      rejectWebSocketUpgrade(socket, 400, "Invalid Request");
      return;
    }
    if (url.pathname !== "/api/voice-stream") return;
    if (!isSameWebSocketOrigin(request)) {
      rejectWebSocketUpgrade(socket, 403, "Forbidden");
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
    if (
      clients.size >= maxClients ||
      countPrincipalClients(authentication.principalId) >=
        maxClientsPerAdministrator
    ) {
      rejectWebSocketUpgrade(socket, 503, "Too Many Connections");
      return;
    }
    server.handleUpgrade(request, socket, head, (webSocket) => {
      initializeClient(
        webSocket,
        authentication.tokenHash,
        authentication.principalId
      );
    });
  };

  const initializeClient = (
    webSocket: WebSocket,
    tokenHash: string,
    principalId: string
  ): void => {
    const controller = new AbortController();
    const state: VoiceClientState = {
      alive: true,
      tokenHash,
      principalId,
      controller,
      clientProtocol: new VoiceStreamClientProtocolState(),
      serverProtocol: null,
      inputQueue: null,
      unsubscribeInputPressure: () => undefined,
      sessionId: null,
      runId: null,
      controlSequence: 0,
      controlRate: new FixedWindowRate(
        VOICE_STREAM_LIMITS.maxClientControlsPerSecond
      ),
      frameRate: new FixedWindowRate(
        VOICE_STREAM_LIMITS.maxInputFramesPerSecond
      ),
      setupTimer: setTimeout(
        () =>
          failTransport(webSocket, state, "TIMEOUT", "Session setup timed out"),
        setupTimeoutMs
      ),
      sessionTimer: null,
      task: Promise.resolve(),
      pendingAudioWrites: new Set(),
      cancellationRequested: false,
      terminal: false
    };
    clients.set(webSocket, state);
    webSocket.on("pong", () => {
      state.alive = true;
    });
    webSocket.on("message", (data, isBinary) => {
      try {
        handleMessage(webSocket, state, data, isBinary);
      } catch (error) {
        handleClientError(webSocket, state, error);
      }
    });
    webSocket.on("error", () => abortClient(state));
    webSocket.on("close", () => {
      abortClient(state);
      clients.delete(webSocket);
    });
  };

  const handleMessage = (
    webSocket: WebSocket,
    state: VoiceClientState,
    data: RawData,
    isBinary: boolean
  ): void => {
    if (state.terminal || state.cancellationRequested) return;
    if (!input.store.getSessionExpiry(state.tokenHash)) {
      webSocket.close(4401, "Authentication required");
      abortClient(state);
      return;
    }
    if (isBinary) {
      if (!state.frameRate.accept()) {
        throw new VoiceStreamProtocolError(
          "RATE_LIMITED",
          "Input frame rate limit was exceeded"
        );
      }
      const frame = decodeVoiceStreamBinaryFrame(rawDataBytes(data));
      state.clientProtocol.acceptAudio(frame);
      if (!state.inputQueue) {
        throw new VoiceStreamProtocolError(
          "INVALID_STATE",
          "Voice session is not ready for audio"
        );
      }
      const write = state.inputQueue.enqueue(
        {
          sequence: frame.sequence,
          format: frame.format,
          data: new Uint8Array(frame.data)
        },
        {
          signal: state.controller.signal,
          timeoutMs: VOICE_STREAM_LIMITS.providerStageTimeoutMs
        }
      );
      state.pendingAudioWrites.add(write);
      void write.then(
        () => state.pendingAudioWrites.delete(write),
        (error: unknown) => {
          state.pendingAudioWrites.delete(write);
          handleClientError(webSocket, state, error);
        }
      );
      return;
    }
    if (!state.controlRate.accept()) {
      throw new VoiceStreamProtocolError(
        "RATE_LIMITED",
        "Client control rate limit was exceeded"
      );
    }
    const text = rawDataText(data);
    const parsed = parseVoiceStreamControlMessage(text);
    if (!parsed || !isClientMessage(parsed)) {
      throw new VoiceStreamProtocolError(
        "INVALID_MESSAGE",
        "Client control message is invalid"
      );
    }
    state.clientProtocol.acceptControl(parsed);
    if (parsed.type === "voice.start") {
      startSession(webSocket, state, parsed);
    } else if (parsed.type === "voice.input_finished") {
      const pending = [...state.pendingAudioWrites];
      void Promise.all(pending).then(
        () => state.inputQueue?.close(),
        (error: unknown) => handleClientError(webSocket, state, error)
      );
    } else {
      state.cancellationRequested = true;
      state.controller.abort();
      state.inputQueue?.fail(new AgentRunCancelledError());
    }
  };

  const startSession = (
    webSocket: WebSocket,
    state: VoiceClientState,
    start: Extract<VoiceStreamClientMessage, { type: "voice.start" }>
  ): void => {
    clearTimeout(state.setupTimer);
    state.sessionId = start.sessionId;
    state.runId = start.runId;
    state.serverProtocol = new VoiceStreamServerProtocolState(start);
    state.inputQueue = new BoundedAsyncQueue(
      {
        maxItems: Math.ceil(
          VOICE_STREAM_LIMITS.maxInputQueueDurationMs /
            VOICE_STREAM_LIMITS.inputFrameDurationMs
        ),
        maxBytes: VOICE_STREAM_LIMITS.maxInputQueueBytes,
        maxDurationMs: VOICE_STREAM_LIMITS.maxInputQueueDurationMs,
        highWaterMark: 0.45,
        lowWaterMark: 0.25
      },
      (chunk) => ({
        bytes: chunk.data.byteLength,
        durationMs: VOICE_STREAM_LIMITS.inputFrameDurationMs
      })
    );
    let pressureInitialized = false;
    state.unsubscribeInputPressure = state.inputQueue.subscribePressure(
      (level) => {
        if (!pressureInitialized) {
          pressureInitialized = true;
          return;
        }
        if (!state.serverProtocol || state.terminal) return;
        sendControl(webSocket, state, {
          type: "voice.pressure",
          queue: "input",
          level,
          queuedBytes: state.inputQueue?.queuedBytes ?? 0,
          queuedDurationMs: state.inputQueue?.queuedDurationMs ?? 0
        });
      }
    );
    let preparation: StreamingVoiceRunPreparation;
    try {
      preparation = input.prepare
        ? input.prepare()
        : prepareDefaultVoiceRun(input.store);
    } catch {
      sendRejected(webSocket, state, start, "PROVIDER_FAILED");
      return;
    }
    const profile = Object.fromEntries(
      preparation.route.assignments.map((assignment) => [
        assignment.role,
        assignment.streamingEnabled ? "streaming" : "buffered"
      ])
    ) as {
      stt: "buffered" | "streaming";
      chat: "buffered" | "streaming";
      tts: "buffered" | "streaming";
    };
    sendControl(webSocket, state, {
      type: "voice.ready",
      runId: start.runId,
      toolMode: start.toolMode,
      inputFormat: start.inputFormat,
      profile
    });
    state.sessionTimer = setTimeout(
      () => failTransport(webSocket, state, "TIMEOUT", "Session timed out"),
      sessionTimeoutMs
    );
    const run = new StreamingVoiceCoordinator(input.store, input.mcp).run({
      runId: start.runId,
      preparation,
      format: {
        encoding: start.inputFormat.encoding,
        sampleRate: start.inputFormat.sampleRate,
        channels: start.inputFormat.channels
      },
      audio: state.inputQueue,
      toolMode: start.toolMode,
      signal: state.controller.signal
    });
    state.task = pumpCoordinator(webSocket, state, run);
    void state.task.catch(() => undefined);
  };

  const pumpCoordinator = async (
    webSocket: WebSocket,
    state: VoiceClientState,
    run: AsyncGenerator<
      StreamingVoiceCoordinatorEvent,
      StreamingVoiceCoordinatorResult
    >
  ): Promise<void> => {
    try {
      while (true) {
        const next = await run.next();
        if (next.done) {
          sendControl(webSocket, state, {
            type: "voice.completed",
            conversationId: next.value.conversationId,
            runId: next.value.runId
          });
          finishClient(webSocket, state);
          return;
        }
        sendCoordinatorEvent(webSocket, state, next.value);
      }
    } catch (error) {
      if (
        state.controller.signal.aborted ||
        error instanceof AgentRunCancelledError
      ) {
        if (webSocket.readyState === WebSocket.OPEN) {
          sendControl(webSocket, state, {
            type: "voice.cancelled",
            code: "RUN_CANCELLED"
          });
        }
      } else {
        const failure = normalizeFailure(error);
        if (webSocket.readyState === WebSocket.OPEN) {
          sendControl(webSocket, state, {
            type: "voice.failed",
            stage: failure.stage,
            code: failure.code,
            message: failure.message
          });
        }
      }
      finishClient(webSocket, state);
    }
  };

  const sendCoordinatorEvent = (
    webSocket: WebSocket,
    state: VoiceClientState,
    event: StreamingVoiceCoordinatorEvent
  ): void => {
    switch (event.type) {
      case "stage":
        return;
      case "transcript_partial":
        sendControl(webSocket, state, {
          type: "voice.partial_transcript",
          text: event.text
        });
        return;
      case "transcript_final":
        sendControl(webSocket, state, {
          type: "voice.final_transcript",
          text: event.transcript,
          language: event.language
        });
        return;
      case "agent":
        sendAgentEvent(webSocket, state, event.event);
        return;
      case "segment_started":
        sendControl(webSocket, state, {
          type: "voice.output_segment_started",
          segmentIndex: event.segmentIndex,
          text: event.text,
          format: event.format
        });
        return;
      case "segment_finished":
        sendControl(webSocket, state, {
          type: "voice.output_segment_finished",
          segmentIndex: event.segmentIndex
        });
        return;
      case "audio":
        sendAudio(webSocket, state, event.chunk);
        return;
      case "audio_completed":
        sendControl(webSocket, state, {
          type: "voice.output_finished",
          segments: event.segments,
          audioBytes: event.audioBytes,
          durationMs: event.durationMs
        });
    }
  };

  const sendAgentEvent = (
    webSocket: WebSocket,
    state: VoiceClientState,
    event: Extract<StreamingVoiceCoordinatorEvent, { type: "agent" }>["event"]
  ): void => {
    switch (event.type) {
      case "text_delta":
        sendControl(webSocket, state, {
          type: "voice.llm_text_delta",
          completionIndex: event.completionIndex,
          delta: event.delta
        });
        return;
      case "tool_call_delta":
        sendControl(webSocket, state, {
          type: "voice.llm_tool_delta",
          completionIndex: event.completionIndex,
          toolCallIndex: event.toolCallIndex,
          toolName: event.toolName,
          argumentsBytes: event.argumentsBytes,
          complete: event.complete
        });
        return;
      case "tool_started":
        sendControl(webSocket, state, {
          type: "voice.tool_started",
          completionIndex: event.completionIndex,
          toolCallId: event.toolCallId,
          toolName: event.toolName
        });
        return;
      case "tool_finished":
        sendControl(webSocket, state, {
          type: "voice.tool_finished",
          completionIndex: event.completionIndex,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          success: event.success
        });
        return;
      case "usage":
        return;
      case "completion_finished":
        sendControl(webSocket, state, {
          type: "voice.llm_finished",
          completionIndex: event.completionIndex,
          finishReason: event.finishReason,
          text: event.text,
          usage: event.usage
        });
    }
  };

  const sendControl = (
    webSocket: WebSocket,
    state: VoiceClientState,
    message: VoiceStreamServerPayload
  ): void => {
    if (
      webSocket.readyState !== WebSocket.OPEN ||
      !state.sessionId ||
      !state.serverProtocol ||
      state.terminal
    ) {
      return;
    }
    const control = {
      ...message,
      version: VOICE_STREAM_PROTOCOL_VERSION,
      sessionId: state.sessionId,
      sequence: state.controlSequence
    } as VoiceStreamServerMessage;
    state.serverProtocol.acceptControl(control);
    state.controlSequence += 1;
    sendRaw(webSocket, state, JSON.stringify(control));
  };

  const sendRejected = (
    webSocket: WebSocket,
    state: VoiceClientState,
    start: Extract<VoiceStreamClientMessage, { type: "voice.start" }>,
    code: VoiceStreamFailureCode
  ): void => {
    sendControl(webSocket, state, {
      type: "voice.rejected",
      runId: start.runId,
      stage: "session",
      code,
      message: "Voice session could not be prepared"
    });
    finishClient(webSocket, state);
  };

  const sendAudio = (
    webSocket: WebSocket,
    state: VoiceClientState,
    chunk: StreamingAudioChunk
  ): void => {
    if (
      webSocket.readyState !== WebSocket.OPEN ||
      !state.serverProtocol ||
      state.terminal
    ) {
      return;
    }
    const frame = {
      version: VOICE_STREAM_PROTOCOL_VERSION,
      direction: "output" as const,
      sequence: chunk.sequence,
      format: chunk.format,
      frameSamples: chunk.data.byteLength / (chunk.format.channels * 2),
      data: chunk.data
    };
    state.serverProtocol.acceptAudio(frame);
    sendRaw(webSocket, state, encodeVoiceStreamBinaryFrame(frame));
  };

  const sendRaw = (
    webSocket: WebSocket,
    state: VoiceClientState,
    data: string | Uint8Array
  ): void => {
    if (webSocket.readyState !== WebSocket.OPEN || state.terminal) return;
    if (webSocket.bufferedAmount > maxBufferedBytes) {
      state.terminal = true;
      webSocket.close(1013, "Client is too slow");
      abortClient(state);
      return;
    }
    try {
      webSocket.send(data);
    } catch {
      state.terminal = true;
      webSocket.terminate();
      abortClient(state);
    }
  };

  const handleClientError = (
    webSocket: WebSocket,
    state: VoiceClientState,
    error: unknown
  ): void => {
    if (state.terminal || state.cancellationRequested) return;
    try {
      if (state.serverProtocol && state.sessionId) {
        const failure = normalizeFailure(error);
        sendControl(webSocket, state, {
          type: "voice.failed",
          stage: failure.stage,
          code: failure.code,
          message: failure.message
        });
      }
    } catch {
      // The first terminal control may already have advanced protocol state.
    }
    state.terminal = true;
    webSocket.close(1008, "Invalid voice stream message");
    abortClient(state);
  };

  const failTransport = (
    webSocket: WebSocket,
    state: VoiceClientState,
    code: VoiceStreamFailureCode,
    message: string
  ): void => {
    if (state.terminal) return;
    try {
      if (state.serverProtocol && state.sessionId) {
        sendControl(webSocket, state, {
          type: "voice.failed",
          stage: "transport",
          code,
          message
        });
      }
    } catch {
      // A concurrent terminal transition already owns the connection.
    }
    state.terminal = true;
    webSocket.close(1013, message);
    abortClient(state);
  };

  const finishClient = (
    webSocket: WebSocket,
    state: VoiceClientState
  ): void => {
    if (state.terminal) return;
    state.terminal = true;
    clearTimeout(state.setupTimer);
    if (state.sessionTimer) clearTimeout(state.sessionTimer);
    state.inputQueue?.close();
    state.unsubscribeInputPressure();
    if (webSocket.readyState === WebSocket.OPEN) {
      webSocket.close(1000, "Voice session completed");
    }
  };

  const abortClient = (state: VoiceClientState): void => {
    clearTimeout(state.setupTimer);
    if (state.sessionTimer) clearTimeout(state.sessionTimer);
    state.cancellationRequested = true;
    state.controller.abort();
    state.inputQueue?.fail(new AgentRunCancelledError());
    state.unsubscribeInputPressure();
  };

  const heartbeat = setInterval(() => {
    for (const [webSocket, state] of clients) {
      if (!input.store.getSessionExpiry(state.tokenHash)) {
        webSocket.close(4401, "Authentication required");
        abortClient(state);
        continue;
      }
      if (!state.alive) {
        webSocket.terminate();
        abortClient(state);
        continue;
      }
      state.alive = false;
      webSocket.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  input.app.server.on("upgrade", upgrade);

  return {
    close: async () => {
      clearInterval(heartbeat);
      input.app.server.off("upgrade", upgrade);
      for (const [webSocket, state] of clients) {
        abortClient(state);
        webSocket.terminate();
      }
      await Promise.allSettled(
        [...clients.values()].map((state) => state.task)
      );
      clients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };

  function countPrincipalClients(principalId: string): number {
    let count = 0;
    for (const state of clients.values()) {
      if (state.principalId === principalId) count += 1;
    }
    return count;
  }
}

function isClientMessage(
  message: ReturnType<typeof parseVoiceStreamControlMessage>
): message is VoiceStreamClientMessage {
  return (
    message !== null &&
    (message.type === "voice.start" ||
      message.type === "voice.input_finished" ||
      message.type === "voice.cancel")
  );
}

function normalizeFailure(error: unknown): {
  stage: VoiceStreamFailureStage;
  code: VoiceStreamFailureCode;
  message: string;
} {
  if (error instanceof VoiceStreamProtocolError) {
    return { stage: "transport", code: error.code, message: error.message };
  }
  if (error instanceof BoundedQueueError) {
    return {
      stage: "transport",
      code:
        error.code === "TIMEOUT"
          ? "TIMEOUT"
          : error.code === "CANCELLED"
            ? "RUN_CANCELLED"
            : "BACKPRESSURE",
      message: "Voice transport queue failed"
    };
  }
  if (error instanceof StreamingVoiceCoordinatorError) {
    return {
      stage:
        error.code === "STT_FAILED"
          ? "stt"
          : error.code === "TTS_FAILED"
            ? "tts"
            : "agent",
      code: "PROVIDER_FAILED",
      message: error.message
    };
  }
  return {
    stage: "session",
    code: "INTERNAL_ERROR",
    message: "Voice session failed"
  };
}

function prepareDefaultVoiceRun(
  store: VoxMeshStore
): StreamingVoiceRunPreparation {
  return prepareStreamingVoiceRun(store);
}

function rawDataBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function rawDataText(data: RawData): string {
  return Buffer.from(rawDataBytes(data)).toString("utf8");
}

class FixedWindowRate {
  private windowStartedAt = Date.now();
  private count = 0;

  public constructor(private readonly limit: number) {}

  public accept(now = Date.now()): boolean {
    if (now - this.windowStartedAt >= 1_000) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.limit;
  }
}
