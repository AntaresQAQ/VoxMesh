import type {
  LlmProvider,
  StreamingLlmProvider
} from "../../packages/agent-core/src/index.js";
import {
  OpenAiCompatibleProvider,
  OpenAiCompatibleStreamingProvider
} from "../../packages/ai/src/index.js";
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
import { LiveTestConfigurationError } from "./provider-test-harness.js";
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

export class OpenAiCompatibleQualification extends BufferedProviderQualification {
  private readonly streaming: StreamingProviderQualification;

  public constructor(
    config: LiveProviderConfiguration,
    budget: LiveRequestBudget,
    customDependencies: BufferedQualificationDependencies = dependencies,
    customStreamingDependencies: StreamingQualificationDependencies = streamingDependencies
  ) {
    super(
      "openai-compatible",
      "OpenAI-compatible",
      config,
      budget,
      customDependencies
    );
    this.streaming = new StreamingProviderQualification(
      "openai-compatible",
      "OpenAI-compatible",
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

export function compatibleMinimumRequestCount(
  capabilities: readonly LiveCapabilityId[]
): number {
  return (
    bufferedMinimumRequestCount(capabilities) +
    streamingMinimumRequestCount(capabilities)
  );
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

function createStreamingChat(
  config: LiveChatConfiguration
): StreamingLlmProvider {
  return new OpenAiCompatibleStreamingProvider({
    baseUrl: config.endpoint.href,
    model: config.model,
    apiKey: config.apiKey.reveal(),
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens
  });
}

function unsupportedStreamingSpeech(): never {
  throw new LiveTestConfigurationError(
    "OpenAI-compatible streaming speech is outside the Phase 5 qualification scope"
  );
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
