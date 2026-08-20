import type { ModelCapability } from "@voxmesh/shared";

import type { TranslationKey } from "../../i18n/en.js";

const keys: Record<ModelCapability, TranslationKey> = {
  "text-input": "settings.capabilityTextInput",
  "text-output": "settings.capabilityTextOutput",
  "audio-input": "settings.capabilityAudioInput",
  "audio-output": "settings.capabilityAudioOutput",
  transcription: "settings.capabilityTranscription",
  "speech-synthesis": "settings.capabilitySpeechSynthesis",
  "tool-calling": "settings.capabilityToolCalling",
  "native-multimodal": "settings.capabilityNativeMultimodal",
  streaming: "settings.capabilityStreaming",
  "non-streaming": "settings.capabilityNonStreaming"
};

export function capabilityLabel(
  capability: ModelCapability,
  t: (key: TranslationKey) => string
): string {
  return t(keys[capability]);
}
