import { EventEmitter } from "node:events";
import type { ClientOptions } from "ws";
import { describe, expect, it } from "vitest";

import {
  AlibabaModelStudioSpeechToTextProvider,
  AlibabaModelStudioTextToSpeechProvider,
  type AlibabaWebSocket,
  type AlibabaWebSocketFactory
} from "./alibaba-model-studio-speech.js";
import { decodePcm16Wav, encodePcm16Wav } from "./pcm-wav.js";

describe("Alibaba Model Studio speech adapters", () => {
  it("rejects an already aborted buffered speech operation", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new AlibabaModelStudioSpeechToTextProvider(
      {
        endpoint:
          "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        model: "fun-asr-realtime",
        apiKey: "secret",
        language: "zh"
      },
      createFactory(new FakeAlibabaSocket("stt")).create
    );

    await expect(
      provider.transcribe(
        {
          data: new Uint8Array([1, 0]),
          mimeType: "audio/wav"
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("runs a Fun-ASR task with PCM audio and final sentence results", async () => {
    const socket = new FakeAlibabaSocket("stt");
    const factory = createFactory(socket);
    const provider = new AlibabaModelStudioSpeechToTextProvider(
      {
        endpoint:
          "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        model: "fun-asr-realtime",
        apiKey: "secret",
        language: "zh"
      },
      factory.create
    );
    const audio = encodePcm16Wav({
      channels: 1,
      sampleRate: 16_000,
      pcm: new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0])
    });

    await expect(
      provider.transcribe({ data: audio, mimeType: "audio/wav" })
    ).resolves.toEqual({ text: "你好 世界", language: "zh" });

    expect(factory.options.headers).toMatchObject({
      Authorization: "Bearer secret",
      "User-Agent": "VoxMesh"
    });
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
    expect(socket.binaryInput).toEqual([
      new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0])
    ]);
  });

  it("runs a TTS task and wraps returned PCM in WAV", async () => {
    const socket = new FakeAlibabaSocket("tts");
    const factory = createFactory(socket);
    const provider = new AlibabaModelStudioTextToSpeechProvider(
      {
        endpoint:
          "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        model: "qwen-audio-3.0-tts-plus",
        apiKey: "secret",
        voice: "longanlingxin",
        instructions: "Speak warmly."
      },
      factory.create
    );

    const result = await provider.synthesize("你好");

    expect(result.mimeType).toBe("audio/wav");
    expect(result.sampleRate).toBe(24_000);
    expect(decodePcm16Wav(result.data)).toEqual({
      channels: 1,
      sampleRate: 24_000,
      pcm: new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0])
    });
    expect(socket.runTask).toMatchObject({
      payload: {
        task_group: "audio",
        task: "tts",
        function: "SpeechSynthesizer",
        model: "qwen-audio-3.0-tts-plus",
        parameters: {
          text_type: "PlainText",
          voice: "longanlingxin",
          format: "pcm",
          sample_rate: 24_000,
          instruction: "Speak warmly."
        }
      }
    });
    expect(socket.continueText).toBe("你好");
  });

  it("rejects unsupported input and provider task failures", async () => {
    const provider = new AlibabaModelStudioSpeechToTextProvider(
      {
        endpoint:
          "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        model: "fun-asr-realtime",
        apiKey: "secret",
        language: "zh"
      },
      createFactory(new FakeAlibabaSocket("failed")).create
    );

    await expect(
      provider.transcribe({
        data: new Uint8Array([1, 2, 3]),
        mimeType: "audio/webm"
      })
    ).rejects.toThrow("Alibaba Model Studio STT requires mono PCM16 WAV audio");

    await expect(
      provider.transcribe({
        data: encodePcm16Wav({
          channels: 1,
          sampleRate: 16_000,
          pcm: new Uint8Array([1, 0])
        }),
        mimeType: "audio/wav"
      })
    ).rejects.toThrow(
      "Alibaba Model Studio task failed (InvalidParameter): invalid model"
    );
  });
});

function createFactory(socket: FakeAlibabaSocket): {
  create: AlibabaWebSocketFactory;
  options: ClientOptions;
} {
  const result: {
    create: AlibabaWebSocketFactory;
    options: ClientOptions;
  } = {
    options: {},
    create: (_url, options) => {
      result.options = options;
      queueMicrotask(() => socket.emit("open"));
      return socket;
    }
  };
  return result;
}

class FakeAlibabaSocket extends EventEmitter implements AlibabaWebSocket {
  public runTask: Record<string, unknown> | null = null;
  public continueText = "";
  public readonly binaryInput: Uint8Array[] = [];

  public constructor(private readonly mode: "stt" | "tts" | "failed") {
    super();
  }

  public send(data: string | Uint8Array): void {
    if (typeof data !== "string") {
      this.binaryInput.push(data);
      return;
    }
    const message = JSON.parse(data) as {
      header: { action: string; task_id: string };
      payload: Record<string, unknown>;
    };
    if (message.header.action === "run-task") {
      this.runTask = message;
      queueMicrotask(() => {
        if (this.mode === "failed") {
          this.emitJson({
            header: {
              event: "task-failed",
              error_code: "InvalidParameter",
              error_message: "invalid model"
            },
            payload: {}
          });
        } else {
          this.emitJson({
            header: { event: "task-started" },
            payload: {}
          });
        }
      });
    } else if (message.header.action === "continue-task") {
      const input = message.payload.input as { text?: string };
      this.continueText = input.text ?? "";
    } else if (message.header.action === "finish-task") {
      queueMicrotask(() => {
        if (this.mode === "stt") {
          this.emitJson(sentence("你好"));
          this.emitJson(sentence("世界"));
        } else if (this.mode === "tts") {
          this.emit("message", Buffer.from([1, 0, 2, 0]), true);
          this.emit("message", Buffer.from([3, 0, 4, 0]), true);
        }
        this.emitJson({
          header: { event: "task-finished" },
          payload: {}
        });
      });
    }
  }

  public close(): void {
    this.emit("close", 1000, Buffer.alloc(0));
  }

  private emitJson(value: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify(value)), false);
  }
}

function sentence(text: string): Record<string, unknown> {
  return {
    header: { event: "result-generated" },
    payload: {
      output: {
        sentence: {
          sentence_end: true,
          text
        }
      }
    }
  };
}
