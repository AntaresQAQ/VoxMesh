import {
  BoundedAsyncQueue,
  BoundedQueueError
} from "@voxmesh/shared/bounded-async-queue";
import {
  VOICE_STREAM_BINARY_HEADER_BYTES,
  VOICE_STREAM_LIMITS
} from "@voxmesh/shared/voice-stream";

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

const DEFAULT_FORMAT: StreamingAudioFormat = {
  encoding: "pcm16le",
  sampleRate: 16_000,
  channels: 1
};

type Delay = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export interface MockStreamingSpeechOptions {
  format?: StreamingAudioFormat;
  eventDelayMs?: number;
  delay?: Delay;
}

export interface MockStreamingSttOptions extends MockStreamingSpeechOptions {
  partials?: string[];
  finalText?: string;
  language?: string;
  framesPerPartial?: number;
  failOnWriteSequence?: number;
  failOnFinish?: boolean;
}

/** Deterministic Streaming STT used by offline tests and later Mock sessions. */
export class MockStreamingSpeechToTextProvider implements StreamingSpeechToTextProvider {
  public constructor(private readonly options: MockStreamingSttOptions = {}) {}

  public async startSession(input: {
    format: StreamingAudioFormat;
    signal: AbortSignal;
  }): Promise<StreamingSpeechToTextSession> {
    throwIfAborted(input.signal);
    const format = this.options.format ?? DEFAULT_FORMAT;
    validateFormat(format);
    validateDelay(this.options.eventDelayMs);
    if (!sameFormat(input.format, format)) {
      throw new Error("Mock Streaming STT received an unsupported format");
    }
    return new MockStreamingSttSession(format, input.signal, this.options);
  }
}

class MockStreamingSttSession implements StreamingSpeechToTextSession {
  private readonly events: BoundedAsyncQueue<StreamingTranscriptionEvent>;
  private readonly localAbort = new AbortController();
  private readonly signal: AbortSignal;
  private readonly partials: string[];
  private readonly framesPerPartial: number;
  private readonly delay: Delay;
  private readonly onAbort = () =>
    this.fail(
      new BoundedQueueError("CANCELLED", "Mock Streaming STT was cancelled")
    );
  private nextInputSequence = 1;
  private nextEventSequence = 1;
  private framesReceived = 0;
  private partialIndex = 0;
  private inputFinished = false;
  private completed = false;
  private closed = false;
  private operation: Promise<void> = Promise.resolve();

  public constructor(
    private readonly format: StreamingAudioFormat,
    externalSignal: AbortSignal,
    private readonly options: MockStreamingSttOptions
  ) {
    this.signal = AbortSignal.any([externalSignal, this.localAbort.signal]);
    this.partials = options.partials ?? ["Check", "Check the light"];
    this.framesPerPartial = options.framesPerPartial ?? 1;
    if (!Number.isInteger(this.framesPerPartial) || this.framesPerPartial < 1) {
      throw new Error("framesPerPartial must be a positive integer");
    }
    this.delay = options.delay ?? delay;
    this.events = new BoundedAsyncQueue(
      {
        maxItems: this.partials.length + 1,
        maxBytes: 32 * 1024,
        maxDurationMs: 1
      },
      measureTranscriptionEvent
    );
    this.signal.addEventListener("abort", this.onAbort, { once: true });
  }

  public write(audio: StreamingAudioChunk): Promise<void> {
    return this.serialize(async () => {
      this.assertWritable();
      throwIfAborted(this.signal);
      validateAudioChunk(audio, this.format, this.nextInputSequence);
      if (audio.sequence === this.options.failOnWriteSequence) {
        throw new Error("Mock Streaming STT write failed");
      }
      this.nextInputSequence += 1;
      this.framesReceived += 1;
      if (
        this.partialIndex < this.partials.length &&
        this.framesReceived % this.framesPerPartial === 0
      ) {
        await this.emitPartial(this.partials[this.partialIndex] ?? "");
        this.partialIndex += 1;
      }
    });
  }

  public finishInput(): Promise<void> {
    return this.serialize(async () => {
      this.assertWritable();
      this.inputFinished = true;
      if (this.options.failOnFinish) {
        throw new Error("Mock Streaming STT finish failed");
      }
      while (this.partialIndex < this.partials.length) {
        await this.emitPartial(this.partials[this.partialIndex] ?? "");
        this.partialIndex += 1;
      }
      await this.wait();
      await this.events.enqueue({
        type: "final",
        sequence: this.nextEventSequence,
        result: {
          text: this.options.finalText ?? "Check the light status",
          language: this.options.language ?? "en"
        }
      });
      this.nextEventSequence += 1;
      this.completed = true;
      this.detachAbort();
      this.events.close();
    });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.localAbort.abort();
    this.detachAbort();
    if (this.completed) {
      this.events.close();
    } else {
      this.events.fail(
        new BoundedQueueError("CANCELLED", "Mock Streaming STT was closed")
      );
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<StreamingTranscriptionEvent> {
    return this.events[Symbol.asyncIterator]();
  }

  private async emitPartial(text: string): Promise<void> {
    await this.wait();
    await this.events.enqueue({
      type: "partial",
      sequence: this.nextEventSequence,
      text
    });
    this.nextEventSequence += 1;
  }

  private wait(): Promise<void> {
    return this.delay(this.options.eventDelayMs ?? 0, this.signal);
  }

  private assertWritable(): void {
    if (this.closed || this.inputFinished) {
      throw new MockStreamingSessionStateError(
        "Mock Streaming STT input is already closed"
      );
    }
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(async () => {
      try {
        await operation();
      } catch (error) {
        if (!(error instanceof MockStreamingSessionStateError)) {
          this.fail(error);
        }
        throw error;
      }
    });
    this.operation = result.catch(() => undefined);
    return result;
  }

  private detachAbort(): void {
    this.signal.removeEventListener("abort", this.onAbort);
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.detachAbort();
    this.events.fail(error);
  }
}

export interface MockStreamingTtsOptions extends MockStreamingSpeechOptions {
  chunkCount?: number;
  chunkDurationMs?: number;
  failAtChunk?: number;
}

/** Deterministic Streaming TTS that emits bounded PCM chunks. */
export class MockStreamingTextToSpeechProvider implements StreamingTextToSpeechProvider {
  public constructor(private readonly options: MockStreamingTtsOptions = {}) {}

  public async startSynthesis(input: {
    text: string;
    signal: AbortSignal;
  }): Promise<StreamingTextToSpeechSession> {
    throwIfAborted(input.signal);
    if (input.text.length === 0) {
      throw new Error("Mock Streaming TTS requires text");
    }
    validateFormat(this.options.format ?? DEFAULT_FORMAT);
    validateDelay(this.options.eventDelayMs);
    return new MockStreamingTtsSession(input.signal, this.options);
  }
}

class MockStreamingTtsSession implements StreamingTextToSpeechSession {
  private readonly events: BoundedAsyncQueue<StreamingSynthesisEvent>;
  private readonly localAbort = new AbortController();
  private readonly signal: AbortSignal;
  private readonly format: StreamingAudioFormat;
  private readonly chunkCount: number;
  private readonly chunkDurationMs: number;
  private readonly delay: Delay;
  private readonly onAbort = () =>
    this.events.fail(
      new BoundedQueueError("CANCELLED", "Mock Streaming TTS was cancelled")
    );
  private closed = false;
  private completed = false;

  public constructor(
    externalSignal: AbortSignal,
    private readonly options: MockStreamingTtsOptions
  ) {
    this.signal = AbortSignal.any([externalSignal, this.localAbort.signal]);
    this.format = options.format ?? DEFAULT_FORMAT;
    this.chunkCount = options.chunkCount ?? 3;
    this.chunkDurationMs = options.chunkDurationMs ?? 20;
    if (!Number.isInteger(this.chunkCount) || this.chunkCount < 1) {
      throw new Error("chunkCount must be a positive integer");
    }
    if (
      !Number.isInteger(this.chunkDurationMs) ||
      this.chunkDurationMs < 1 ||
      !Number.isInteger((this.format.sampleRate * this.chunkDurationMs) / 1_000)
    ) {
      throw new Error("chunkDurationMs must produce an integral sample count");
    }
    this.delay = options.delay ?? delay;
    const chunkBytes =
      ((this.format.sampleRate * this.chunkDurationMs) / 1_000) *
      this.format.channels *
      2;
    if (
      chunkBytes + VOICE_STREAM_BINARY_HEADER_BYTES >
        VOICE_STREAM_LIMITS.maxBinaryMessageBytes ||
      chunkBytes * this.chunkCount > VOICE_STREAM_LIMITS.maxBufferedTtsBytes ||
      this.chunkDurationMs * this.chunkCount >
        VOICE_STREAM_LIMITS.maxBufferedTtsDurationMs
    ) {
      throw new Error("Mock Streaming TTS output exceeds contract limits");
    }
    this.events = new BoundedAsyncQueue(
      {
        maxItems: this.chunkCount + 1,
        maxBytes: chunkBytes * this.chunkCount + 512,
        maxDurationMs: this.chunkDurationMs * this.chunkCount + 1
      },
      measureSynthesisEvent
    );
    this.signal.addEventListener("abort", this.onAbort, { once: true });
    void this.produce();
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.localAbort.abort();
    this.detachAbort();
    if (this.completed) {
      this.events.close();
    } else {
      this.events.fail(
        new BoundedQueueError("CANCELLED", "Mock Streaming TTS was closed")
      );
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<StreamingSynthesisEvent> {
    return this.events[Symbol.asyncIterator]();
  }

  private async produce(): Promise<void> {
    try {
      let audioBytes = 0;
      for (let sequence = 1; sequence <= this.chunkCount; sequence += 1) {
        await this.delay(this.options.eventDelayMs ?? 0, this.signal);
        if (sequence === this.options.failAtChunk) {
          throw new Error("Mock Streaming TTS chunk failed");
        }
        const chunk = createPcmChunk(
          sequence,
          this.format,
          this.chunkDurationMs
        );
        audioBytes += chunk.data.byteLength;
        await this.events.enqueue({ type: "audio", chunk });
      }
      await this.events.enqueue({
        type: "completed",
        sequence: this.chunkCount + 1,
        format: this.format,
        audioBytes,
        durationMs: this.chunkCount * this.chunkDurationMs
      });
      this.completed = true;
      this.detachAbort();
      this.events.close();
    } catch (error) {
      this.closed = true;
      this.detachAbort();
      this.events.fail(error);
    }
  }

  private detachAbort(): void {
    this.signal.removeEventListener("abort", this.onAbort);
  }
}

function createPcmChunk(
  sequence: number,
  format: StreamingAudioFormat,
  durationMs: number
): StreamingAudioChunk {
  const samples = (format.sampleRate * durationMs) / 1_000;
  const data = new Uint8Array(samples * format.channels * 2);
  const view = new DataView(data.buffer);
  for (let sample = 0; sample < samples * format.channels; sample += 1) {
    view.setInt16(sample * 2, ((sample + sequence) % 32) * 512, true);
  }
  return { sequence, format, data };
}

function validateAudioChunk(
  audio: StreamingAudioChunk,
  format: StreamingAudioFormat,
  expectedSequence: number
): void {
  if (audio.sequence !== expectedSequence) {
    throw new Error("Mock Streaming STT received an invalid sequence");
  }
  if (!sameFormat(audio.format, format)) {
    throw new Error("Mock Streaming STT received an invalid format");
  }
  if (
    audio.data.byteLength === 0 ||
    audio.data.byteLength % (format.channels * 2) !== 0 ||
    audio.data.byteLength > VOICE_STREAM_LIMITS.maxBinaryMessageBytes
  ) {
    throw new Error("Mock Streaming STT received invalid PCM data");
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

function validateFormat(format: StreamingAudioFormat): void {
  if (
    format.encoding !== "pcm16le" ||
    !Number.isInteger(format.sampleRate) ||
    format.sampleRate < 8_000 ||
    format.sampleRate > 96_000 ||
    !Number.isInteger(format.channels) ||
    format.channels < 1 ||
    format.channels > 2
  ) {
    throw new Error("Mock streaming speech format is invalid");
  }
}

function validateDelay(milliseconds: number | undefined): void {
  if (
    milliseconds !== undefined &&
    (!Number.isFinite(milliseconds) || milliseconds < 0)
  ) {
    throw new Error("Mock streaming speech delay must be non-negative");
  }
}

function measureTranscriptionEvent(event: StreamingTranscriptionEvent): {
  bytes: number;
  durationMs: number;
} {
  const text = event.type === "partial" ? event.text : event.result.text;
  return { bytes: new TextEncoder().encode(text).byteLength, durationMs: 0 };
}

function measureSynthesisEvent(event: StreamingSynthesisEvent): {
  bytes: number;
  durationMs: number;
} {
  if (event.type === "completed") return { bytes: 128, durationMs: 0 };
  const samples =
    event.chunk.data.byteLength / (event.chunk.format.channels * 2);
  return {
    bytes: event.chunk.data.byteLength,
    durationMs: (samples / event.chunk.format.sampleRate) * 1_000
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError("Streaming speech was cancelled");
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

class MockStreamingSessionStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MockStreamingSessionStateError";
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (milliseconds === 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError("Streaming speech was cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
