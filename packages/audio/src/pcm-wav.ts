const PCM_FORMAT = 1;
const PCM_BITS_PER_SAMPLE = 16;

export interface Pcm16Wav {
  channels: number;
  sampleRate: number;
  pcm: Uint8Array;
}

/** Encodes little-endian PCM16 samples as a standard RIFF/WAVE file. */
export function encodePcm16Wav(input: Pcm16Wav): Uint8Array {
  if (input.channels < 1 || !Number.isInteger(input.channels)) {
    throw new Error("PCM WAV channels must be a positive integer");
  }
  if (input.sampleRate < 1 || !Number.isInteger(input.sampleRate)) {
    throw new Error("PCM WAV sample rate must be a positive integer");
  }
  if (input.pcm.byteLength === 0 || input.pcm.byteLength % 2 !== 0) {
    throw new Error("PCM WAV audio must contain complete 16-bit samples");
  }

  const bytes = new Uint8Array(44 + input.pcm.byteLength);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + input.pcm.byteLength, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, PCM_FORMAT, true);
  view.setUint16(22, input.channels, true);
  view.setUint32(24, input.sampleRate, true);
  view.setUint32(
    28,
    input.sampleRate * input.channels * (PCM_BITS_PER_SAMPLE / 8),
    true
  );
  view.setUint16(32, input.channels * (PCM_BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, PCM_BITS_PER_SAMPLE, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, input.pcm.byteLength, true);
  bytes.set(input.pcm, 44);
  return bytes;
}

/** Parses a RIFF/WAVE file and accepts only little-endian PCM16 audio. */
export function decodePcm16Wav(data: Uint8Array): Pcm16Wav {
  if (
    data.byteLength < 44 ||
    readAscii(data, 0, 4) !== "RIFF" ||
    readAscii(data, 8, 4) !== "WAVE"
  ) {
    throw new Error("Audio must be a valid RIFF/WAVE file");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  let format: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let pcm: Uint8Array | null = null;

  while (offset + 8 <= data.byteLength) {
    const id = readAscii(data, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const contentOffset = offset + 8;
    const nextOffset = contentOffset + size + (size % 2);
    if (contentOffset + size > data.byteLength) {
      throw new Error("WAV chunk exceeds the available audio data");
    }
    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: view.getUint16(contentOffset, true),
        channels: view.getUint16(contentOffset + 2, true),
        sampleRate: view.getUint32(contentOffset + 4, true),
        bitsPerSample: view.getUint16(contentOffset + 14, true)
      };
    } else if (id === "data") {
      pcm = data.slice(contentOffset, contentOffset + size);
    }
    offset = nextOffset;
  }

  if (!format || !pcm) {
    throw new Error("WAV audio requires fmt and data chunks");
  }
  if (format.audioFormat !== PCM_FORMAT) {
    throw new Error("WAV audio must use uncompressed PCM encoding");
  }
  if (format.bitsPerSample !== PCM_BITS_PER_SAMPLE) {
    throw new Error("WAV audio must use 16-bit PCM samples");
  }
  if (format.channels !== 1) {
    throw new Error("WAV audio must be mono");
  }
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) {
    throw new Error("WAV audio contains invalid PCM16 data");
  }

  return {
    channels: format.channels,
    sampleRate: format.sampleRate,
    pcm
  };
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function readAscii(source: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...source.subarray(offset, offset + length));
}
