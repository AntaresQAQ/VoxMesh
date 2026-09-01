import type {
  LlmProvider,
  StreamingLlmProvider
} from "../../packages/agent-core/src/index.js";
import {
  OpenAiCompatibleProvider,
  OpenAiCompatibleStreamingProvider
} from "../../packages/ai/src/index.js";
import {
  AlibabaModelStudioConfigurationError,
  AlibabaModelStudioSpeechToTextProvider,
  AlibabaModelStudioStreamingSpeechToTextProvider,
  AlibabaModelStudioStreamingTextToSpeechProvider,
  AlibabaModelStudioTextToSpeechProvider,
  validateAlibabaModelStudioCompatibleEndpoint,
  validateAlibabaModelStudioSttConfiguration,
  validateAlibabaModelStudioTtsConfiguration,
  type SpeechToTextProvider,
  type StreamingSpeechToTextProvider,
  type StreamingTextToSpeechProvider,
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
  type StreamingAudioQualificationResult,
  type StreamingComposedQualificationResult,
  type StreamingQualificationDependencies
} from "./streaming-provider-qualification.js";

const dependencies: BufferedQualificationDependencies = {
  validateConfiguration,
  createChat,
  createStt,
  createTts
};
const streamingDependencies: StreamingQualificationDependencies = {
  createChat: createStreamingChat,
  createStt: createStreamingStt,
  createTts: createStreamingTts
};

export class AlibabaModelStudioQualification extends BufferedProviderQualification {
  private readonly streaming: StreamingProviderQualification;

  public constructor(
    config: LiveProviderConfiguration,
    budget: LiveRequestBudget,
    customDependencies: BufferedQualificationDependencies = dependencies,
    customStreamingDependencies: StreamingQualificationDependencies = streamingDependencies
  ) {
    super(
      "alibaba-model-studio",
      "Alibaba Model Studio",
      config,
      budget,
      customDependencies
    );
    this.streaming = new StreamingProviderQualification(
      "alibaba-model-studio",
      "Alibaba Model Studio",
      config,
      budget,
      customStreamingDependencies
    );
  }

  public streamingTranscribe(): Promise<string> {
    return this.streaming.transcribe();
  }

  public streamingSynthesize(): Promise<StreamingAudioQualificationResult> {
    return this.streaming.synthesize();
  }

  public streamingComposedVoice(): Promise<StreamingComposedQualificationResult> {
    return this.streaming.composedVoice();
  }
}

export function alibabaMinimumRequestCount(
  capabilities: readonly LiveCapabilityId[]
): number {
  return (
    bufferedMinimumRequestCount(capabilities) +
    streamingMinimumRequestCount(capabilities)
  );
}

function validateConfiguration(config: LiveProviderConfiguration): void {
  try {
    if (config.chat) {
      validateAlibabaModelStudioCompatibleEndpoint(config.chat.endpoint.href);
    }
    if (config.stt) {
      validateAlibabaModelStudioSttConfiguration({
        endpoint: config.stt.endpoint.href,
        apiKeyConfigured: true,
        model: config.stt.model
      });
    }
    if (config.tts) {
      validateAlibabaModelStudioTtsConfiguration({
        endpoint: config.tts.endpoint.href,
        apiKeyConfigured: true,
        model: config.tts.model,
        voice: config.tts.voice
      });
    }
  } catch (error) {
    if (error instanceof AlibabaModelStudioConfigurationError) {
      throw new LiveTestConfigurationError(error.message);
    }
    throw error;
  }
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

function createStreamingStt(
  config: LiveSpeechToTextConfiguration
): StreamingSpeechToTextProvider {
  return new AlibabaModelStudioStreamingSpeechToTextProvider({
    endpoint: config.endpoint.href,
    model: config.model,
    apiKey: config.apiKey.reveal(),
    language: config.language ?? "",
    timeoutMs: config.timeoutMs
  });
}

function createStreamingTts(
  config: LiveTextToSpeechConfiguration
): StreamingTextToSpeechProvider {
  return new AlibabaModelStudioStreamingTextToSpeechProvider({
    endpoint: config.endpoint.href,
    model: config.model,
    apiKey: config.apiKey.reveal(),
    voice: config.voice,
    instructions: config.instructions ?? "",
    timeoutMs: config.timeoutMs
  });
}

function createStt(
  config: LiveSpeechToTextConfiguration
): SpeechToTextProvider {
  return new AlibabaModelStudioSpeechToTextProvider({
    endpoint: config.endpoint.href,
    model: config.model,
    apiKey: config.apiKey.reveal(),
    language: config.language ?? "",
    timeoutMs: config.timeoutMs
  });
}

function createTts(
  config: LiveTextToSpeechConfiguration
): TextToSpeechProvider {
  return new AlibabaModelStudioTextToSpeechProvider({
    endpoint: config.endpoint.href,
    model: config.model,
    apiKey: config.apiKey.reveal(),
    voice: config.voice,
    instructions: config.instructions ?? "",
    timeoutMs: config.timeoutMs
  });
}
