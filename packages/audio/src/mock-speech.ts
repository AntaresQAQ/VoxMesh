import type {
  AudioData,
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptionResult
} from "./types.js";

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
  public async transcribe(audio: AudioData): Promise<TranscriptionResult> {
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
  public async synthesize(text: string): Promise<AudioData> {
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

function createToneWav(durationSeconds: number): Uint8Array {
  const sampleCount = Math.floor(SAMPLE_RATE * durationSeconds);
  const dataSize = sampleCount * (BITS_PER_SAMPLE / 8);
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);

  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE) * 0.12;
    view.setInt16(44 + index * 2, Math.round(sample * 32_767), true);
  }
  return bytes;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}
