import { decodePcm16Wav, encodePcm16Wav } from "./pcm-wav.js";
import type {
  AudioData,
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptionResult
} from "./types.js";
import {
  validateAlibabaModelStudioSttConfiguration,
  validateAlibabaModelStudioTtsConfiguration
} from "./alibaba-model-studio-config.js";
import {
  alibabaRawDataToBytes,
  alibabaRawDataToText,
  alibabaTaskHeader,
  createAlibabaWebSocket,
  defaultAlibabaWebSocketFactory,
  normalizeAlibabaError,
  parseAlibabaEvent,
  readAlibabaObject,
  throwIfSpeechAborted,
  type AlibabaEvent,
  type AlibabaWebSocket,
  type AlibabaWebSocketFactory
} from "./alibaba-model-studio-websocket.js";

export type {
  AlibabaWebSocket,
  AlibabaWebSocketFactory
} from "./alibaba-model-studio-websocket.js";

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

/** Alibaba Model Studio Fun-ASR WebSocket adapter for buffered PCM WAV input. */
export class AlibabaModelStudioSpeechToTextProvider implements SpeechToTextProvider {
  public constructor(
    private readonly config: AlibabaModelStudioSttConfig,
    private readonly createSocket: AlibabaWebSocketFactory = defaultAlibabaWebSocketFactory
  ) {
    validateAlibabaModelStudioSttConfiguration({
      endpoint: config.endpoint,
      apiKeyConfigured: Boolean(config.apiKey),
      model: config.model
    });
  }

  public async transcribe(
    audio: AudioData,
    options?: { signal?: AbortSignal }
  ): Promise<TranscriptionResult> {
    throwIfSpeechAborted(options?.signal);
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
      ...(options?.signal ? { signal: options.signal } : {}),
      createRunTask: (taskId) => ({
        header: alibabaTaskHeader("run-task", taskId),
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
            header: alibabaTaskHeader("finish-task", taskId),
            payload: { input: {} }
          })
        );
      },
      onEvent: (event) => {
        if (event.header.event !== "result-generated") return;
        const sentence = readAlibabaObject(
          readAlibabaObject(
            readAlibabaObject(event.payload, "output"),
            "sentence"
          )
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
    private readonly createSocket: AlibabaWebSocketFactory = defaultAlibabaWebSocketFactory
  ) {
    validateAlibabaModelStudioTtsConfiguration({
      endpoint: config.endpoint,
      apiKeyConfigured: Boolean(config.apiKey),
      model: config.model,
      voice: config.voice
    });
  }

  public async synthesize(
    text: string,
    options?: { signal?: AbortSignal }
  ): Promise<AudioData> {
    throwIfSpeechAborted(options?.signal);
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
      ...(options?.signal ? { signal: options.signal } : {}),
      createRunTask: (taskId) => ({
        header: alibabaTaskHeader("run-task", taskId),
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
            header: alibabaTaskHeader("continue-task", taskId),
            payload: { input: { text } }
          })
        );
        socket.send(
          JSON.stringify({
            header: alibabaTaskHeader("finish-task", taskId),
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

async function runAlibabaTask(input: {
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
  createSocket: AlibabaWebSocketFactory;
  signal?: AbortSignal;
  createRunTask: (taskId: string) => Record<string, unknown>;
  onStarted: (socket: AlibabaWebSocket, taskId: string) => void;
  onEvent?: (event: AlibabaEvent) => void;
  onBinary?: (data: Uint8Array) => void;
}): Promise<void> {
  const taskId = crypto.randomUUID();
  const socket = createAlibabaWebSocket(
    input.createSocket,
    input.endpoint,
    input.apiKey
  );

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
      input.signal?.removeEventListener("abort", onAbort);
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () =>
      finish(new DOMException("Speech operation was aborted", "AbortError"));
    if (input.signal?.aborted) {
      onAbort();
      return;
    }
    input.signal?.addEventListener("abort", onAbort, { once: true });

    socket.on("open", () => {
      if (settled) return;
      try {
        socket.send(JSON.stringify(input.createRunTask(taskId)));
      } catch (error) {
        finish(normalizeAlibabaError("failed to start", error));
      }
    });
    socket.on("message", (data, isBinary) => {
      if (settled) return;
      try {
        if (isBinary) {
          input.onBinary?.(alibabaRawDataToBytes(data));
          return;
        }
        const event = parseAlibabaEvent(alibabaRawDataToText(data));
        if (event.header.event === "task-started") {
          input.onStarted(socket, taskId);
        } else if (event.header.event === "task-failed") {
          finish(
            new Error(
              `Alibaba Model Studio task failed${
                event.header.errorCode ? ` (${event.header.errorCode})` : ""
              }${
                event.header.errorMessage
                  ? `: ${event.header.errorMessage}`
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
        finish(normalizeAlibabaError("returned an invalid response", error));
      }
    });
    socket.on("error", (error) => {
      if (settled) return;
      finish(normalizeAlibabaError("WebSocket failed", error));
    });
    socket.on("close", (code, reason) => {
      if (settled) return;
      const detail = reason.toString().trim();
      finish(
        new Error(
          `Alibaba Model Studio WebSocket closed before completion (${code})${
            detail ? `: ${detail}` : ""
          }`
        )
      );
    });
  });
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
