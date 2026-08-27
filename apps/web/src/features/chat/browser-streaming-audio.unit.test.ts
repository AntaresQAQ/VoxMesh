// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserStreamingAudioCapture,
  BrowserStreamingAudioPlayback,
  StreamingPcm16Resampler,
  supportsBrowserStreamingVoice
} from "./browser-streaming-audio.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser streaming audio", () => {
  it("resamples across callback boundaries into exact 20 ms PCM frames", () => {
    const samples = Float32Array.from(
      { length: 960 },
      (_, index) => Math.sin(index / 20) * 0.5
    );
    const contiguous = new StreamingPcm16Resampler(48_000, 16_000, 320);
    const split = new StreamingPcm16Resampler(48_000, 16_000, 320);
    const expected = contiguous.push(samples);
    const actual = [
      ...split.push(samples.slice(0, 137)),
      ...split.push(samples.slice(137, 348)),
      ...split.push(samples.slice(348))
    ];

    expect(expected).toHaveLength(1);
    expect(actual).toEqual(expected);
    const frame = actual[0];
    if (!frame) throw new Error("Expected one resampled frame");
    expect(frame).toHaveLength(640);
  });

  it("reports unsupported browsers without AudioWorkletNode", () => {
    vi.stubGlobal("AudioWorkletNode", undefined);
    vi.stubGlobal("WebSocket", class {});
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });

    expect(supportsBrowserStreamingVoice()).toBe(false);
  });

  it("reports unsupported browsers without AudioContext", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("AudioWorkletNode", class {});
    vi.stubGlobal("WebSocket", class {});
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });

    expect(supportsBrowserStreamingVoice()).toBe(false);
  });

  it("rejects playback when AudioContext is present but not constructible", async () => {
    vi.stubGlobal("AudioContext", {});
    const playback = new BrowserStreamingAudioPlayback();

    await expect(
      playback.enqueue({
        sequence: 1,
        format: {
          encoding: "pcm16le",
          sampleRate: 16_000,
          channels: 1
        },
        data: new Uint8Array(640)
      })
    ).rejects.toThrow("Browser streaming playback is not supported");
  });

  it("releases tracks, graph, context, and module URL on finish", async () => {
    const stop = vi.fn();
    const disconnectSource = vi.fn();
    const disconnectWorklet = vi.fn();
    const close = vi.fn(async () => undefined);
    const revokeObjectURL = vi.fn();
    const source = {
      connect: vi.fn(),
      disconnect: disconnectSource
    };
    const port = {
      onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null,
      postMessage: vi.fn()
    };
    const context = {
      sampleRate: 48_000,
      state: "running",
      destination: {},
      audioWorklet: { addModule: vi.fn(async () => undefined) },
      resume: vi.fn(async () => undefined),
      close,
      createMediaStreamSource: vi.fn(() => source)
    };
    class FakeWorklet {
      public readonly port = port;
      public disconnect = disconnectWorklet;
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop }]
        }))
      }
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        public constructor() {
          return context;
        }
      }
    );
    vi.stubGlobal("AudioWorkletNode", FakeWorklet);
    vi.stubGlobal("WebSocket", class {});
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:worklet"),
      revokeObjectURL
    });
    const capture = new BrowserStreamingAudioCapture();

    await capture.start({
      onChunk: vi.fn(),
      onLevel: vi.fn()
    });
    await capture.finish();

    expect(stop).toHaveBeenCalledOnce();
    expect(disconnectSource).toHaveBeenCalledOnce();
    expect(disconnectWorklet).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:worklet");
    expect(port.onmessage).toBeNull();
  });

  it("cleans up when the AudioWorklet module cannot start", async () => {
    const stop = vi.fn();
    const closeError = new Error("Context close failed");
    const close = vi.fn(async () => {
      throw closeError;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // Expected cleanup diagnostic.
    });
    const revokeObjectURL = vi.fn();
    const context = {
      sampleRate: 48_000,
      state: "running",
      destination: {},
      audioWorklet: {
        addModule: vi.fn(async () => {
          throw new Error("Worklet module failed");
        })
      },
      resume: vi.fn(async () => undefined),
      close,
      createMediaStreamSource: vi.fn()
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop }]
        }))
      }
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        public constructor() {
          return context;
        }
      }
    );
    vi.stubGlobal("AudioWorkletNode", class {});
    vi.stubGlobal("WebSocket", class {});
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:worklet"),
      revokeObjectURL
    });
    const capture = new BrowserStreamingAudioCapture();

    await expect(
      capture.start({ onChunk: vi.fn(), onLevel: vi.fn() })
    ).rejects.toThrow("Worklet module failed");

    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:worklet");
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to close streaming audio context after startup failure",
      closeError
    );
  });

  it("stops the microphone when AudioContext construction fails", async () => {
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop }]
        }))
      }
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        public constructor() {
          throw new Error("Audio context construction failed");
        }
      }
    );
    vi.stubGlobal("AudioWorkletNode", class {});
    vi.stubGlobal("WebSocket", class {});
    const capture = new BrowserStreamingAudioCapture();

    await expect(
      capture.start({ onChunk: vi.fn(), onLevel: vi.fn() })
    ).rejects.toThrow("Audio context construction failed");

    expect(stop).toHaveBeenCalledOnce();
  });

  it("closes the context and microphone when module URL creation fails", async () => {
    const stop = vi.fn();
    const close = vi.fn(async () => undefined);
    const context = {
      state: "running",
      close
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop }]
        }))
      }
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        public constructor() {
          return context;
        }
      }
    );
    vi.stubGlobal("AudioWorkletNode", class {});
    vi.stubGlobal("WebSocket", class {});
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        throw new Error("Module URL creation failed");
      }),
      revokeObjectURL: vi.fn()
    });
    const capture = new BrowserStreamingAudioCapture();

    await expect(
      capture.start({ onChunk: vi.fn(), onLevel: vi.fn() })
    ).rejects.toThrow("Module URL creation failed");

    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("cleans up when capture is cancelled during worklet startup", async () => {
    let resolveModule: () => void = () => undefined;
    const stop = vi.fn();
    const close = vi.fn(async () => undefined);
    const revokeObjectURL = vi.fn();
    const addModule = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveModule = resolve;
        })
    );
    const context = {
      sampleRate: 48_000,
      state: "running",
      destination: {},
      audioWorklet: { addModule },
      resume: vi.fn(async () => undefined),
      close,
      createMediaStreamSource: vi.fn()
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop }]
        }))
      }
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        public constructor() {
          return context;
        }
      }
    );
    vi.stubGlobal("AudioWorkletNode", class {});
    vi.stubGlobal("WebSocket", class {});
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:worklet"),
      revokeObjectURL
    });
    const capture = new BrowserStreamingAudioCapture();
    const started = capture.start({
      onChunk: vi.fn(),
      onLevel: vi.fn()
    });
    await vi.waitFor(() => expect(addModule).toHaveBeenCalledOnce());

    capture.cancel();
    resolveModule();

    await expect(started).rejects.toThrow(
      "Streaming audio capture was cancelled"
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:worklet");
    expect(context.createMediaStreamSource).not.toHaveBeenCalled();
  });

  it("schedules ordered playback and closes the context after audio ends", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const close = vi.fn(async () => undefined);
    class FakeSource extends EventTarget {
      public buffer: unknown;
      public connect = vi.fn();
      public disconnect = vi.fn();
      public stop = vi.fn();
      public start = vi.fn((time: number) => starts.push(time));
    }
    const context = {
      currentTime: 0,
      state: "running",
      destination: {},
      resume: vi.fn(async () => undefined),
      close,
      createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
      createBufferSource: vi.fn(() => new FakeSource())
    };
    vi.stubGlobal(
      "AudioContext",
      class {
        public constructor() {
          return context;
        }
      }
    );
    const playback = new BrowserStreamingAudioPlayback();
    const frame = (sequence: number) => ({
      sequence,
      format: { encoding: "pcm16le" as const, sampleRate: 16_000, channels: 1 },
      data: new Uint8Array(640)
    });

    await playback.enqueue(frame(1));
    await playback.enqueue(frame(2));
    const finished = playback.finish();
    await vi.advanceTimersByTimeAsync(40);
    await finished;

    expect(starts).toEqual([0, 0.02]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not advance playback state when the audio context cannot resume", async () => {
    class FakeSource extends EventTarget {
      public buffer: unknown;
      public connect = vi.fn();
      public disconnect = vi.fn();
      public start = vi.fn();
    }
    const resume = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Audio context blocked"))
      .mockResolvedValue(undefined);
    const context = {
      currentTime: 0,
      state: "running",
      destination: {},
      resume,
      close: vi.fn(async () => undefined),
      createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
      createBufferSource: vi.fn(() => new FakeSource())
    };
    vi.stubGlobal(
      "AudioContext",
      class {
        public constructor() {
          return context;
        }
      }
    );
    const playback = new BrowserStreamingAudioPlayback();
    const firstFrame = {
      sequence: 1,
      format: { encoding: "pcm16le" as const, sampleRate: 16_000, channels: 1 },
      data: new Uint8Array(640)
    };

    await expect(playback.enqueue(firstFrame)).rejects.toThrow(
      "Audio context blocked"
    );
    await expect(playback.enqueue(firstFrame)).resolves.toBeUndefined();

    expect(resume).toHaveBeenCalledTimes(2);
    expect(context.createBufferSource).toHaveBeenCalledOnce();
    playback.cancel();
  });

  it("rejects output that exceeds the bounded playback queue", async () => {
    vi.stubGlobal("AudioContext", class {});
    const playback = new BrowserStreamingAudioPlayback();

    await expect(
      playback.enqueue({
        sequence: 1,
        format: {
          encoding: "pcm16le",
          sampleRate: 16_000,
          channels: 1
        },
        data: new Uint8Array(2 * 1024 * 1024 + 2)
      })
    ).rejects.toThrow("queue limit");
  });
});
