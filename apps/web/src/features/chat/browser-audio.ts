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
          resolve(blob);
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
