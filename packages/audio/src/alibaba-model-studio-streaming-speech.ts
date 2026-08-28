import {
  BoundedAsyncQueue,
  BoundedQueueError
} from "@voxmesh/shared/bounded-async-queue";
import {
  VOICE_STREAM_BINARY_HEADER_BYTES,
  VOICE_STREAM_LIMITS
} from "@voxmesh/shared/voice-stream";

import {
  validateAlibabaModelStudioSttConfiguration,
  validateAlibabaModelStudioTtsConfiguration
} from "./alibaba-model-studio-config.js";
import type {
  AlibabaModelStudioSttConfig,
  AlibabaModelStudioTtsConfig
} from "./alibaba-model-studio-speech.js";
import {
  alibabaRawDataToBytes,
  alibabaRawDataToText,
  alibabaTaskHeader,
  createAlibabaWebSocket,
  defaultAlibabaWebSocketFactory,
  parseAlibabaEvent,
  readAlibabaObject,
  throwIfSpeechAborted,
  type AlibabaEvent,
  type AlibabaWebSocket,
  type AlibabaWebSocketFactory
} from "./alibaba-model-studio-websocket.js";
import type {
  StreamingAudioChunk,
  StreamingAudioFormat,
  StreamingSpeechToTextProvider,
  StreamingSpeechToTextSession,
  StreamingSynthesisEvent,
  StreamingTextToSpeechProvider,
  StreamingTextToSpeechSession,
  StreamingTranscriptionEvent
} from "./types.js";

const STT_FORMAT: StreamingAudioFormat = {
  encoding: "pcm16le",
  sampleRate: 16_000,
  channels: 1
};
const TTS_FORMAT: StreamingAudioFormat = {
  encoding: "pcm16le",
  sampleRate: 24_000,
  channels: 1
};
const DEFAULT_TIMEOUT_MS = 30_000;

/** Alibaba Fun-ASR adapter for live PCM input and partial transcripts. */
export class AlibabaModelStudioStreamingSpeechToTextProvider implements StreamingSpeechToTextProvider {
  public constructor(
    private readonly config: AlibabaModelStudioSttConfig,
    private readonly createSocket: AlibabaWebSocketFactory = defaultAlibabaWebSocketFactory
  ) {
    validateTimeout(config.timeoutMs);
    validateAlibabaModelStudioSttConfiguration({
      endpoint: config.endpoint,
      apiKeyConfigured: Boolean(config.apiKey),
      model: config.model
    });
  }

  public async startSession(input: {
    format: StreamingAudioFormat;
    signal: AbortSignal;
  }): Promise<StreamingSpeechToTextSession> {
    throwIfSpeechAborted(input.signal);
    if (!sameFormat(input.format, STT_FORMAT)) {
      throw new Error(
        "Alibaba Model Studio Streaming STT requires mono 16 kHz PCM16LE"
      );
    }
    const session = new AlibabaStreamingSttSession(
      this.config,
      this.createSocket,
      input.signal
    );
    await session.ready();
    return session;
  }
}

class AlibabaStreamingSttSession implements StreamingSpeechToTextSession {
  private readonly events = new BoundedAsyncQueue<StreamingTranscriptionEvent>(
    {
      maxItems: 128,
      maxBytes: 64 * 1024,
      maxDurationMs: 1,
      maxPendingItems: 128,
      maxPendingBytes: 64 * 1024,
      maxPendingDurationMs: 1
    },
    (event) => ({
      bytes:
        event.type === "partial"
          ? Buffer.byteLength(event.text)
          : Buffer.byteLength(event.result.text),
      durationMs: 0
    })
  );
  private readonly connection: AlibabaStreamingTaskConnection;
  private readonly pendingEvents = new Set<Promise<void>>();
  private operation: Promise<void> = Promise.resolve();
  private nextInputSequence = 1;
  private nextEventSequence = 1;
  private inputBytes = 0;
  private finishRequested = false;
  private closed = false;
  private completed = false;
  private finalSegments: string[] = [];
  private finalTranscriptCharacters = 0;

  public constructor(
    config: AlibabaModelStudioSttConfig,
    createSocket: AlibabaWebSocketFactory,
    signal: AbortSignal
  ) {
    this.connection = new AlibabaStreamingTaskConnection({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal,
      createSocket,
      runTask: (taskId) => ({
        header: alibabaTaskHeader("run-task", taskId),
        payload: {
          task_group: "audio",
          task: "asr",
          function: "recognition",
          model: config.model,
          parameters: {
            format: "pcm",
            sample_rate: STT_FORMAT.sampleRate,
            ...(config.language ? { language_hints: [config.language] } : {})
          },
          input: {}
        }
      }),
      onEvent: (event) => this.handleEvent(event),
      onBinary: () => {
        throw new Error("Alibaba Streaming STT returned unexpected audio");
      },
      onFinished: () => this.handleFinished(config.language),
      onFailure: (error) => this.fail(error)
    });
  }

  public ready(): Promise<void> {
    return this.connection.ready();
  }

  public write(audio: StreamingAudioChunk): Promise<void> {
    if (this.finishRequested) {
      return Promise.reject(
        new Error("Alibaba Streaming STT input is already finished")
      );
    }
    return this.serialize(() => {
      this.assertOpen();
      validateInputChunk(audio, this.nextInputSequence);
      this.inputBytes += audio.data.byteLength;
      const durationMs =
        (this.inputBytes / (STT_FORMAT.sampleRate * STT_FORMAT.channels * 2)) *
        1_000;
      if (
        this.inputBytes > VOICE_STREAM_LIMITS.maxBufferedSttBytes ||
        durationMs > VOICE_STREAM_LIMITS.maxBufferedSttDurationMs
      ) {
        throw new Error("Alibaba Streaming STT input exceeded its limit");
      }
      this.nextInputSequence += 1;
      this.connection.sendBinary(audio.data);
    });
  }

  public finishInput(): Promise<void> {
    if (this.finishRequested) {
      return Promise.reject(
        new Error("Alibaba Streaming STT input is already finished")
      );
    }
    this.finishRequested = true;
    return this.serialize(() => {
      this.assertOpen();
      this.connection.finishTask();
    });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connection.close(
      new BoundedQueueError("CANCELLED", "Alibaba Streaming STT was closed")
    );
    if (!this.completed) {
      this.events.fail(
        new BoundedQueueError("CANCELLED", "Alibaba Streaming STT was closed")
      );
    }
    await this.operation.catch(() => undefined);
  }

  public [Symbol.asyncIterator](): AsyncIterator<StreamingTranscriptionEvent> {
    return this.events[Symbol.asyncIterator]();
  }

  private handleEvent(event: AlibabaEvent): void {
    if (event.header.event !== "result-generated") {
      throw new Error("Alibaba Streaming STT returned an unexpected event");
    }
    const sentence = readAlibabaObject(
      readAlibabaObject(readAlibabaObject(event.payload, "output"), "sentence")
    );
    if (typeof sentence.text !== "string") {
      throw new Error("Alibaba Streaming STT returned malformed text");
    }
    const text = sentence.text.trim();
    if (!text) return;
    if (sentence.sentence_end === true) {
      this.finalTranscriptCharacters +=
        text.length + (this.finalSegments.length > 0 ? 1 : 0);
      if (
        this.finalTranscriptCharacters >
        VOICE_STREAM_LIMITS.maxTranscriptCharacters
      ) {
        throw new Error(
          "Alibaba Streaming STT transcript exceeded its character limit"
        );
      }
      this.finalSegments.push(text);
      return;
    }
    if (sentence.sentence_end !== false) {
      throw new Error(
        "Alibaba Streaming STT returned malformed sentence state"
      );
    }
    if (text.length > VOICE_STREAM_LIMITS.maxTranscriptCharacters) {
      throw new Error(
        "Alibaba Streaming STT partial exceeded its character limit"
      );
    }
    this.enqueueEvent({
      type: "partial",
      sequence: this.nextEventSequence,
      text
    });
    this.nextEventSequence += 1;
  }

  private async handleFinished(language: string): Promise<void> {
    if (!this.finishRequested) {
      throw new Error("Alibaba Streaming STT finished before input ended");
    }
    await Promise.all(this.pendingEvents);
    const text = this.finalSegments.join(" ").trim();
    if (!text) {
      throw new Error("Alibaba Streaming STT returned empty text");
    }
    await this.events.enqueue({
      type: "final",
      sequence: this.nextEventSequence,
      result: { text, language: language || "unknown" }
    });
    this.nextEventSequence += 1;
    this.completed = true;
    this.closed = true;
    this.events.close();
  }

  private enqueueEvent(event: StreamingTranscriptionEvent): void {
    const pending = this.events.enqueue(event, {
      timeoutMs: VOICE_STREAM_LIMITS.providerStageTimeoutMs
    });
    this.pendingEvents.add(pending);
    void pending
      .catch((error: unknown) => this.connection.fail(error))
      .finally(() => this.pendingEvents.delete(pending));
  }

  private serialize(operation: () => void): Promise<void> {
    const result = this.operation.then(() => {
      try {
        operation();
      } catch (error) {
        this.connection.fail(error);
        throw error;
      }
    });
    this.operation = result.catch(() => undefined);
    return result;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Alibaba Streaming STT session is closed");
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.events.fail(streamingQueueError(error, "STT"));
  }
}

/** Alibaba Qwen-Audio-TTS/CosyVoice adapter for ordered PCM output. */
export class AlibabaModelStudioStreamingTextToSpeechProvider implements StreamingTextToSpeechProvider {
  public constructor(
    private readonly config: AlibabaModelStudioTtsConfig,
    private readonly createSocket: AlibabaWebSocketFactory = defaultAlibabaWebSocketFactory
  ) {
    validateTimeout(config.timeoutMs);
    validateAlibabaModelStudioTtsConfiguration({
      endpoint: config.endpoint,
      apiKeyConfigured: Boolean(config.apiKey),
      model: config.model,
      voice: config.voice
    });
  }

  public async startSynthesis(input: {
    text: string;
    signal: AbortSignal;
  }): Promise<StreamingTextToSpeechSession> {
    throwIfSpeechAborted(input.signal);
    if (
      !input.text.trim() ||
      input.text.length > VOICE_STREAM_LIMITS.maxTtsSegmentCharacters
    ) {
      throw new Error("Alibaba Streaming TTS received invalid text");
    }
    const session = new AlibabaStreamingTtsSession(
      this.config,
      this.createSocket,
      input.signal
    );
    await session.start(input.text);
    return session;
  }
}

class AlibabaStreamingTtsSession implements StreamingTextToSpeechSession {
  private readonly events = new BoundedAsyncQueue<StreamingSynthesisEvent>(
    {
      maxItems: 512,
      maxBytes: VOICE_STREAM_LIMITS.maxBufferedTtsBytes + 512,
      maxDurationMs: VOICE_STREAM_LIMITS.maxBufferedTtsDurationMs + 1,
      maxPendingItems: 512,
      maxPendingBytes: VOICE_STREAM_LIMITS.maxBufferedTtsBytes,
      maxPendingDurationMs: VOICE_STREAM_LIMITS.maxBufferedTtsDurationMs
    },
    measureSynthesisEvent
  );
  private readonly connection: AlibabaStreamingTaskConnection;
  private readonly pendingEvents = new Set<Promise<void>>();
  private nextSequence = 1;
  private audioBytes = 0;
  private durationMs = 0;
  private closed = false;
  private completed = false;

  public constructor(
    config: AlibabaModelStudioTtsConfig,
    createSocket: AlibabaWebSocketFactory,
    signal: AbortSignal
  ) {
    this.connection = new AlibabaStreamingTaskConnection({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal,
      createSocket,
      runTask: (taskId) => ({
        header: alibabaTaskHeader("run-task", taskId),
        payload: {
          task_group: "audio",
          task: "tts",
          function: "SpeechSynthesizer",
          model: config.model,
          parameters: {
            text_type: "PlainText",
            voice: config.voice,
            format: "pcm",
            sample_rate: TTS_FORMAT.sampleRate,
            volume: 50,
            rate: 1,
            pitch: 1,
            ...(config.instructions ? { instruction: config.instructions } : {})
          },
          input: {}
        }
      }),
      onEvent: (event) => {
        if (event.header.event !== "result-generated") {
          throw new Error("Alibaba Streaming TTS returned an unexpected event");
        }
      },
      onBinary: (data) => this.handleAudio(data),
      onFinished: () => this.handleFinished(),
      onFailure: (error) => this.fail(error)
    });
  }

  public async start(text: string): Promise<void> {
    await this.connection.ready();
    this.connection.sendControl("continue-task", {
      input: { text }
    });
    this.connection.finishTask();
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connection.close(
      new BoundedQueueError("CANCELLED", "Alibaba Streaming TTS was closed")
    );
    if (!this.completed) {
      this.events.fail(
        new BoundedQueueError("CANCELLED", "Alibaba Streaming TTS was closed")
      );
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<StreamingSynthesisEvent> {
    return this.events[Symbol.asyncIterator]();
  }

  private handleAudio(data: Uint8Array): void {
    if (
      data.byteLength === 0 ||
      data.byteLength % (TTS_FORMAT.channels * 2) !== 0 ||
      data.byteLength + VOICE_STREAM_BINARY_HEADER_BYTES >
        VOICE_STREAM_LIMITS.maxBinaryMessageBytes
    ) {
      throw new Error("Alibaba Streaming TTS returned invalid PCM audio");
    }
    const durationMs =
      (data.byteLength / (TTS_FORMAT.sampleRate * TTS_FORMAT.channels * 2)) *
      1_000;
    this.audioBytes += data.byteLength;
    this.durationMs += durationMs;
    if (
      this.audioBytes > VOICE_STREAM_LIMITS.maxBufferedTtsBytes ||
      this.durationMs > VOICE_STREAM_LIMITS.maxBufferedTtsDurationMs
    ) {
      throw new Error("Alibaba Streaming TTS output exceeded its limit");
    }
    const event: StreamingSynthesisEvent = {
      type: "audio",
      chunk: {
        sequence: this.nextSequence,
        format: TTS_FORMAT,
        data
      }
    };
    this.nextSequence += 1;
    this.enqueueEvent(event);
  }

  private async handleFinished(): Promise<void> {
    await Promise.all(this.pendingEvents);
    if (this.audioBytes === 0) {
      throw new Error("Alibaba Streaming TTS returned empty audio");
    }
    await this.events.enqueue({
      type: "completed",
      sequence: this.nextSequence,
      format: TTS_FORMAT,
      audioBytes: this.audioBytes,
      durationMs: this.durationMs
    });
    this.nextSequence += 1;
    this.completed = true;
    this.closed = true;
    this.events.close();
  }

  private enqueueEvent(event: StreamingSynthesisEvent): void {
    const pending = this.events.enqueue(event, {
      timeoutMs: VOICE_STREAM_LIMITS.providerStageTimeoutMs
    });
    this.pendingEvents.add(pending);
    void pending
      .catch((error: unknown) => this.connection.fail(error))
      .finally(() => this.pendingEvents.delete(pending));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.events.fail(streamingQueueError(error, "TTS"));
  }
}

interface AlibabaStreamingTaskOptions {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
  signal: AbortSignal;
  createSocket: AlibabaWebSocketFactory;
  runTask: (taskId: string) => Record<string, unknown>;
  onEvent: (event: AlibabaEvent) => void;
  onBinary: (data: Uint8Array) => void;
  onFinished: () => Promise<void>;
  onFailure: (error: Error) => void;
}

class AlibabaStreamingTaskConnection {
  private readonly taskId = crypto.randomUUID();
  private readonly socket: AlibabaWebSocket;
  private readonly readyPromise: Promise<void>;
  private resolveReady: () => void = () => undefined;
  private rejectReady: (error: Error) => void = () => undefined;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private readonly onAbort = () =>
    this.fail(new DOMException("Speech operation was aborted", "AbortError"));
  private runSent = false;
  private started = false;
  private finishing = false;
  private completing = false;
  private terminal = false;

  public constructor(private readonly options: AlibabaStreamingTaskOptions) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    try {
      this.socket = createAlibabaWebSocket(
        options.createSocket,
        options.endpoint,
        options.apiKey
      );
    } catch {
      throw new Error(
        "Alibaba Model Studio streaming WebSocket connection failed"
      );
    }
    this.armTimeout();
    options.signal.addEventListener("abort", this.onAbort, { once: true });
    this.attach();
    if (options.signal.aborted) this.onAbort();
  }

  public ready(): Promise<void> {
    return this.readyPromise;
  }

  public sendBinary(data: Uint8Array): void {
    this.assertActive(false);
    this.send(data);
  }

  public sendControl(action: string, payload: Record<string, unknown>): void {
    this.assertActive(false);
    this.send(
      JSON.stringify({
        header: alibabaTaskHeader(action, this.taskId),
        payload
      })
    );
  }

  public finishTask(): void {
    this.assertActive(false);
    this.finishing = true;
    this.armTimeout();
    this.send(
      JSON.stringify({
        header: alibabaTaskHeader("finish-task", this.taskId),
        payload: { input: {} }
      })
    );
  }

  public close(error: Error): void {
    this.fail(error);
  }

  public fail(cause: unknown): void {
    if (this.terminal) return;
    this.terminal = true;
    this.cleanup();
    const error =
      cause instanceof BoundedQueueError && cause.code === "CANCELLED"
        ? cause
        : cause instanceof DOMException && cause.name === "AbortError"
          ? cause
          : new Error("Alibaba Model Studio streaming task failed");
    this.rejectReady(error);
    try {
      this.options.onFailure(error);
    } finally {
      this.closeSocket();
    }
  }

  private attach(): void {
    this.socket.on("open", () => {
      if (this.terminal) return;
      if (this.runSent) {
        this.fail(new Error("Alibaba streaming socket opened twice"));
        return;
      }
      this.runSent = true;
      try {
        this.send(JSON.stringify(this.options.runTask(this.taskId)));
      } catch (error) {
        this.fail(error);
      }
    });
    this.socket.on("message", (data, isBinary) => {
      if (this.terminal) return;
      try {
        if (isBinary) {
          if (!this.started || this.completing) {
            throw new Error("Alibaba streaming audio arrived out of order");
          }
          this.options.onBinary(alibabaRawDataToBytes(data));
          return;
        }
        this.handleEvent(parseAlibabaEvent(alibabaRawDataToText(data)));
      } catch (error) {
        this.fail(error);
      }
    });
    this.socket.on("error", () => {
      this.fail(new Error("Alibaba Model Studio streaming WebSocket failed"));
    });
    this.socket.on("close", () => {
      if (!this.terminal) {
        this.fail(
          new Error(
            "Alibaba Model Studio streaming WebSocket closed before completion"
          )
        );
      }
    });
  }

  private handleEvent(event: AlibabaEvent): void {
    switch (event.header.event) {
      case "task-started":
        if (!this.runSent || this.started || this.finishing) {
          throw new Error("Alibaba streaming task started out of order");
        }
        this.started = true;
        this.clearTimeout();
        this.resolveReady();
        return;
      case "task-failed":
        this.fail(new Error("Alibaba Model Studio streaming task failed"));
        return;
      case "task-finished":
        if (!this.started || !this.finishing || this.completing) {
          throw new Error("Alibaba streaming task finished out of order");
        }
        this.completing = true;
        void this.options.onFinished().then(
          () => this.complete(),
          (error: unknown) => this.fail(error)
        );
        return;
      default:
        if (!this.started || this.completing) {
          throw new Error("Alibaba streaming event arrived out of order");
        }
        this.options.onEvent(event);
    }
  }

  private send(data: string | Uint8Array): void {
    try {
      this.socket.send(data);
    } catch {
      const failure = new Error(
        "Alibaba Model Studio streaming WebSocket send failed"
      );
      this.fail(failure);
      throw failure;
    }
  }

  private assertActive(allowFinishing: boolean): void {
    throwIfSpeechAborted(this.options.signal);
    if (
      this.terminal ||
      !this.started ||
      this.completing ||
      (!allowFinishing && this.finishing)
    ) {
      throw new Error("Alibaba Model Studio streaming task is not writable");
    }
  }

  private complete(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.cleanup();
    this.closeSocket();
  }

  private cleanup(): void {
    this.clearTimeout();
    this.options.signal.removeEventListener("abort", this.onAbort);
  }

  private armTimeout(): void {
    this.clearTimeout();
    this.timeout = setTimeout(
      () =>
        this.fail(new Error("Alibaba Model Studio streaming task timed out")),
      this.options.timeoutMs
    );
  }

  private clearTimeout(): void {
    if (this.timeout === null) return;
    clearTimeout(this.timeout);
    this.timeout = null;
  }

  private closeSocket(): void {
    try {
      this.socket.close();
    } catch {
      console.error("Failed to close Alibaba Model Studio streaming socket");
    }
  }
}

function validateInputChunk(
  audio: StreamingAudioChunk,
  sequence: number
): void {
  if (
    audio.sequence !== sequence ||
    !sameFormat(audio.format, STT_FORMAT) ||
    audio.data.byteLength === 0 ||
    audio.data.byteLength % (STT_FORMAT.channels * 2) !== 0 ||
    audio.data.byteLength > VOICE_STREAM_LIMITS.maxBinaryMessageBytes
  ) {
    throw new Error("Alibaba Streaming STT received invalid PCM audio");
  }
}

function sameFormat(
  left: StreamingAudioFormat,
  right: StreamingAudioFormat
): boolean {
  return (
    left.encoding === right.encoding &&
    left.sampleRate === right.sampleRate &&
    left.channels === right.channels
  );
}

function validateTimeout(timeoutMs: number | undefined): void {
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
  ) {
    throw new Error("Alibaba Model Studio streaming timeout must be positive");
  }
}

function measureSynthesisEvent(event: StreamingSynthesisEvent): {
  bytes: number;
  durationMs: number;
} {
  if (event.type === "completed") {
    return { bytes: 512, durationMs: 0 };
  }
  return {
    bytes: event.chunk.data.byteLength,
    durationMs:
      (event.chunk.data.byteLength /
        (event.chunk.format.sampleRate * event.chunk.format.channels * 2)) *
      1_000
  };
}

function streamingQueueError(
  error: Error,
  role: "STT" | "TTS"
): BoundedQueueError {
  if (error instanceof BoundedQueueError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new BoundedQueueError(
      "CANCELLED",
      `Alibaba Streaming ${role} was cancelled`,
      { cause: error }
    );
  }
  return new BoundedQueueError(
    "QUEUE_FAILED",
    `Alibaba Streaming ${role} failed`,
    { cause: error }
  );
}
