import type {
  LlmProvider,
  StreamingLlmProvider
} from "../../packages/agent-core/src/index.js";
import {
  AzureOpenAiProvider,
  AzureOpenAiStreamingProvider
} from "../../packages/ai/src/index.js";
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
import {
  LiveTestConfigurationError,
  type LiveCapabilityId,
  type LiveChatConfiguration,
  type LiveProviderConfiguration,
  type LiveRequestBudget,
  type LiveSpeechToTextConfiguration,
  type LiveTextToSpeechConfiguration
} from "./provider-test-harness.js";
import {
  StreamingProviderQualification,
  streamingMinimumRequestCount,
  type StreamingQualificationDependencies
} from "./streaming-provider-qualification.js";

const dependencies: BufferedQualificationDependencies = {
  createChat,
  createStt,
  createTts
};
const streamingDependencies: StreamingQualificationDependencies = {
  createChat: createStreamingChat,
  createStt: unsupportedStreamingSpeech,
  createTts: unsupportedStreamingSpeech
};

export class AzureOpenAiQualification extends BufferedProviderQualification {
  private readonly streaming: StreamingProviderQualification;

  public constructor(
    config: LiveProviderConfiguration,
    budget: LiveRequestBudget,
    customDependencies: BufferedQualificationDependencies = dependencies,
    customStreamingDependencies: StreamingQualificationDependencies = streamingDependencies
  ) {
    super("azure-openai", "Azure", config, budget, customDependencies);
    this.streaming = new StreamingProviderQualification(
      "azure-openai",
      "Azure",
      config,
      budget,
      customStreamingDependencies
    );
  }

  public streamingChatDirect(): Promise<string> {
    return this.streaming.chatDirect();
  }

  public streamingChatWithTools(): Promise<string> {
    return this.streaming.chatWithTools();
  }
}

export function azureMinimumRequestCount(
  capabilities: readonly LiveCapabilityId[]
): number {
  return (
    bufferedMinimumRequestCount(capabilities) +
    streamingMinimumRequestCount(capabilities)
  );
}

function createChat(config: LiveChatConfiguration): LlmProvider {
  return new AzureOpenAiProvider({
    endpoint: config.endpoint.href,
    deployment: config.model,
    apiVersion: required(config.apiVersion, "Azure Chat API version"),
    apiKey: config.apiKey.reveal()
  });
}

function createStreamingChat(
  config: LiveChatConfiguration
): StreamingLlmProvider {
  return new AzureOpenAiStreamingProvider({
    endpoint: config.endpoint.href,
    deployment: config.model,
    apiVersion: required(config.apiVersion, "Azure Chat API version"),
    apiKey: config.apiKey.reveal(),
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens
  });
}

function unsupportedStreamingSpeech(): never {
  throw new LiveTestConfigurationError(
    "Azure streaming speech is outside the Phase 5 qualification scope"
  );
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
    throw new LiveTestConfigurationError(`${label} is required`);
  }
  return value;
}
