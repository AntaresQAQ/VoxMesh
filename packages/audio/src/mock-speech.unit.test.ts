import { describe, expect, it } from "vitest";

import {
  MockSpeechToTextProvider,
  MockTextToSpeechProvider
} from "./mock-speech.js";

describe("Mock speech providers", () => {
  it("returns a deterministic transcript for non-empty audio", async () => {
    const provider = new MockSpeechToTextProvider();

    await expect(
      provider.transcribe({
        data: new Uint8Array([1, 2, 3]),
        mimeType: "audio/webm"
      })
    ).resolves.toEqual({
      text: "Check the light status",
      language: "en"
    });
  });

  it("rejects empty audio", async () => {
    const provider = new MockSpeechToTextProvider();

    await expect(
      provider.transcribe({
        data: new Uint8Array(),
        mimeType: "audio/webm"
      })
    ).rejects.toThrow("Audio input must not be empty");
  });

  it("produces a valid PCM WAV response", async () => {
    const provider = new MockTextToSpeechProvider();
    const result = await provider.synthesize("Test response");

    expect(result.mimeType).toBe("audio/wav");
    expect(new TextDecoder().decode(result.data.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(result.data.slice(8, 12))).toBe("WAVE");
    expect(result.data.byteLength).toBeGreaterThan(44);
  });
});
