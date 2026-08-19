// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { decodePcm16Wav } from "@voxmesh/audio/pcm-wav";

import { normalizeBrowserRecording } from "./browser-audio.js";

describe("browser audio normalization", () => {
  it("downmixes and resamples decoded browser audio to mono PCM16 WAV", async () => {
    const close = vi.fn(async () => undefined);
    const result = await normalizeBrowserRecording(
      new Blob(["browser recording"], { type: "audio/webm" }),
      () => ({
        decodeAudioData: vi.fn(async () => ({
          numberOfChannels: 2,
          sampleRate: 8_000,
          length: 2,
          getChannelData: (channel: number) =>
            channel === 0 ? new Float32Array([1, -1]) : new Float32Array([0, 0])
        })),
        close
      })
    );

    expect(result.type).toBe("audio/wav");
    const wav = decodePcm16Wav(new Uint8Array(await readBlob(result)));
    expect(wav.channels).toBe(1);
    expect(wav.sampleRate).toBe(16_000);
    expect(wav.pcm.byteLength).toBe(8);
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports decode failures and closes the audio context", async () => {
    const close = vi.fn(async () => undefined);

    await expect(
      normalizeBrowserRecording(new Blob(["invalid"]), () => ({
        decodeAudioData: vi.fn(async () => {
          throw new Error("unsupported recording");
        }),
        close
      }))
    ).rejects.toThrow(
      "Browser audio normalization failed: unsupported recording"
    );
    expect(close).toHaveBeenCalledOnce();
  });
});

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("Expected an ArrayBuffer"));
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Failed to read Blob"))
    );
    reader.readAsArrayBuffer(blob);
  });
}
