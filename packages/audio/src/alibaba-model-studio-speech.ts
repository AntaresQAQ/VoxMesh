import WebSocket, { type ClientOptions, type RawData } from "ws";

import { decodePcm16Wav, encodePcm16Wav } from "./pcm-wav.js";
import type {
  AudioData,
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptionResult
} from "./types.js";

const AUDIO_CHUNK_BYTES = 3_200;
const DEFAULT_TIMEOUT_MS = 30_000;
const TTS_SAMPLE_RATE = 24_000;

export interface AlibabaModelStudioSttConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  language: string;
  timeoutMs?: number;
}

export interface AlibabaModelStudioTtsConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  voice: string;
  instructions: string;
  timeoutMs?: number;
}

export type AlibabaWebSocketFactory = (
  url: string,
  options: ClientOptions
) => AlibabaWebSocket;

export interface AlibabaWebSocket {
  on(event: "open", listener: () => void): this;
  on(
    event: "message",
    listener: (data: RawData, isBinary: boolean) => void
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number, reason: Buffer) => void): this;
  send(data: string | Uint8Array): void;
  close(): void;
}

const defaultWebSocketFactory: AlibabaWebSocketFactory = (url, options) =>
  new WebSocket(url, options);

/** Alibaba Model Studio Fun-ASR WebSocket adapter for buffered PCM WAV input. */
export class AlibabaModelStudioSpeechToTextProvider implements SpeechToTextProvider {
  public constructor(
    private readonly config: AlibabaModelStudioSttConfig,
    private readonly createSocket: AlibabaWebSocketFactory = defaultWebSocketFactory
  ) {}

  public async transcribe(audio: AudioData): Promise<TranscriptionResult> {
    if (audio.data.byteLength === 0) {
      throw new Error("Audio input must not be empty");
    }
    if (audio.mimeType !== "audio/wav" && audio.mimeType !== "audio/x-wav") {
      throw new Error("Alibaba Model Studio STT requires mono PCM16 WAV audio");
    }
    const wav = decodePcm16Wav(audio.data);
    const transcripts: string[] = [];

    await runAlibabaTask({
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
      ...(this.config.timeoutMs === undefined
        ? {}
        : { timeoutMs: this.config.timeoutMs }),
      createSocket: this.createSocket,
      createRunTask: (taskId) => ({
        header: taskHeader("run-task", taskId),
        payload: {
          task_group: "audio",
          task: "asr",
          function: "recognition",
          model: this.config.model,
          parameters: {
            format: "pcm",
            sample_rate: wav.sampleRate,
            ...(this.config.language
              ? { language_hints: [this.config.language] }
              : {})
          },
          input: {}
        }
      }),
      onStarted: (socket, taskId) => {
        for (
          let offset = 0;
          offset < wav.pcm.byteLength;
          offset += AUDIO_CHUNK_BYTES
        ) {
          socket.send(wav.pcm.slice(offset, offset + AUDIO_CHUNK_BYTES));
        }
        socket.send(
          JSON.stringify({
            header: taskHeader("finish-task", taskId),
            payload: { input: {} }
          })
        );
      },
      onEvent: (event) => {
        if (event.header.event !== "result-generated") return;
        const sentence = readObject(
          readObject(readObject(event.payload, "output"), "sentence")
        );
        if (
          sentence.sentence_end === true &&
          typeof sentence.text === "string" &&
          sentence.text.trim()
        ) {
          transcripts.push(sentence.text.trim());
        }
      }
    });

    const text = transcripts.join(" ").trim();
    if (!text) {
      throw new Error("Alibaba Model Studio STT returned empty text");
    }
    return { text, language: this.config.language || "unknown" };
  }
}

/** Alibaba Model Studio Qwen-Audio-TTS/CosyVoice WebSocket adapter. */
export class AlibabaModelStudioTextToSpeechProvider implements TextToSpeechProvider {
  public constructor(
    private readonly config: AlibabaModelStudioTtsConfig,
    private readonly createSocket: AlibabaWebSocketFactory = defaultWebSocketFactory
  ) {}

  public async synthesize(text: string): Promise<AudioData> {
    if (!text.trim()) {
      throw new Error("Text-to-speech input must not be empty");
    }
    const audioChunks: Uint8Array[] = [];

    await runAlibabaTask({
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
      ...(this.config.timeoutMs === undefined
        ? {}
        : { timeoutMs: this.config.timeoutMs }),
      createSocket: this.createSocket,
      createRunTask: (taskId) => ({
        header: taskHeader("run-task", taskId),
        payload: {
          task_group: "audio",
          task: "tts",
          function: "SpeechSynthesizer",
          model: this.config.model,
          parameters: {
            text_type: "PlainText",
            voice: this.config.voice,
            format: "pcm",
            sample_rate: TTS_SAMPLE_RATE,
            volume: 50,
            rate: 1,
            pitch: 1,
            ...(this.config.instructions
              ? { instruction: this.config.instructions }
              : {})
          },
          input: {}
        }
      }),
      onStarted: (socket, taskId) => {
        socket.send(
          JSON.stringify({
            header: taskHeader("continue-task", taskId),
            payload: { input: { text } }
          })
        );
        socket.send(
          JSON.stringify({
            header: taskHeader("finish-task", taskId),
            payload: { input: {} }
          })
        );
      },
      onBinary: (data) => audioChunks.push(data)
    });

    const pcm = concatenate(audioChunks);
    if (pcm.byteLength === 0) {
      throw new Error("Alibaba Model Studio TTS returned empty audio");
    }
    return {
      data: encodePcm16Wav({
        channels: 1,
        sampleRate: TTS_SAMPLE_RATE,
        pcm
      }),
      mimeType: "audio/wav",
      sampleRate: TTS_SAMPLE_RATE,
      channels: 1
    };
  }
}

interface AlibabaEvent {
  header: {
    event: string;
    error_code?: string;
    error_message?: string;
  };
  payload: Record<string, unknown>;
}

async function runAlibabaTask(input: {
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
  createSocket: AlibabaWebSocketFactory;
  createRunTask: (taskId: string) => Record<string, unknown>;
  onStarted: (socket: AlibabaWebSocket, taskId: string) => void;
  onEvent?: (event: AlibabaEvent) => void;
  onBinary?: (data: Uint8Array) => void;
}): Promise<void> {
  const taskId = crypto.randomUUID();
  const socket = input.createSocket(input.endpoint, {
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "User-Agent": "VoxMesh"
    }
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error("Alibaba Model Studio speech request timed out")),
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else resolve();
    };

    socket.on("open", () => {
      try {
        socket.send(JSON.stringify(input.createRunTask(taskId)));
      } catch (error) {
        finish(normalizeError("failed to start", error));
      }
    });
    socket.on("message", (data, isBinary) => {
      try {
        if (isBinary) {
          input.onBinary?.(rawDataToBytes(data));
          return;
        }
        const event = parseEvent(rawDataToText(data));
        if (event.header.event === "task-started") {
          input.onStarted(socket, taskId);
        } else if (event.header.event === "task-failed") {
          finish(
            new Error(
              `Alibaba Model Studio task failed${
                event.header.error_code ? ` (${event.header.error_code})` : ""
              }${
                event.header.error_message
                  ? `: ${event.header.error_message}`
                  : ""
              }`
            )
          );
        } else if (event.header.event === "task-finished") {
          finish();
        } else {
          input.onEvent?.(event);
        }
      } catch (error) {
        finish(normalizeError("returned an invalid response", error));
      }
    });
    socket.on("error", (error) => {
      finish(normalizeError("WebSocket failed", error));
    });
    socket.on("close", (code, reason) => {
      if (!settled) {
        const detail = reason.toString().trim();
        finish(
          new Error(
            `Alibaba Model Studio WebSocket closed before completion (${code})${
              detail ? `: ${detail}` : ""
            }`
          )
        );
      }
    });
  });
}

function taskHeader(action: string, taskId: string) {
  return {
    action,
    task_id: taskId,
    streaming: "duplex"
  };
}

function parseEvent(value: string): AlibabaEvent {
  const parsed: unknown = JSON.parse(value);
  const root = readObject(parsed);
  const header = readObject(root, "header");
  const event = header.event;
  if (typeof event !== "string") {
    throw new Error("Alibaba event header requires an event name");
  }
  return {
    header: {
      event,
      ...(typeof header.error_code === "string"
        ? { error_code: header.error_code }
        : {}),
      ...(typeof header.error_message === "string"
        ? { error_message: header.error_message }
        : {})
    },
    payload: readObject(root.payload)
  };
}

function readObject(value: unknown, key?: string): Record<string, unknown> {
  const target =
    key === undefined && value !== null && typeof value === "object"
      ? value
      : value !== null && typeof value === "object" && key
        ? (value as Record<string, unknown>)[key]
        : undefined;
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    throw new Error(
      key ? `Alibaba response requires ${key}` : "Alibaba response must be JSON"
    );
  }
  return target as Record<string, unknown>;
}

function rawDataToText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
    "utf8"
  );
}

function rawDataToBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  );
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function normalizeError(operation: string, error: unknown): Error {
  return new Error(
    `Alibaba Model Studio ${operation}: ${
      error instanceof Error ? error.message : "unknown error"
    }`
  );
}
