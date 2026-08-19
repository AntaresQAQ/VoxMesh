import { describe, expect, it } from "vitest";

import { decodePcm16Wav, encodePcm16Wav } from "./pcm-wav.js";

describe("PCM WAV helpers", () => {
  it("round-trips PCM16 audio", () => {
    const input = {
      channels: 1,
      sampleRate: 16_000,
      pcm: new Uint8Array([0, 0, 255, 127, 0, 128])
    };

    expect(decodePcm16Wav(encodePcm16Wav(input))).toEqual(input);
  });

  it("rejects non-WAV and non-mono audio", () => {
    expect(() => decodePcm16Wav(new Uint8Array([1, 2, 3]))).toThrow(
      "Audio must be a valid RIFF/WAVE file"
    );
    expect(() =>
      encodePcm16Wav({
        channels: 0,
        sampleRate: 16_000,
        pcm: new Uint8Array([0, 0])
      })
    ).toThrow("PCM WAV channels must be a positive integer");
  });
});
