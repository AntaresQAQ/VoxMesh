/** Binary audio and the metadata required to interpret it safely. */
export interface AudioData {
  data: Uint8Array;
  mimeType: string;
  sampleRate?: number;
  channels?: number;
}

export interface TranscriptionResult {
  text: string;
  language: string;
}

export interface SpeechToTextProvider {
  transcribe(audio: AudioData): Promise<TranscriptionResult>;
}

export interface TextToSpeechProvider {
  synthesize(text: string): Promise<AudioData>;
}

/** Explicit PCM format used by provider-independent streaming audio sessions. */
export interface StreamingAudioFormat {
  encoding: "pcm16le";
  sampleRate: number;
  channels: number;
}

/** One ordered PCM chunk. Sequence numbers start at one within each stream. */
export interface StreamingAudioChunk {
  sequence: number;
  format: StreamingAudioFormat;
  data: Uint8Array;
}

export type StreamingTranscriptionEvent =
  | {
      type: "partial";
      sequence: number;
      text: string;
    }
  | {
      type: "final";
      sequence: number;
      result: TranscriptionResult;
    };

/**
 * One Streaming STT session.
 *
 * Implementations emit ordered partial events and exactly one final event.
 * `close` is idempotent and releases provider resources after every outcome.
 */
export interface StreamingSpeechToTextSession extends AsyncIterable<StreamingTranscriptionEvent> {
  write(audio: StreamingAudioChunk): Promise<void>;
  finishInput(): Promise<void>;
  close(): Promise<void>;
}

export interface StreamingSpeechToTextProvider {
  startSession(input: {
    format: StreamingAudioFormat;
    signal: AbortSignal;
  }): Promise<StreamingSpeechToTextSession>;
}

export type StreamingSynthesisEvent =
  | {
      type: "audio";
      chunk: StreamingAudioChunk;
    }
  | {
      type: "completed";
      sequence: number;
      format: StreamingAudioFormat;
      audioBytes: number;
      durationMs: number;
    };

/**
 * One Streaming TTS session for a stable text segment.
 *
 * Implementations emit ordered audio chunks and exactly one completed event.
 */
export interface StreamingTextToSpeechSession extends AsyncIterable<StreamingSynthesisEvent> {
  close(): Promise<void>;
}

export interface StreamingTextToSpeechProvider {
  startSynthesis(input: {
    text: string;
    signal: AbortSignal;
  }): Promise<StreamingTextToSpeechSession>;
}
