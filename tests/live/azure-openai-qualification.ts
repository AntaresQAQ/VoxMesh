import type { LlmProvider } from "../../packages/agent-core/src/index.js";
import { AzureOpenAiProvider } from "../../packages/ai/src/index.js";
import {
  AzureOpenAiSpeechToTextProvider,
  AzureOpenAiTextToSpeechProvider,
  type SpeechToTextProvider,
  type TextToSpeechProvider
} from "../../packages/audio/src/index.js";

import {
  BufferedProviderQualification,
  bufferedMinimumRequestCount,
  type BufferedQualificationDependencies
} from "./buffered-provider-qualification.js";
import type {
  LiveCapabilityId,
  LiveChatConfiguration,
  LiveProviderConfiguration,
  LiveRequestBudget,
  LiveSpeechToTextConfiguration,
  LiveTextToSpeechConfiguration
} from "./provider-test-harness.js";

const dependencies: BufferedQualificationDependencies = {
  createChat,
  createStt,
  createTts
};

export class AzureOpenAiQualification extends BufferedProviderQualification {
  public constructor(
    config: LiveProviderConfiguration,
    budget: LiveRequestBudget,
    customDependencies: BufferedQualificationDependencies = dependencies
  ) {
    super("azure-openai", "Azure", config, budget, customDependencies);
  }
}

export function azureMinimumRequestCount(
  capabilities: readonly LiveCapabilityId[]
): number {
  return bufferedMinimumRequestCount(capabilities);
}

function createChat(config: LiveChatConfiguration): LlmProvider {
  return new AzureOpenAiProvider({
    endpoint: config.endpoint.href,
    deployment: config.model,
    apiVersion: required(config.apiVersion, "Azure Chat API version"),
    apiKey: config.apiKey.reveal()
  });
}

function createStt(
  config: LiveSpeechToTextConfiguration
): SpeechToTextProvider {
  return new AzureOpenAiSpeechToTextProvider({
    endpoint: config.endpoint.href,
    deployment: config.model,
    apiVersion: required(config.apiVersion, "Azure STT API version"),
    apiKey: config.apiKey.reveal(),
    language: config.language ?? "",
    timeoutMs: config.timeoutMs
  });
}

function createTts(
  config: LiveTextToSpeechConfiguration
): TextToSpeechProvider {
  return new AzureOpenAiTextToSpeechProvider({
    endpoint: config.endpoint.href,
    deployment: config.model,
    apiVersion: required(config.apiVersion, "Azure TTS API version"),
    apiKey: config.apiKey.reveal(),
    voice: config.voice,
    instructions: config.instructions ?? "",
    timeoutMs: config.timeoutMs
  });
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} is required`);
  }
  return value;
}
