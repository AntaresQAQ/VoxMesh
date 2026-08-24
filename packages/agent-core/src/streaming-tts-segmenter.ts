import {
  BoundedAsyncQueue,
  BoundedQueueError
} from "@voxmesh/shared/bounded-async-queue";
import { VOICE_STREAM_LIMITS } from "@voxmesh/shared/voice-stream";

import type { StreamingAgentEvent } from "./types.js";

export type StreamingTtsSegmentReason =
  "punctuation" | "max_length" | "timeout" | "final";

export interface StreamingTtsSegment {
  index: number;
  text: string;
  reason: StreamingTtsSegmentReason;
}

export interface StreamingTtsSegmenterOptions {
  minCharacters?: number;
  maxCharacters?: number;
  maxWaitMs?: number;
  signal?: AbortSignal;
  scheduler?: StreamingTtsSegmenterScheduler;
}

export interface StreamingTtsSegmenterScheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type StreamingTtsSegmenterErrorCode =
  | "CANCELLED"
  | "CLOSED"
  | "LIMIT_EXCEEDED"
  | "INVALID_TEXT"
  | "FINAL_TEXT_MISMATCH";

export class StreamingTtsSegmenterError extends Error {
  public constructor(
    public readonly code: StreamingTtsSegmenterErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StreamingTtsSegmenterError";
  }
}

/**
 * Converts speakable Streaming Agent text into ordered, bounded TTS segments.
 *
 * Provisional tool-enabled deltas are ignored. `finish` verifies that the
 * accepted speakable source exactly matches the final assistant response.
 */
export class StreamingTtsSegmenter implements AsyncIterable<StreamingTtsSegment> {
  private readonly minCharacters: number;
  private readonly maxCharacters: number;
  private readonly maxWaitMs: number;
  private readonly scheduler: StreamingTtsSegmenterScheduler;
  private readonly segments: BoundedAsyncQueue<StreamingTtsSegment>;
  private readonly onAbort = () => this.cancel();
  private operation: Promise<void> = Promise.resolve();
  private pending = "";
  private readonly acceptedParts: string[] = [];
  private acceptedUtf16Units = 0;
  private deferredHighSurrogate = "";
  private nextIndex = 0;
  private timer: { handle: unknown } | null = null;
  private timerCoveredUtf16 = 0;
  private state: "open" | "finished" | "cancelled" | "failed" = "open";

  public constructor(
    private readonly options: StreamingTtsSegmenterOptions = {}
  ) {
    this.minCharacters =
      options.minCharacters ?? VOICE_STREAM_LIMITS.minTtsSegmentCharacters;
    this.maxCharacters =
      options.maxCharacters ?? VOICE_STREAM_LIMITS.maxTtsSegmentCharacters;
    this.maxWaitMs =
      options.maxWaitMs ?? VOICE_STREAM_LIMITS.maxTtsSegmentWaitMs;
    validateOptions(this.minCharacters, this.maxCharacters, this.maxWaitMs);
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.segments = new BoundedAsyncQueue(
      {
        maxItems:
          Math.ceil(
            VOICE_STREAM_LIMITS.maxAssistantCharacters / this.minCharacters
          ) + 1,
        maxBytes: VOICE_STREAM_LIMITS.maxAssistantCharacters * 4,
        maxDurationMs: 1
      },
      (segment) => ({
        bytes: new TextEncoder().encode(segment.text).byteLength,
        durationMs: 0
      })
    );
    if (options.signal?.aborted) {
      this.cancel();
    } else {
      options.signal?.addEventListener("abort", this.onAbort, { once: true });
    }
  }

  public accept(event: StreamingAgentEvent): Promise<void> {
    return this.serialize(async () => {
      this.assertOpen();
      if (event.type === "text_delta" && event.speakable) {
        await this.append(event.delta);
      } else if (
        event.type === "completion_finished" &&
        event.speakableText !== null
      ) {
        await this.append(event.speakableText);
      }
    });
  }

  public finish(finalAssistantText: string): Promise<void> {
    return this.serialize(async () => {
      this.assertOpen();
      if (this.deferredHighSurrogate.length > 0) {
        throw new StreamingTtsSegmenterError(
          "INVALID_TEXT",
          "Speakable streaming text ended with an incomplete surrogate pair"
        );
      }
      if (this.acceptedParts.join("") !== finalAssistantText) {
        throw new StreamingTtsSegmenterError(
          "FINAL_TEXT_MISMATCH",
          "Speakable streaming text does not match the final assistant text"
        );
      }
      this.clearTimer();
      if (this.pending.length > 0) {
        await this.emit(this.pending, "final");
        this.pending = "";
      }
      this.state = "finished";
      this.detachAbort();
      this.segments.close();
    });
  }

  public cancel(): void {
    if (this.state !== "open") return;
    this.state = "cancelled";
    this.clearTimer();
    this.pending = "";
    this.deferredHighSurrogate = "";
    this.acceptedParts.length = 0;
    this.acceptedUtf16Units = 0;
    this.detachAbort();
    this.segments.fail(
      new BoundedQueueError("CANCELLED", "Streaming TTS segmentation cancelled")
    );
  }

  public [Symbol.asyncIterator](): AsyncIterator<StreamingTtsSegment> {
    return this.segments[Symbol.asyncIterator]();
  }

  private async append(text: string): Promise<void> {
    if (text.length === 0) return;
    const normalized = normalizeDelta(text, this.deferredHighSurrogate);
    this.deferredHighSurrogate = normalized.deferredHighSurrogate;
    this.acceptedUtf16Units += text.length;
    if (this.acceptedUtf16Units > VOICE_STREAM_LIMITS.maxAssistantCharacters) {
      throw new StreamingTtsSegmenterError(
        "LIMIT_EXCEEDED",
        "Speakable streaming text exceeded its limit"
      );
    }
    this.acceptedParts.push(text);
    this.pending += normalized.stableText;
    await this.emitAvailable();
    if (this.pending.length > 0) this.ensureTimer();
  }

  private async emitAvailable(): Promise<void> {
    while (true) {
      const punctuation = findBoundary(
        this.pending,
        this.minCharacters,
        this.maxCharacters,
        true
      );
      if (punctuation > 0) {
        await this.emitPrefix(punctuation, "punctuation");
        continue;
      }
      if (codePointLength(this.pending) >= this.maxCharacters) {
        const softBoundary = findBoundary(
          this.pending,
          this.minCharacters,
          this.maxCharacters,
          false
        );
        const boundary =
          softBoundary > 0
            ? softBoundary
            : utf16OffsetForCodePoints(this.pending, this.maxCharacters);
        await this.emitPrefix(boundary, "max_length");
        continue;
      }
      return;
    }
  }

  private async emitPrefix(
    utf16Offset: number,
    reason: StreamingTtsSegmentReason
  ): Promise<void> {
    const text = this.pending.slice(0, utf16Offset);
    this.pending = this.pending.slice(utf16Offset);
    await this.emit(text, reason);
    this.advanceTimerCoverage(utf16Offset);
  }

  private async emit(
    text: string,
    reason: StreamingTtsSegmentReason
  ): Promise<void> {
    await this.segments.enqueue({
      index: this.nextIndex,
      text,
      reason
    });
    this.nextIndex += 1;
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    this.timerCoveredUtf16 = this.pending.length;
    this.timer = {
      handle: this.scheduler.setTimeout(() => {
        this.timer = null;
        this.timerCoveredUtf16 = 0;
        void this.serialize(async () => {
          if (this.state !== "open" || this.pending.length === 0) return;
          const text = this.pending;
          this.pending = "";
          await this.emit(text, "timeout");
        }).catch((error: unknown) => this.fail(error));
      }, this.maxWaitMs)
    };
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.scheduler.clearTimeout(this.timer.handle);
    this.timer = null;
    this.timerCoveredUtf16 = 0;
  }

  private advanceTimerCoverage(emittedUtf16: number): void {
    if (this.timer === null) return;
    this.timerCoveredUtf16 = Math.max(0, this.timerCoveredUtf16 - emittedUtf16);
    if (this.timerCoveredUtf16 > 0) return;
    this.clearTimer();
    if (this.pending.length > 0) this.ensureTimer();
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(async () => {
      try {
        await operation();
      } catch (error) {
        if (!(
          error instanceof StreamingTtsSegmenterError && error.code === "CLOSED"
        )) {
          this.fail(error);
        }
        throw error;
      }
    });
    this.operation = result.catch(() => undefined);
    return result;
  }

  private fail(error: unknown): void {
    if (this.state === "failed" || this.state === "cancelled") return;
    this.state = "failed";
    this.clearTimer();
    this.pending = "";
    this.deferredHighSurrogate = "";
    this.acceptedParts.length = 0;
    this.acceptedUtf16Units = 0;
    this.detachAbort();
    this.segments.fail(error);
  }

  private assertOpen(): void {
    if (this.state !== "open") {
      throw new StreamingTtsSegmenterError(
        "CLOSED",
        "Streaming TTS segmenter is closed"
      );
    }
  }

  private detachAbort(): void {
    this.options.signal?.removeEventListener("abort", this.onAbort);
  }
}

const defaultScheduler: StreamingTtsSegmenterScheduler = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>)
};

function validateOptions(
  minCharacters: number,
  maxCharacters: number,
  maxWaitMs: number
): void {
  if (
    !Number.isInteger(minCharacters) ||
    minCharacters < 1 ||
    !Number.isInteger(maxCharacters) ||
    maxCharacters < minCharacters ||
    maxCharacters > VOICE_STREAM_LIMITS.maxTtsSegmentCharacters ||
    !Number.isFinite(maxWaitMs) ||
    maxWaitMs < 0
  ) {
    throw new Error("Streaming TTS segmenter options are invalid");
  }
}

function findBoundary(
  text: string,
  minCharacters: number,
  maxCharacters: number,
  punctuationOnly: boolean
): number {
  const points = codePoints(text);
  let boundary = 0;
  for (
    let index = minCharacters - 1;
    index < Math.min(points.length, maxCharacters);
    index += 1
  ) {
    const point = points[index];
    if (
      point &&
      (isStrongPunctuation(point.value) ||
        (!punctuationOnly && isSoftBoundary(point.value)))
    ) {
      boundary = point.endOffset;
    }
  }
  return boundary;
}

function normalizeDelta(
  text: string,
  deferredHighSurrogate: string
): {
  stableText: string;
  deferredHighSurrogate: string;
} {
  const stable: string[] = [];
  let index = 0;
  if (deferredHighSurrogate.length > 0) {
    const first = text.charCodeAt(0);
    if (!(first >= 0xdc00 && first <= 0xdfff)) {
      throw new StreamingTtsSegmenterError(
        "INVALID_TEXT",
        "Speakable streaming text contains an incomplete surrogate pair"
      );
    }
    stable.push(deferredHighSurrogate, text[0] ?? "");
    index = 1;
    deferredHighSurrogate = "";
  }
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= text.length) {
        deferredHighSurrogate = text[index] ?? "";
        index += 1;
        continue;
      }
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new StreamingTtsSegmenterError(
          "INVALID_TEXT",
          "Speakable streaming text contains an invalid surrogate pair"
        );
      }
      stable.push(text.slice(index, index + 2));
      index += 2;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new StreamingTtsSegmenterError(
        "INVALID_TEXT",
        "Speakable streaming text contains an unexpected low surrogate"
      );
    }
    stable.push(text[index] ?? "");
    index += 1;
  }
  return {
    stableText: stable.join(""),
    deferredHighSurrogate
  };
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

function utf16OffsetForCodePoints(text: string, count: number): number {
  return codePoints(text)[count - 1]?.endOffset ?? text.length;
}

function codePoints(text: string): Array<{ value: string; endOffset: number }> {
  const points: Array<{ value: string; endOffset: number }> = [];
  let offset = 0;
  for (const value of text) {
    offset += value.length;
    points.push({ value, endOffset: offset });
  }
  return points;
}

function isStrongPunctuation(value: string): boolean {
  return /[.!?;:\n。！？；：,，、]/u.test(value);
}

function isSoftBoundary(value: string): boolean {
  return isStrongPunctuation(value) || /\s/u.test(value);
}
