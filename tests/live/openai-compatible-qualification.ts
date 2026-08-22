import type { LlmProvider } from "../../packages/agent-core/src/index.js";
import { OpenAiCompatibleProvider } from "../../packages/ai/src/index.js";
import {
  OpenAiCompatibleSpeechToTextProvider,
  OpenAiCompatibleTextToSpeechProvider,
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

export class OpenAiCompatibleQualification extends BufferedProviderQualification {
  public constructor(
    config: LiveProviderConfiguration,
    budget: LiveRequestBudget,
    customDependencies: BufferedQualificationDependencies = dependencies
  ) {
    super(
      "openai-compatible",
      "OpenAI-compatible",
      config,
      budget,
      customDependencies
    );
  }
}

export function compatibleMinimumRequestCount(
  capabilities: readonly LiveCapabilityId[]
): number {
  return bufferedMinimumRequestCount(capabilities);
}

function createChat(config: LiveChatConfiguration): LlmProvider {
  return new OpenAiCompatibleProvider({
    baseUrl: config.endpoint.href,
    model: config.model,
    apiKey: config.apiKey.reveal(),
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens
  });
}

function createStt(
  config: LiveSpeechToTextConfiguration
): SpeechToTextProvider {
  return new OpenAiCompatibleSpeechToTextProvider({
    baseUrl: config.endpoint.href,
    model: config.model,
    apiKey: config.apiKey.reveal(),
    language: config.language ?? "",
    timeoutMs: config.timeoutMs
  });
}

function createTts(
  config: LiveTextToSpeechConfiguration
): TextToSpeechProvider {
  return new OpenAiCompatibleTextToSpeechProvider({
    baseUrl: config.endpoint.href,
    model: config.model,
    apiKey: config.apiKey.reveal(),
    voice: config.voice,
    instructions: config.instructions ?? "",
    timeoutMs: config.timeoutMs
  });
}
