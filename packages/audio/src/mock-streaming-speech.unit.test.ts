import { describe, expect, it } from "vitest";

import {
  MockStreamingSpeechToTextProvider,
  MockStreamingTextToSpeechProvider
} from "./mock-streaming-speech.js";
import type { StreamingAudioChunk, StreamingAudioFormat } from "./types.js";

const format: StreamingAudioFormat = {
  encoding: "pcm16le",
  sampleRate: 16_000,
  channels: 1
};

describe("Mock streaming speech providers", () => {
  it("emits deterministic partial and final STT events", async () => {
    const provider = new MockStreamingSpeechToTextProvider({
      partials: ["Check", "Check the light"],
      finalText: "Check the light status",
      framesPerPartial: 1
    });
    const session = await provider.startSession({
      format,
      signal: new AbortController().signal
    });

    await session.write(audioChunk(1));
    await session.write(audioChunk(2));
    await session.finishInput();

    await expect(collect(session)).resolves.toEqual([
      { type: "partial", sequence: 1, text: "Check" },
      { type: "partial", sequence: 2, text: "Check the light" },
      {
        type: "final",
        sequence: 3,
        result: { text: "Check the light status", language: "en" }
      }
    ]);
    await session.close();
    await session.close();
  });

  it("serializes concurrent STT writes and finish operations", async () => {
    const provider = new MockStreamingSpeechToTextProvider({
      partials: ["one", "two"],
      delay: async () => Promise.resolve()
    });
    const session = await provider.startSession({
      format,
      signal: new AbortController().signal
    });

    await Promise.all([
      session.write(audioChunk(1)),
      session.write(audioChunk(2))
    ]);
    await session.finishInput();

    expect(await collect(session)).toEqual([
      { type: "partial", sequence: 1, text: "one" },
      { type: "partial", sequence: 2, text: "two" },
      {
        type: "final",
        sequence: 3,
        result: { text: "Check the light status", language: "en" }
      }
    ]);
  });

  it("rejects invalid STT sequence, format, and terminal writes", async () => {
    const provider = new MockStreamingSpeechToTextProvider();
    const invalidSequence = await provider.startSession({
      format,
      signal: new AbortController().signal
    });
    await expect(invalidSequence.write(audioChunk(2))).rejects.toThrow(
      "invalid sequence"
    );
    const invalidFormat = await provider.startSession({
      format,
      signal: new AbortController().signal
    });
    await expect(
      invalidFormat.write({
        ...audioChunk(1),
        format: { ...format, sampleRate: 48_000 }
      })
    ).rejects.toThrow("invalid format");
    const session = await provider.startSession({
      format,
      signal: new AbortController().signal
    });
    await session.write(audioChunk(1));
    await session.finishInput();
    await expect(session.write(audioChunk(2))).rejects.toThrow(
      "already closed"
    );
    await expect(collect(session)).resolves.toEqual([
      { type: "partial", sequence: 1, text: "Check" },
      { type: "partial", sequence: 2, text: "Check the light" },
      {
        type: "final",
        sequence: 3,
        result: { text: "Check the light status", language: "en" }
      }
    ]);
  });

  it("propagates STT failure and cancellation deterministically", async () => {
    const failed = await new MockStreamingSpeechToTextProvider({
      failOnFinish: true
    }).startSession({
      format,
      signal: new AbortController().signal
    });
    const failedEvents = collect(failed);
    await expect(failed.finishInput()).rejects.toThrow("finish failed");
    await expect(failedEvents).rejects.toMatchObject({ code: "QUEUE_FAILED" });

    const controller = new AbortController();
    const cancelled =
      await new MockStreamingSpeechToTextProvider().startSession({
        format,
        signal: controller.signal
      });
    const cancelledEvents = collect(cancelled);
    controller.abort();
    await expect(cancelledEvents).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("emits ordered deterministic TTS chunks and completion metadata", async () => {
    const session = await new MockStreamingTextToSpeechProvider({
      chunkCount: 3,
      chunkDurationMs: 20
    }).startSynthesis({
      text: "The light is on.",
      signal: new AbortController().signal
    });

    const events = await collect(session);

    expect(events.map((event) => event.type)).toEqual([
      "audio",
      "audio",
      "audio",
      "completed"
    ]);
    expect(
      events
        .filter((event) => event.type === "audio")
        .map((event) => event.chunk.sequence)
    ).toEqual([1, 2, 3]);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      sequence: 4,
      audioBytes: 1_920,
      durationMs: 60
    });
    await session.close();
  });

  it("propagates TTS failure and cancellation", async () => {
    const failed = await new MockStreamingTextToSpeechProvider({
      failAtChunk: 2
    }).startSynthesis({
      text: "Failure",
      signal: new AbortController().signal
    });
    await expect(collect(failed)).rejects.toMatchObject({
      code: "QUEUE_FAILED"
    });

    const controller = new AbortController();
    const cancelled = await new MockStreamingTextToSpeechProvider({
      eventDelayMs: 1_000
    }).startSynthesis({
      text: "Cancel",
      signal: controller.signal
    });
    const cancelledEvents = collect(cancelled);
    controller.abort();
    await expect(cancelledEvents).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("rejects unsupported provider formats and invalid TTS options", async () => {
    await expect(
      new MockStreamingSpeechToTextProvider().startSession({
        format: { ...format, channels: 2 },
        signal: new AbortController().signal
      })
    ).rejects.toThrow("unsupported format");
    await expect(
      new MockStreamingTextToSpeechProvider({
        chunkDurationMs: 7,
        format: { ...format, sampleRate: 44_100 }
      }).startSynthesis({
        text: "Invalid",
        signal: new AbortController().signal
      })
    ).rejects.toThrow("integral sample count");
    await expect(
      new MockStreamingTextToSpeechProvider({
        chunkDurationMs: 3_000
      }).startSynthesis({
        text: "Too large",
        signal: new AbortController().signal
      })
    ).rejects.toThrow("contract limits");
  });
});

function audioChunk(sequence: number): StreamingAudioChunk {
  return {
    sequence,
    format,
    data: new Uint8Array(640)
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
