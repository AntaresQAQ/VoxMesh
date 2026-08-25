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

export interface AzureOpenAiSpeechBaseConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface AzureOpenAiSttConfig extends AzureOpenAiSpeechBaseConfig {
  language: string;
}

export interface AzureOpenAiTtsConfig extends AzureOpenAiSpeechBaseConfig {
  voice: string;
  instructions: string;
}

/**
 * Non-streaming Azure OpenAI transcription adapter.
 *
 * Audio is sent as multipart form data to the configured deployment. The
 * adapter returns only provider-independent transcript data.
 */
export class AzureOpenAiSpeechToTextProvider implements SpeechToTextProvider {
  public constructor(
    private readonly config: AzureOpenAiSttConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public async transcribe(
    audio: AudioData,
    options?: { signal?: AbortSignal }
  ): Promise<TranscriptionResult> {
    if (audio.data.byteLength === 0) {
      throw new Error("Audio input must not be empty");
    }
    const form = new FormData();
    const audioBuffer = new ArrayBuffer(audio.data.byteLength);
    new Uint8Array(audioBuffer).set(audio.data);
    form.append(
      "file",
      new Blob([audioBuffer], { type: audio.mimeType }),
      fileNameFor(audio.mimeType)
    );
    form.append("model", this.config.deployment);
    if (this.config.language) {
      form.append("language", this.config.language);
    }
    const response = await this.fetcher(
      endpoint(this.config, "audio/transcriptions"),
      {
        method: "POST",
        headers: { "api-key": this.config.apiKey },
        body: form,
        signal: requestSignal(options?.signal, this.config.timeoutMs)
      }
    );
    if (!response.ok) {
      throw await providerError("transcription", response);
    }
    const body = (await response.json()) as { text?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) {
      throw new Error("Azure OpenAI transcription returned empty text");
    }
    return {
      text: body.text,
      language: this.config.language || "unknown"
    };
  }
}

/** Non-streaming Azure OpenAI TTS adapter that requests WAV output. */
export class AzureOpenAiTextToSpeechProvider implements TextToSpeechProvider {
  public constructor(
    private readonly config: AzureOpenAiTtsConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public async synthesize(
    text: string,
    options?: { signal?: AbortSignal }
  ): Promise<AudioData> {
    if (!text.trim()) {
      throw new Error("Text-to-speech input must not be empty");
    }
    const response = await this.fetcher(endpoint(this.config, "audio/speech"), {
      method: "POST",
      headers: {
        "api-key": this.config.apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.deployment,
        input: text,
        voice: this.config.voice,
        instructions: this.config.instructions,
        response_format: "wav"
      }),
      signal: requestSignal(options?.signal, this.config.timeoutMs)
    });
    if (!response.ok) {
      throw await providerError("speech synthesis", response);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("Azure OpenAI speech synthesis returned empty audio");
    }
    return {
      data: bytes,
      mimeType: response.headers.get("content-type") ?? "audio/wav"
    };
  }
}

function requestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs ?? 30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function endpoint(
  config: AzureOpenAiSpeechBaseConfig,
  operation: string
): string {
  const base = config.endpoint.replace(/\/+$/, "");
  return `${base}/openai/deployments/${encodeURIComponent(
    config.deployment
  )}/${operation}?api-version=${encodeURIComponent(config.apiVersion)}`;
}

function fileNameFor(mimeType: string): string {
  if (mimeType.includes("wav")) return "recording.wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3"))
    return "recording.mp3";
  if (mimeType.includes("ogg")) return "recording.ogg";
  return "recording.webm";
}

async function providerError(
  operation: string,
  response: Response
): Promise<Error> {
  const detail = (await response.text()).slice(0, 500);
  return new Error(
    `Azure OpenAI ${operation} failed (${response.status})${
      detail ? `: ${detail}` : ""
    }`
  );
}
