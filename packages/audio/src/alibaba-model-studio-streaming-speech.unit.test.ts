import { EventEmitter } from "node:events";
import type { ClientOptions } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AlibabaModelStudioStreamingSpeechToTextProvider,
  AlibabaModelStudioStreamingTextToSpeechProvider
} from "./alibaba-model-studio-streaming-speech.js";
import {
  parseAlibabaEvent,
  type AlibabaWebSocket,
  type AlibabaWebSocketFactory
} from "./alibaba-model-studio-websocket.js";
import type {
  StreamingSynthesisEvent,
  StreamingTranscriptionEvent
} from "./types.js";

const endpoint =
  "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference";
const sttConfig = {
  endpoint,
  model: "fun-asr-realtime",
  apiKey: "test-api-key",
  language: "zh",
  timeoutMs: 5_000
};
const ttsConfig = {
  endpoint,
  model: "qwen-audio-3.0-tts-plus",
  apiKey: "test-api-key",
  voice: "longanlingxin",
  instructions: "Speak warmly.",
  timeoutMs: 5_000
};

afterEach(() => {
  vi.useRealTimers();
});

describe("Alibaba Model Studio streaming speech adapters", () => {
  it("reports the missing provider event field precisely", () => {
    expect(() =>
      parseAlibabaEvent(JSON.stringify({ header: { event: "task-started" } }))
    ).toThrow("Alibaba response requires payload");
  });

  it("streams ordered Fun-ASR partial and final transcripts", async () => {
    const socket = new StreamingAlibabaSocket("stt");
    const factory = createFactory(socket);
    const provider = new AlibabaModelStudioStreamingSpeechToTextProvider(
      sttConfig,
      factory.create
    );
    const session = await provider.startSession({
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      signal: new AbortController().signal
    });

    await session.write(inputChunk(1, [1, 0, 2, 0]));
    socket.emitSentence("检查", false);
    await session.finishInput();
    const events = await collect<StreamingTranscriptionEvent>(session);

    expect(events).toEqual([
      { type: "partial", sequence: 1, text: "检查" },
      {
        type: "final",
        sequence: 2,
        result: { text: "检查 灯光", language: "zh" }
      }
    ]);
    expect(socket.binaryInput).toEqual([new Uint8Array([1, 0, 2, 0])]);
    expect(socket.runTask).toMatchObject({
      payload: {
        task_group: "audio",
        task: "asr",
        function: "recognition",
        model: "fun-asr-realtime",
        parameters: {
          format: "pcm",
          sample_rate: 16_000,
          language_hints: ["zh"]
        }
      }
    });
    expect(factory.options.headers).toMatchObject({
      Authorization: "******",
      "User-Agent": "VoxMesh"
    });
    expect(factory.authorizationAtCreation).toBe(
      ["Bearer", sttConfig.apiKey].join(" ")
    );
    expect(socket.closeCount).toBe(1);
  });

  it("streams ordered Qwen/CosyVoice PCM and exact aggregate metadata", async () => {
    const socket = new StreamingAlibabaSocket("tts");
    const factory = createFactory(socket);
    const provider = new AlibabaModelStudioStreamingTextToSpeechProvider(
      ttsConfig,
      factory.create
    );
    const session = await provider.startSynthesis({
      text: "你好",
      signal: new AbortController().signal
    });
    const events = await collect<StreamingSynthesisEvent>(session);

    expect(events).toEqual([
      {
        type: "audio",
        chunk: {
          sequence: 1,
          format: { encoding: "pcm16le", sampleRate: 24_000, channels: 1 },
          data: new Uint8Array([1, 0, 2, 0])
        }
      },
      {
        type: "audio",
        chunk: {
          sequence: 2,
          format: { encoding: "pcm16le", sampleRate: 24_000, channels: 1 },
          data: new Uint8Array([3, 0, 4, 0])
        }
      },
      {
        type: "completed",
        sequence: 3,
        format: { encoding: "pcm16le", sampleRate: 24_000, channels: 1 },
        audioBytes: 8,
        durationMs: 1 / 6
      }
    ]);
    expect(socket.continueText).toBe("你好");
    expect(socket.runTask).toMatchObject({
      payload: {
        task_group: "audio",
        task: "tts",
        function: "SpeechSynthesizer",
        model: "qwen-audio-3.0-tts-plus",
        parameters: {
          voice: "longanlingxin",
          format: "pcm",
          sample_rate: 24_000,
          instruction: "Speak warmly."
        }
      }
    });
    expect(socket.closeCount).toBe(1);
  });

  it("rejects unsupported STT format and invalid input sequence", async () => {
    const provider = new AlibabaModelStudioStreamingSpeechToTextProvider(
      sttConfig,
      createFactory(new StreamingAlibabaSocket("stt")).create
    );

    await expect(
      provider.startSession({
        format: { encoding: "pcm16le", sampleRate: 48_000, channels: 1 },
        signal: new AbortController().signal
      })
    ).rejects.toThrow("requires mono 16 kHz PCM16LE");

    const socket = new StreamingAlibabaSocket("stt");
    const session = await new AlibabaModelStudioStreamingSpeechToTextProvider(
      sttConfig,
      createFactory(socket).create
    ).startSession({
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      signal: new AbortController().signal
    });

    await expect(session.write(inputChunk(2, [1, 0]))).rejects.toThrow(
      "invalid PCM audio"
    );
    await expect(session[Symbol.asyncIterator]().next()).rejects.toThrow(
      "Alibaba Streaming STT failed"
    );
    expect(socket.closeCount).toBe(1);
  });

  it("validates timeout and redacts socket construction failures", async () => {
    expect(
      () =>
        new AlibabaModelStudioStreamingSpeechToTextProvider({
          ...sttConfig,
          timeoutMs: 0
        })
    ).toThrow("streaming timeout must be positive");
    const provider = new AlibabaModelStudioStreamingSpeechToTextProvider(
      sttConfig,
      () => {
        throw new Error("provider-secret");
      }
    );

    const started = provider.startSession({
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      signal: new AbortController().signal
    });

    const failure = await started.catch((error: unknown) => error);
    if (!(failure instanceof Error)) {
      throw new Error("Expected a socket construction error");
    }
    expect(failure.message).toBe(
      "Alibaba Model Studio streaming WebSocket connection failed"
    );
    expect(failure).not.toHaveProperty("cause");
    expect(failure.message).not.toContain("provider-secret");
  });

  it("does not count cumulative partial revisions toward the final limit", async () => {
    const socket = new StreamingAlibabaSocket("stt");
    const session = await new AlibabaModelStudioStreamingSpeechToTextProvider(
      sttConfig,
      createFactory(socket).create
    ).startSession({
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      signal: new AbortController().signal
    });
    for (let index = 0; index < 90; index += 1) {
      socket.emitSentence("x".repeat(100), false);
    }

    await session.finishInput();
    const events = await collect(session);

    expect(events.filter((event) => event.type === "partial")).toHaveLength(90);
    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: { text: "检查 灯光" }
    });
  });

  it("uses separate setup and post-finish timeouts", async () => {
    vi.useFakeTimers();
    const active = new StreamingAlibabaSocket("stt");
    const session = await new AlibabaModelStudioStreamingSpeechToTextProvider(
      { ...sttConfig, timeoutMs: 10 },
      createFactory(active).create
    ).startSession({
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      signal: new AbortController().signal
    });

    await vi.advanceTimersByTimeAsync(100);
    await expect(session.write(inputChunk(1, [1, 0]))).resolves.toBeUndefined();
    await session.close();

    const waiting = new StreamingAlibabaSocket("waiting-finish");
    const stalled = await new AlibabaModelStudioStreamingSpeechToTextProvider(
      { ...sttConfig, timeoutMs: 10 },
      createFactory(waiting).create
    ).startSession({
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      signal: new AbortController().signal
    });
    await stalled.finishInput();
    const next = stalled[Symbol.asyncIterator]().next();
    const stalledFailure = expect(next).rejects.toMatchObject({
      code: "QUEUE_FAILED"
    });

    await vi.advanceTimersByTimeAsync(10);

    await stalledFailure;
    expect(waiting.closeCount).toBe(1);
  });

  it("fails closed on malformed event ordering and provider payloads", async () => {
    const premature = new StreamingAlibabaSocket("premature-finish");
    const failed = new StreamingAlibabaSocket("failed");

    await expect(
      new AlibabaModelStudioStreamingSpeechToTextProvider(
        sttConfig,
        createFactory(premature).create
      ).startSession({
        format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
        signal: new AbortController().signal
      })
    ).rejects.toThrow("streaming task failed");
    await expect(
      new AlibabaModelStudioStreamingSpeechToTextProvider(
        sttConfig,
        createFactory(failed).create
      ).startSession({
        format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
        signal: new AbortController().signal
      })
    ).rejects.not.toThrow("provider-secret");
    expect(premature.closeCount).toBe(1);
    expect(failed.closeCount).toBe(1);
  });

  it("propagates cancellation and releases the active socket", async () => {
    const controller = new AbortController();
    const socket = new StreamingAlibabaSocket("stt");
    const session = await new AlibabaModelStudioStreamingSpeechToTextProvider(
      sttConfig,
      createFactory(socket).create
    ).startSession({
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      signal: controller.signal
    });
    const nextEvent = session[Symbol.asyncIterator]().next();

    controller.abort();

    await expect(nextEvent).rejects.toMatchObject({ code: "CANCELLED" });
    expect(socket.closeCount).toBe(1);
  });

  it("preserves explicit session-close cancellation semantics", async () => {
    const socket = new StreamingAlibabaSocket("stt");
    const session = await new AlibabaModelStudioStreamingSpeechToTextProvider(
      sttConfig,
      createFactory(socket).create
    ).startSession({
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      signal: new AbortController().signal
    });
    const next = session[Symbol.asyncIterator]().next();
    const cancelled = expect(next).rejects.toMatchObject({
      code: "CANCELLED"
    });

    await session.close();

    await cancelled;
    expect(socket.closeCount).toBe(1);
  });

  it("times out setup and rejects malformed TTS audio", async () => {
    vi.useFakeTimers();
    const waiting = new StreamingAlibabaSocket("waiting");
    const setup = new AlibabaModelStudioStreamingSpeechToTextProvider(
      { ...sttConfig, timeoutMs: 10 },
      createFactory(waiting).create
    ).startSession({
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      signal: new AbortController().signal
    });
    const setupFailure = expect(setup).rejects.toThrow("streaming task failed");

    await vi.advanceTimersByTimeAsync(10);
    await setupFailure;
    expect(waiting.closeCount).toBe(1);
    vi.useRealTimers();

    const malformed = new StreamingAlibabaSocket("tts-invalid-audio");
    const session = await new AlibabaModelStudioStreamingTextToSpeechProvider(
      ttsConfig,
      createFactory(malformed).create
    ).startSynthesis({
      text: "你好",
      signal: new AbortController().signal
    });

    await expect(session[Symbol.asyncIterator]().next()).rejects.toThrow(
      "Alibaba Streaming TTS failed"
    );
    expect(malformed.closeCount).toBe(1);
  });
});

function createFactory(socket: StreamingAlibabaSocket): {
  create: AlibabaWebSocketFactory;
  options: ClientOptions;
  authorizationAtCreation: string | undefined;
} {
  const result: {
    create: AlibabaWebSocketFactory;
    options: ClientOptions;
    authorizationAtCreation: string | undefined;
  } = {
    options: {},
    authorizationAtCreation: undefined,
    create: (_url, options) => {
      result.options = options;
      result.authorizationAtCreation = options.headers?.Authorization;
      queueMicrotask(() => socket.emit("open"));
      return socket;
    }
  };
  return result;
}

class StreamingAlibabaSocket extends EventEmitter implements AlibabaWebSocket {
  public runTask: Record<string, unknown> | null = null;
  public continueText = "";
  public readonly binaryInput: Uint8Array[] = [];
  public closeCount = 0;

  public constructor(
    private readonly mode:
      | "stt"
      | "tts"
      | "failed"
      | "premature-finish"
      | "waiting"
      | "waiting-finish"
      | "tts-invalid-audio"
  ) {
    super();
  }

  public send(data: string | Uint8Array): void {
    if (typeof data !== "string") {
      this.binaryInput.push(new Uint8Array(data));
      return;
    }
    const message = JSON.parse(data) as {
      header: { action: string };
      payload: Record<string, unknown>;
    };
    switch (message.header.action) {
      case "run-task":
        this.runTask = message;
        queueMicrotask(() => {
          if (this.mode === "waiting") return;
          if (this.mode === "failed") {
            this.emitJson({
              header: {
                event: "task-failed",
                error_code: "InvalidParameter",
                error_message: "provider-secret"
              },
              payload: {}
            });
            return;
          }
          if (this.mode === "premature-finish") {
            this.emitJson({
              header: { event: "task-finished" },
              payload: {}
            });
            return;
          }
          this.emitJson({
            header: { event: "task-started" },
            payload: {}
          });
        });
        return;
      case "continue-task": {
        const input = message.payload.input as { text?: string };
        this.continueText = input.text ?? "";
        return;
      }
      case "finish-task":
        queueMicrotask(() => {
          if (this.mode === "waiting-finish") return;
          if (this.mode === "stt") {
            this.emitSentence("检查", true);
            this.emitSentence("灯光", true);
          } else if (this.mode === "tts") {
            this.emit("message", Buffer.from([1, 0, 2, 0]), true);
            this.emit("message", Buffer.from([3, 0, 4, 0]), true);
          } else if (this.mode === "tts-invalid-audio") {
            this.emit("message", Buffer.from([1]), true);
          }
          this.emitJson({
            header: { event: "task-finished" },
            payload: {}
          });
        });
    }
  }

  public close(): void {
    this.closeCount += 1;
    this.emit("close", 1000, Buffer.alloc(0));
  }

  public emitSentence(text: string, sentenceEnd: boolean): void {
    this.emitJson({
      header: { event: "result-generated" },
      payload: {
        output: {
          sentence: {
            sentence_end: sentenceEnd,
            text
          }
        }
      }
    });
  }

  private emitJson(value: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify(value)), false);
  }
}

function inputChunk(
  sequence: number,
  values: number[]
): {
  sequence: number;
  format: { encoding: "pcm16le"; sampleRate: number; channels: number };
  data: Uint8Array;
} {
  return {
    sequence,
    format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
    data: new Uint8Array(values)
  };
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
