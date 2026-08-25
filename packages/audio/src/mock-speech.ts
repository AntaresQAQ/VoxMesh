import type {
  AudioData,
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptionResult
} from "./types.js";
import { encodePcm16Wav } from "./pcm-wav.js";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Deterministic STT used by Mock Mode and offline tests.
 *
 * The provider validates that audio exists but intentionally does not inspect
 * speech content. Its fixed transcript drives the Mock MCP tool path.
 */
export class MockSpeechToTextProvider implements SpeechToTextProvider {
  public async transcribe(
    audio: AudioData,
    options?: { signal?: AbortSignal }
  ): Promise<TranscriptionResult> {
    throwIfAborted(options?.signal);
    if (audio.data.byteLength === 0) {
      throw new Error("Audio input must not be empty");
    }
    if (audio.data.byteLength > MAX_AUDIO_BYTES) {
      throw new Error("Audio input exceeds the 5 MB Mock Mode limit");
    }
    return {
      text: "Check the light status",
      language: "en"
    };
  }
}

/**
 * Produces a short valid WAV tone so browser playback can be tested offline.
 */
export class MockTextToSpeechProvider implements TextToSpeechProvider {
  public async synthesize(
    text: string,
    options?: { signal?: AbortSignal }
  ): Promise<AudioData> {
    throwIfAborted(options?.signal);
    if (!text.trim()) {
      throw new Error("Text-to-speech input must not be empty");
    }

    return {
      data: createToneWav(Math.min(0.8, 0.25 + text.length / 500)),
      mimeType: "audio/wav",
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS
    };
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Speech operation was aborted", "AbortError");
  }
}

function createToneWav(durationSeconds: number): Uint8Array {
  const sampleCount = Math.floor(SAMPLE_RATE * durationSeconds);
  const pcm = new Uint8Array(sampleCount * (BITS_PER_SAMPLE / 8));
  const view = new DataView(pcm.buffer);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE) * 0.12;
    view.setInt16(index * 2, Math.round(sample * 32_767), true);
  }
  return encodePcm16Wav({ channels: CHANNELS, sampleRate: SAMPLE_RATE, pcm });
}
