import {
  MockStreamingLlmProvider,
  type StreamingLlmProvider
} from "@voxmesh/agent-core";
import {
  AzureOpenAiStreamingProvider,
  OpenAiCompatibleStreamingProvider
} from "@voxmesh/ai";
import {
  AlibabaModelStudioStreamingSpeechToTextProvider,
  AlibabaModelStudioStreamingTextToSpeechProvider,
  MockStreamingSpeechToTextProvider,
  MockStreamingTextToSpeechProvider,
  type StreamingSpeechToTextProvider,
  type StreamingTextToSpeechProvider
} from "@voxmesh/audio";
import type { StreamingRuntimeAvailability } from "@voxmesh/shared";
import type {
  StoredLlmConfiguration,
  StoredSpeechConfiguration,
  StoredStreamingVoiceConfiguration,
  VoxMeshStore
} from "@voxmesh/storage";

import { createLlmProvider } from "./llm-providers.js";
import {
  createSpeechToTextProvider,
  createTextToSpeechProvider
} from "./speech-providers.js";
import type {
  StreamingVoiceCoordinatorProviders,
  StreamingVoiceRunPreparation
} from "./streaming-voice-coordinator.js";

/**
 * Captures provider instances for one route before a streaming run starts.
 *
 * Route activation already verified every enabled streaming role against the
 * same configuration fingerprint before this factory can be reached.
 */
export function prepareStreamingVoiceRun(
  store: VoxMeshStore,
  routeId?: string
): StreamingVoiceRunPreparation {
  const configuration =
    store.captureRuntimeStreamingVoiceConfiguration(routeId);
  return {
    route: configuration.route,
    providers: createStreamingVoiceProviders(configuration)
  };
}

function createStreamingVoiceProviders(
  configuration: StoredStreamingVoiceConfiguration
): StreamingVoiceCoordinatorProviders {
  return {
    bufferedStt: createSpeechToTextProvider(configuration.speech),
    streamingStt: createStreamingSpeechToTextProvider(configuration.speech),
    bufferedLlm: createLlmProvider(configuration.llm),
    streamingLlm: createStreamingLlmProvider(configuration.llm),
    bufferedTts: createTextToSpeechProvider(configuration.speech),
    streamingTts: createStreamingTextToSpeechProvider(configuration.speech)
  };
}

export const streamingRuntimeAvailability: StreamingRuntimeAvailability = {
  transportAvailable: true,
  browserClientAvailable: true,
  sttProviderIds: ["mock", "alibaba-model-studio"],
  chatProviderIds: ["mock", "azure-openai", "openai-compatible"],
  ttsProviderIds: ["mock", "alibaba-model-studio"]
};

export function createStreamingSpeechToTextProvider(
  configuration: StoredSpeechConfiguration
): StreamingSpeechToTextProvider {
  switch (configuration.sttMode) {
    case "mock":
      return new MockStreamingSpeechToTextProvider({
        language: configuration.sttLanguage
      });
    case "alibaba-model-studio":
      return new AlibabaModelStudioStreamingSpeechToTextProvider({
        endpoint: configuration.sttEndpoint,
        model: configuration.sttDeployment,
        apiKey: configuration.sttApiKey ?? "",
        language: configuration.sttLanguage
      });
    default:
      return new UnavailableStreamingStt(configuration.sttMode);
  }
}

export function createStreamingLlmProvider(
  configuration: StoredLlmConfiguration
): StreamingLlmProvider {
  switch (configuration.mode) {
    case "mock":
      return new MockStreamingLlmProvider();
    case "azure-openai":
      return new AzureOpenAiStreamingProvider({
        endpoint: configuration.endpoint,
        deployment: configuration.deployment,
        apiVersion: configuration.apiVersion,
        apiKey: configuration.apiKey ?? "",
        timeoutMs: configuration.timeoutMs,
        maxOutputTokens: configuration.maxOutputTokens
      });
    case "openai-compatible":
      return new OpenAiCompatibleStreamingProvider({
        baseUrl: configuration.baseUrl,
        model: configuration.model,
        apiKey: configuration.apiKey ?? "",
        timeoutMs: configuration.timeoutMs,
        maxOutputTokens: configuration.maxOutputTokens
      });
  }
}

export function createStreamingTextToSpeechProvider(
  configuration: StoredSpeechConfiguration
): StreamingTextToSpeechProvider {
  switch (configuration.ttsMode) {
    case "mock":
      return new MockStreamingTextToSpeechProvider();
    case "alibaba-model-studio":
      return new AlibabaModelStudioStreamingTextToSpeechProvider({
        endpoint: configuration.ttsEndpoint,
        model: configuration.ttsDeployment,
        apiKey: configuration.ttsApiKey ?? "",
        voice: configuration.ttsVoice,
        instructions: configuration.ttsInstructions
      });
    default:
      return new UnavailableStreamingTts(configuration.ttsMode);
  }
}

class UnavailableStreamingStt implements StreamingSpeechToTextProvider {
  public constructor(private readonly providerId: string) {}

  public async startSession(): Promise<never> {
    throw unavailable("STT", this.providerId);
  }
}

class UnavailableStreamingTts implements StreamingTextToSpeechProvider {
  public constructor(private readonly providerId: string) {}

  public async startSynthesis(): Promise<never> {
    throw unavailable("TTS", this.providerId);
  }
}

function unavailable(role: "STT" | "Chat" | "TTS", providerId: string): Error {
  return new Error(
    `${role} streaming adapter is unavailable for provider ${providerId}`
  );
}
