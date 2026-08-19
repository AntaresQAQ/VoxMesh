import { encodePcm16Wav } from "@voxmesh/audio/pcm-wav";

const TARGET_SAMPLE_RATE = 16_000;

export interface AudioRecorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
  cancel(): void;
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

  public async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      throw new Error("Browser audio recording is not supported");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    this.recorder.start();
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
          const type =
            recorder.mimeType || this.chunks[0]?.type || "audio/webm";
          const blob = new Blob(this.chunks, { type });
          this.release();
          if (blob.size === 0) {
            reject(new Error("Audio recording is empty"));
            return;
          }
          void normalizeBrowserRecording(blob).then(resolve, reject);
        },
        { once: true }
      );
      recorder.stop();
    });
  }

  public cancel(): void {
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
    }
    this.release();
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.recorder = null;
  }
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
