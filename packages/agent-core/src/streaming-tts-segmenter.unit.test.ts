import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StreamingTtsSegmenter,
  type StreamingTtsSegment
} from "./streaming-tts-segmenter.js";
import type { StreamingAgentEvent } from "./types.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("StreamingTtsSegmenter", () => {
  it("segments English and Chinese text at stable punctuation", async () => {
    const segmenter = createSegmenter();
    const finalText = "Hello world. 你好，世界！Next sentence?";

    await segmenter.accept(textDelta("Hello world. "));
    await segmenter.accept(textDelta("你好，世界！"));
    await segmenter.accept(textDelta("Next sentence?"));
    await segmenter.finish(finalText);

    const segments = await collect(segmenter);
    expect(segments).toEqual([
      { index: 0, text: "Hello world.", reason: "punctuation" },
      { index: 1, text: " 你好，世界！", reason: "punctuation" },
      { index: 2, text: "Next sentence?", reason: "punctuation" }
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(finalText);
  });

  it("uses Unicode code points and never splits surrogate pairs", async () => {
    const segmenter = createSegmenter({
      minCharacters: 3,
      maxCharacters: 3
    });
    const finalText = "😀😀😀x";

    await segmenter.accept(textDelta(finalText));
    await segmenter.finish(finalText);

    expect(await collect(segmenter)).toEqual([
      { index: 0, text: "😀😀😀", reason: "max_length" },
      { index: 1, text: "x", reason: "final" }
    ]);
  });

  it("retains surrogate pairs split across provider deltas", async () => {
    const segmenter = createSegmenter({
      minCharacters: 240,
      maxCharacters: 240
    });
    const prefix = "x".repeat(239);
    const emoji = "😀";

    await segmenter.accept(textDelta(prefix + emoji[0]));
    await segmenter.accept(textDelta(emoji[1] ?? ""));
    await segmenter.finish(prefix + emoji);

    expect(await collect(segmenter)).toEqual([
      {
        index: 0,
        text: prefix + emoji,
        reason: "max_length"
      }
    ]);
  });

  it("starts the timeout only after a split surrogate becomes complete", async () => {
    vi.useFakeTimers();
    const segmenter = createSegmenter({ maxWaitMs: 400 });
    const emoji = "😀";
    await segmenter.accept(textDelta(emoji[0] ?? ""));
    await vi.advanceTimersByTimeAsync(400);
    await segmenter.accept(textDelta(emoji[1] ?? ""));
    const iterator = segmenter[Symbol.asyncIterator]();
    const pending = iterator.next();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(399);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({
      value: { text: emoji, reason: "timeout" }
    });
    await segmenter.finish(emoji);
  });

  it("flushes pending stable text after the maximum wait", async () => {
    vi.useFakeTimers();
    const segmenter = createSegmenter({ maxWaitMs: 400 });
    await segmenter.accept(textDelta("short"));

    await vi.advanceTimersByTimeAsync(399);
    const iterator = segmenter[Symbol.asyncIterator]();
    const pending = iterator.next();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({
      done: false,
      value: { index: 0, text: "short", reason: "timeout" }
    });
    expect(settled).toBe(true);
    await segmenter.finish("short");
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined
    });
  });

  it("restarts the wait after timed text is consumed by a prefix", async () => {
    vi.useFakeTimers();
    const segmenter = createSegmenter({ maxWaitMs: 400 });
    await segmenter.accept(textDelta("ab"));
    await vi.advanceTimersByTimeAsync(399);
    await segmenter.accept(textDelta("c. x"));
    const iterator = segmenter[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { text: "abc.", reason: "punctuation" }
    });
    const suffix = iterator.next();
    let settled = false;
    void suffix.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(399);
    await expect(suffix).resolves.toMatchObject({
      value: { text: " x", reason: "timeout" }
    });
    await segmenter.finish("abc. x");
  });

  it("ignores provisional tool text and accepts only final speakable text", async () => {
    const segmenter = createSegmenter();
    await segmenter.accept(textDelta("I might call a tool", false));
    await segmenter.accept(completionFinished("tool_call", null));
    await segmenter.accept(textDelta("The final answer", false, 1));
    await segmenter.accept(completionFinished("stop", "The final answer.", 1));
    await segmenter.finish("The final answer.");

    expect(await collect(segmenter)).toEqual([
      {
        index: 0,
        text: "The final answer.",
        reason: "punctuation"
      }
    ]);
  });

  it("serializes concurrent accepts without reordering text", async () => {
    const segmenter = createSegmenter();

    await Promise.all([
      segmenter.accept(textDelta("First ")),
      segmenter.accept(textDelta("second."))
    ]);
    await segmenter.finish("First second.");

    expect(
      (await collect(segmenter)).map((segment) => segment.text).join("")
    ).toBe("First second.");
  });

  it("rejects a final-text mismatch and fails the segment stream", async () => {
    const segmenter = createSegmenter();
    await segmenter.accept(textDelta("Actual"));
    const events = collect(segmenter);

    await expect(segmenter.finish("Different")).rejects.toMatchObject({
      code: "FINAL_TEXT_MISMATCH"
    });
    await expect(events).rejects.toMatchObject({ code: "QUEUE_FAILED" });
  });

  it("cancels pending text and rejects consumers", async () => {
    const controller = new AbortController();
    const segmenter = createSegmenter({ signal: controller.signal });
    await segmenter.accept(textDelta("Pending"));
    const events = collect(segmenter);

    controller.abort();

    await expect(events).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(segmenter.accept(textDelta("late"))).rejects.toMatchObject({
      code: "CLOSED"
    });
  });

  it("enforces assistant and option limits", async () => {
    expect(() =>
      createSegmenter({ minCharacters: 10, maxCharacters: 5 })
    ).toThrow("options are invalid");
    const segmenter = createSegmenter({
      minCharacters: 240,
      maxCharacters: 240
    });
    await expect(
      segmenter.accept(textDelta("x".repeat(32_001)))
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const invalidUnicode = createSegmenter();
    await invalidUnicode.accept(textDelta("\ud83d"));
    await expect(invalidUnicode.finish("\ud83d")).rejects.toMatchObject({
      code: "INVALID_TEXT"
    });
  });
});

function createSegmenter(
  options: ConstructorParameters<typeof StreamingTtsSegmenter>[0] = {}
): StreamingTtsSegmenter {
  return new StreamingTtsSegmenter({
    minCharacters: 3,
    maxCharacters: 40,
    maxWaitMs: 10_000,
    ...options
  });
}

function textDelta(
  delta: string,
  speakable = true,
  completionIndex = 0
): StreamingAgentEvent {
  return {
    type: "text_delta",
    completionIndex,
    delta,
    speakable
  };
}

function completionFinished(
  finishReason: "stop" | "tool_call",
  speakableText: string | null,
  completionIndex = 0
): StreamingAgentEvent {
  return {
    type: "completion_finished",
    completionIndex,
    finishReason,
    text: speakableText ?? "",
    speakableText,
    usage: null
  };
}

async function collect(
  iterable: AsyncIterable<StreamingTtsSegment>
): Promise<StreamingTtsSegment[]> {
  const values: StreamingTtsSegment[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
