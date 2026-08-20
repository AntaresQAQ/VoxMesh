// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { decodePcm16Wav } from "@voxmesh/audio/pcm-wav";

import {
  BrowserAudioRecorder,
  normalizeBrowserRecording,
  rmsToLoudnessPercent
} from "./browser-audio.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser audio normalization", () => {
  it("maps microphone RMS onto a bounded loudness percentage", () => {
    expect(rmsToLoudnessPercent(new Float32Array([0, 0]))).toBe(0);
    expect(rmsToLoudnessPercent(new Float32Array([0.1, -0.1]))).toBe(67);
    expect(rmsToLoudnessPercent(new Float32Array([1, -1]))).toBe(100);
  });

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

  it("stops a microphone stream acquired after recording was cancelled", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }]
    } as unknown as MediaStream;
    vi.stubGlobal(
      "MediaRecorder",
      class {
        public state = "inactive";
      }
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            resolveStream = resolve;
          })
      }
    });
    const recorder = new BrowserAudioRecorder();

    const started = recorder.start();
    recorder.cancel();
    resolveStream?.(stream);

    await expect(started).rejects.toThrow("Audio recording was cancelled");
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops the microphone when MediaRecorder construction fails", async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }]
    } as unknown as MediaStream;
    vi.stubGlobal(
      "MediaRecorder",
      class {
        public constructor() {
          throw new Error("unsupported stream");
        }
      }
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => stream)
      }
    });

    await expect(new BrowserAudioRecorder().start()).rejects.toThrow(
      "unsupported stream"
    );
    expect(stop).toHaveBeenCalledOnce();
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
