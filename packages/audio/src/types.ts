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
