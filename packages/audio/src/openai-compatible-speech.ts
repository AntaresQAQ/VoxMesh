import type {
  AudioData,
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptionResult
} from "./types.js";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

interface CompatibleSpeechBaseConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface OpenAiCompatibleSttConfig extends CompatibleSpeechBaseConfig {
  language: string;
}

export interface OpenAiCompatibleTtsConfig extends CompatibleSpeechBaseConfig {
  voice: string;
  instructions: string;
}

/** Standard OpenAI-compatible multipart transcription adapter. */
export class OpenAiCompatibleSpeechToTextProvider implements SpeechToTextProvider {
  public constructor(
    private readonly config: OpenAiCompatibleSttConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public async transcribe(
    audio: AudioData,
    options?: { signal?: AbortSignal }
  ): Promise<TranscriptionResult> {
    if (audio.data.byteLength === 0) {
      throw new Error("Audio input must not be empty");
    }
    const buffer = new ArrayBuffer(audio.data.byteLength);
    new Uint8Array(buffer).set(audio.data);
    const form = new FormData();
    form.append(
      "file",
      new Blob([buffer], { type: audio.mimeType }),
      fileNameFor(audio.mimeType)
    );
    form.append("model", this.config.model);
    if (this.config.language) form.append("language", this.config.language);
    const response = await this.fetcher(
      `${baseUrl(this.config.baseUrl)}/audio/transcriptions`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: requestSignal(options?.signal, this.config.timeoutMs)
      }
    );
    if (!response.ok) {
      throw await providerError("transcription", response);
    }
    const body = (await response.json()) as { text?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) {
      throw new Error("OpenAI-compatible transcription returned empty text");
    }
    return {
      text: body.text,
      language: this.config.language || "unknown"
    };
  }
}

/** Standard OpenAI-compatible non-streaming speech synthesis adapter. */
export class OpenAiCompatibleTextToSpeechProvider implements TextToSpeechProvider {
  public constructor(
    private readonly config: OpenAiCompatibleTtsConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public async synthesize(
    text: string,
    options?: { signal?: AbortSignal }
  ): Promise<AudioData> {
    if (!text.trim()) {
      throw new Error("Text-to-speech input must not be empty");
    }
    const response = await this.fetcher(
      `${baseUrl(this.config.baseUrl)}/audio/speech`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.model,
          input: text,
          voice: this.config.voice,
          instructions: this.config.instructions,
          response_format: "wav"
        }),
        signal: requestSignal(options?.signal, this.config.timeoutMs)
      }
    );
    if (!response.ok) {
      throw await providerError("speech synthesis", response);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength === 0) {
      throw new Error(
        "OpenAI-compatible speech synthesis returned empty audio"
      );
    }
    return {
      data,
      mimeType: response.headers.get("content-type") ?? "audio/wav"
    };
  }
}

function fileNameFor(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("wav")) return "recording.wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3"))
    return "recording.mp3";
  if (normalized.includes("ogg")) return "recording.ogg";
  return "recording.webm";
}

function requestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs ?? 30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function baseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function providerError(
  operation: string,
  response: Response
): Promise<Error> {
  const detail = (await response.text()).slice(0, 500);
  return new Error(
    `OpenAI-compatible ${operation} failed (${response.status})${
      detail ? `: ${detail}` : ""
    }`
  );
}
