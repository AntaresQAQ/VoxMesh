import type { StreamingAudioChunk, StreamingAudioFormat } from "@voxmesh/audio";
import { VOICE_STREAM_LIMITS } from "@voxmesh/shared";

const format: StreamingAudioFormat = {
  encoding: "pcm16le",
  sampleRate: VOICE_STREAM_LIMITS.inputSampleRate,
  channels: VOICE_STREAM_LIMITS.inputChannels
};
const frameSamples =
  (format.sampleRate * VOICE_STREAM_LIMITS.inputFrameDurationMs) / 1_000;

export interface StreamingAudioCapture {
  start(input: {
    onChunk: (chunk: StreamingAudioChunk) => void;
    onLevel: (level: number) => void;
  }): Promise<void>;
  finish(): Promise<void>;
  cancel(): void;
}

export interface StreamingAudioPlayback {
  enqueue(chunk: StreamingAudioChunk): Promise<void>;
  finish(): Promise<void>;
  cancel(): void;
}

/** Returns whether the browser exposes every API required for PCM streaming. */
export function supportsBrowserStreamingVoice(): boolean {
  return Boolean(
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof globalThis.AudioContext === "function" &&
    typeof globalThis.AudioWorkletNode === "function" &&
    typeof globalThis.WebSocket === "function"
  );
}

/**
 * Captures browser audio through one AudioWorklet and emits mono 16 kHz PCM.
 *
 * The same captured samples drive the microphone meter and transport frames.
 */
export class BrowserStreamingAudioCapture implements StreamingAudioCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private moduleUrl: string | null = null;
  private generation = 0;

  public async start(input: {
    onChunk: (chunk: StreamingAudioChunk) => void;
    onLevel: (level: number) => void;
  }): Promise<void> {
    if (!supportsBrowserStreamingVoice()) {
      throw new Error("Browser streaming audio is not supported");
    }
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    if (generation !== this.generation) {
      stopStream(stream);
      throw new Error("Streaming audio capture was cancelled");
    }
    const context = new AudioContext();
    const moduleUrl = URL.createObjectURL(
      new Blob([workletSource()], { type: "text/javascript" })
    );
    try {
      await context.audioWorklet.addModule(moduleUrl);
      await context.resume();
      if (generation !== this.generation) {
        throw new Error("Streaming audio capture was cancelled");
      }
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "voxmesh-pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1
      });
      const resampler = new StreamingPcm16Resampler(
        context.sampleRate,
        format.sampleRate,
        frameSamples
      );
      let sequence = 1;
      worklet.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!(event.data instanceof Float32Array)) return;
        input.onLevel(rmsToLoudness(event.data));
        for (const data of resampler.push(event.data)) {
          input.onChunk({ sequence, format, data });
          sequence += 1;
        }
      };
      source.connect(worklet);
      this.stream = stream;
      this.context = context;
      this.source = source;
      this.worklet = worklet;
      this.moduleUrl = moduleUrl;
    } catch (error) {
      stopStream(stream);
      URL.revokeObjectURL(moduleUrl);
      await context.close();
      throw error;
    }
  }

  public async finish(): Promise<void> {
    await this.release();
  }

  public cancel(): void {
    this.generation += 1;
    void this.release().catch((error: unknown) => {
      console.error("Failed to release streaming audio capture", error);
    });
  }

  private async release(): Promise<void> {
    const worklet = this.worklet;
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.port.postMessage({ type: "stop" });
      worklet.disconnect();
    }
    this.source?.disconnect();
    if (this.stream) stopStream(this.stream);
    if (this.moduleUrl) URL.revokeObjectURL(this.moduleUrl);
    const context = this.context;
    this.stream = null;
    this.context = null;
    this.source = null;
    this.worklet = null;
    this.moduleUrl = null;
    if (context && context.state !== "closed") await context.close();
  }
}

/** Schedules ordered PCM output while enforcing browser queue bounds. */
export class BrowserStreamingAudioPlayback implements StreamingAudioPlayback {
  private context: AudioContext | null = null;
  private nextStartTime = 0;
  private expectedSequence = 1;
  private queuedBytes = 0;
  private queuedDurationMs = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();

  public async enqueue(chunk: StreamingAudioChunk): Promise<void> {
    if (!globalThis.AudioContext) {
      throw new Error("Browser streaming playback is not supported");
    }
    validatePlaybackChunk(chunk, this.expectedSequence);
    const durationMs =
      (chunk.data.byteLength /
        (chunk.format.sampleRate * chunk.format.channels * 2)) *
      1_000;
    if (
      this.queuedBytes + chunk.data.byteLength >
        VOICE_STREAM_LIMITS.maxOutputQueueBytes ||
      this.queuedDurationMs + durationMs >
        VOICE_STREAM_LIMITS.maxOutputQueueDurationMs
    ) {
      throw new Error("Browser playback queue limit was exceeded");
    }
    this.expectedSequence += 1;
    this.queuedBytes += chunk.data.byteLength;
    this.queuedDurationMs += durationMs;
    const context = (this.context ??= new AudioContext());
    await context.resume();
    const samples = pcm16ToFloat32(chunk.data, chunk.format.channels);
    const buffer = context.createBuffer(
      chunk.format.channels,
      samples[0]?.length ?? 0,
      chunk.format.sampleRate
    );
    samples.forEach((channel, index) =>
      buffer.copyToChannel(new Float32Array(channel), index)
    );
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.sources.add(source);
    const startAt = Math.max(context.currentTime, this.nextStartTime);
    this.nextStartTime = startAt + durationMs / 1_000;
    source.addEventListener(
      "ended",
      () => {
        this.sources.delete(source);
        this.queuedBytes = Math.max(
          0,
          this.queuedBytes - chunk.data.byteLength
        );
        this.queuedDurationMs = Math.max(0, this.queuedDurationMs - durationMs);
      },
      { once: true }
    );
    source.start(startAt);
  }

  public async finish(): Promise<void> {
    const context = this.context;
    if (!context) return;
    const remainingMs = Math.max(
      0,
      (this.nextStartTime - context.currentTime) * 1_000
    );
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
    }
    await this.release();
  }

  public cancel(): void {
    void this.release().catch((error: unknown) => {
      console.error("Failed to release streaming audio playback", error);
    });
  }

  private async release(): Promise<void> {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Source already ended.
      }
      source.disconnect();
    }
    this.sources.clear();
    this.queuedBytes = 0;
    this.queuedDurationMs = 0;
    this.nextStartTime = 0;
    this.expectedSequence = 1;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") await context.close();
  }
}

export class StreamingPcm16Resampler {
  private readonly ratio: number;
  private pending: number[] = [];
  private outputPending: number[] = [];
  private sourcePosition = 0;

  public constructor(
    sourceSampleRate: number,
    targetSampleRate: number,
    private readonly outputFrameSamples: number
  ) {
    if (
      sourceSampleRate < 1 ||
      targetSampleRate < 1 ||
      !Number.isInteger(outputFrameSamples) ||
      outputFrameSamples < 1
    ) {
      throw new Error("Streaming resampler configuration is invalid");
    }
    this.ratio = sourceSampleRate / targetSampleRate;
  }

  public push(samples: Float32Array): Uint8Array[] {
    this.pending.push(...samples);
    const output: number[] = [];
    while (this.sourcePosition + 1 < this.pending.length) {
      const left = Math.floor(this.sourcePosition);
      const fraction = this.sourcePosition - left;
      const leftSample = this.pending[left] ?? 0;
      const rightSample = this.pending[left + 1] ?? leftSample;
      output.push(leftSample + (rightSample - leftSample) * fraction);
      this.sourcePosition += this.ratio;
    }
    const consumed = Math.min(
      Math.floor(this.sourcePosition),
      this.pending.length
    );
    if (consumed > 0) {
      this.pending = this.pending.slice(consumed);
      this.sourcePosition -= consumed;
    }
    this.outputPending.push(...output);
    const frames: Uint8Array[] = [];
    for (
      let offset = 0;
      offset + this.outputFrameSamples <= this.outputPending.length;
      offset += this.outputFrameSamples
    ) {
      frames.push(
        float32ToPcm16(
          this.outputPending.slice(offset, offset + this.outputFrameSamples)
        )
      );
    }
    this.outputPending = this.outputPending.slice(
      Math.floor(this.outputPending.length / this.outputFrameSamples) *
        this.outputFrameSamples
    );
    return frames;
  }
}

function float32ToPcm16(samples: readonly number[]): Uint8Array {
  const data = new Uint8Array(samples.length * 2);
  const view = new DataView(data.buffer);
  samples.forEach((sample, index) => {
    const normalized = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      index * 2,
      normalized < 0
        ? Math.round(normalized * 32_768)
        : Math.round(normalized * 32_767),
      true
    );
  });
  return data;
}

function pcm16ToFloat32(data: Uint8Array, channels: number): Float32Array[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const frameCount = data.byteLength / (channels * 2);
  const output = Array.from(
    { length: channels },
    () => new Float32Array(frameCount)
  );
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const target = output[channel];
      if (target) {
        target[frame] =
          view.getInt16((frame * channels + channel) * 2, true) / 32_768;
      }
    }
  }
  return output;
}

function validatePlaybackChunk(
  chunk: StreamingAudioChunk,
  sequence: number
): void {
  if (
    chunk.sequence !== sequence ||
    chunk.format.encoding !== "pcm16le" ||
    (chunk.format.channels !== 1 && chunk.format.channels !== 2) ||
    chunk.format.sampleRate < 8_000 ||
    chunk.format.sampleRate > 96_000 ||
    chunk.data.byteLength === 0 ||
    chunk.data.byteLength % (chunk.format.channels * 2) !== 0
  ) {
    throw new Error("Streaming playback received an invalid audio chunk");
  }
}

function rmsToLoudness(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return 0;
  return Math.round(
    Math.max(0, Math.min(100, ((20 * Math.log10(rms) + 60) / 60) * 100))
  );
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function workletSource(): string {
  return `
class VoxMeshPcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor("voxmesh-pcm-capture", VoxMeshPcmCapture);
`;
}
