import { encodePcm16Wav } from "@voxmesh/audio/pcm-wav";

const TARGET_SAMPLE_RATE = 16_000;

export interface AudioRecorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
  cancel(): void;
  /** Emits normalized microphone loudness from 0 to 100 while recording. */
  subscribeLevel?(listener: (level: number) => void): () => void;
}

/**
 * Browser MediaRecorder adapter used only by the Web Console.
 *
 * Physical server audio remains behind a separate platform adapter.
 */
export class BrowserAudioRecorder implements AudioRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private meterContext: AudioContext | null = null;
  private meterSource: MediaStreamAudioSourceNode | null = null;
  private meterAnalyser: AnalyserNode | null = null;
  private meterFrame: number | null = null;
  private readonly levelListeners = new Set<(level: number) => void>();
  private generation = 0;

  public async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      throw new Error("Browser audio recording is not supported");
    }
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (generation !== this.generation) {
      stopMediaStream(stream);
      throw new Error("Audio recording was cancelled");
    }
    this.stream = stream;
    this.chunks = [];
    try {
      const recorder = new MediaRecorder(stream);
      this.recorder = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      });
      await this.startMeter(stream);
      recorder.start();
    } catch (error) {
      await this.release();
      throw error;
    }
  }

  public async stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== "recording") {
      throw new Error("Audio recording is not active");
    }
    return new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener(
        "stop",
        () => {
          void this.finishRecording(recorder).then(resolve, reject);
        },
        { once: true }
      );
      recorder.stop();
    });
  }

  public cancel(): void {
    this.generation += 1;
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
    }
    void this.release().catch((error: unknown) => {
      console.error(
        "Failed to release browser audio recording resources",
        error
      );
    });
  }

  public subscribeLevel(listener: (level: number) => void): () => void {
    this.levelListeners.add(listener);
    listener(0);
    return () => {
      this.levelListeners.delete(listener);
    };
  }

  private async finishRecording(recorder: MediaRecorder): Promise<Blob> {
    const type = recorder.mimeType || this.chunks[0]?.type || "audio/webm";
    const blob = new Blob(this.chunks, { type });
    await this.release();
    if (blob.size === 0) {
      throw new Error("Audio recording is empty");
    }
    return normalizeBrowserRecording(blob);
  }

  private async startMeter(stream: MediaStream): Promise<void> {
    this.meterContext = new AudioContext();
    await this.meterContext.resume();
    this.meterSource = this.meterContext.createMediaStreamSource(stream);
    this.meterAnalyser = this.meterContext.createAnalyser();
    this.meterAnalyser.fftSize = 1024;
    this.meterAnalyser.smoothingTimeConstant = 0.75;
    this.meterSource.connect(this.meterAnalyser);
    const samples = new Float32Array(this.meterAnalyser.fftSize);
    const update = () => {
      if (!this.meterAnalyser) return;
      this.meterAnalyser.getFloatTimeDomainData(samples);
      this.emitLevel(rmsToLoudnessPercent(samples));
      this.meterFrame = requestAnimationFrame(update);
    };
    update();
  }

  private emitLevel(level: number): void {
    for (const listener of this.levelListeners) {
      listener(level);
    }
  }

  private async release(): Promise<void> {
    if (this.meterFrame !== null) {
      cancelAnimationFrame(this.meterFrame);
      this.meterFrame = null;
    }
    this.meterSource?.disconnect();
    this.meterAnalyser?.disconnect();
    const meterContext = this.meterContext;
    this.meterSource = null;
    this.meterAnalyser = null;
    this.meterContext = null;
    this.emitLevel(0);
    if (this.stream) stopMediaStream(this.stream);
    this.stream = null;
    this.recorder = null;
    if (meterContext) {
      await meterContext.close();
    }
  }
}

function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/** Maps microphone RMS from -60 dBFS to 0 dBFS onto a stable percentage. */
export function rmsToLoudnessPercent(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of samples) {
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms <= 0) return 0;
  const decibels = 20 * Math.log10(rms);
  return Math.round(Math.max(0, Math.min(100, ((decibels + 60) / 60) * 100)));
}

interface DecodedAudio {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

interface BrowserAudioContext {
  decodeAudioData(data: ArrayBuffer): Promise<DecodedAudio>;
  close(): Promise<void>;
}

type AudioContextFactory = () => BrowserAudioContext;

/** Converts browser-specific recording containers into mono 16 kHz PCM WAV. */
export async function normalizeBrowserRecording(
  blob: Blob,
  createAudioContext: AudioContextFactory = () => new AudioContext()
): Promise<Blob> {
  const context = createAudioContext();
  try {
    const decoded = await context.decodeAudioData(await readBlob(blob));
    const pcm = resampleMonoPcm16(decoded, TARGET_SAMPLE_RATE);
    const wav = encodePcm16Wav({
      channels: 1,
      sampleRate: TARGET_SAMPLE_RATE,
      pcm
    });
    const buffer = new ArrayBuffer(wav.byteLength);
    new Uint8Array(buffer).set(wav);
    return new Blob([buffer], { type: "audio/wav" });
  } catch (error) {
    throw new Error(
      `Browser audio normalization failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  } finally {
    await context.close();
  }
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("Browser returned an invalid recording buffer"));
      }
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Browser recording could not be read"));
    });
    reader.readAsArrayBuffer(blob);
  });
}

function resampleMonoPcm16(
  audio: DecodedAudio,
  targetSampleRate: number
): Uint8Array {
  if (audio.numberOfChannels < 1 || audio.sampleRate < 1 || audio.length < 1) {
    throw new Error("Decoded audio is empty or invalid");
  }
  const channelData = Array.from(
    { length: audio.numberOfChannels },
    (_, channel) => audio.getChannelData(channel)
  );
  const outputLength = Math.max(
    1,
    Math.round((audio.length * targetSampleRate) / audio.sampleRate)
  );
  const pcm = new Uint8Array(outputLength * 2);
  const view = new DataView(pcm.buffer);

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = (index * audio.sampleRate) / targetSampleRate;
    const leftIndex = Math.min(audio.length - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(audio.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    let sample = 0;
    for (const channel of channelData) {
      const left = channel[leftIndex] ?? 0;
      const right = channel[rightIndex] ?? left;
      sample += left + (right - left) * fraction;
    }
    sample = Math.max(-1, Math.min(1, sample / audio.numberOfChannels));
    view.setInt16(
      index * 2,
      sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767),
      true
    );
  }
  return pcm;
}

export async function playBase64Audio(input: {
  base64: string;
  mimeType: string;
}): Promise<void> {
  const binary = atob(input.base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: input.mimeType }));
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), {
    once: true
  });
  try {
    await audio.play();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
