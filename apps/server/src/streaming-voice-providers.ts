import {
  MockStreamingLlmProvider,
  type StreamingLlmProvider
} from "@voxmesh/agent-core";
import {
  MockStreamingSpeechToTextProvider,
  MockStreamingTextToSpeechProvider,
  type StreamingSpeechToTextProvider,
  type StreamingTextToSpeechProvider
} from "@voxmesh/audio";
import type {
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
 * PR 6 intentionally registers only deterministic Mock streaming adapters.
 * Later provider PRs extend these factories without changing the coordinator.
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
    streamingStt:
      configuration.speech.sttMode === "mock"
        ? new MockStreamingSpeechToTextProvider({
            language: configuration.speech.sttLanguage
          })
        : new UnavailableStreamingStt(configuration.speech.sttMode),
    bufferedLlm: createLlmProvider(configuration.llm),
    streamingLlm:
      configuration.llm.mode === "mock"
        ? new MockStreamingLlmProvider()
        : new UnavailableStreamingLlm(configuration.llm.mode),
    bufferedTts: createTextToSpeechProvider(configuration.speech),
    streamingTts:
      configuration.speech.ttsMode === "mock"
        ? new MockStreamingTextToSpeechProvider()
        : new UnavailableStreamingTts(configuration.speech.ttsMode)
  };
}

class UnavailableStreamingStt implements StreamingSpeechToTextProvider {
  public constructor(private readonly providerId: string) {}

  public async startSession(): Promise<never> {
    throw unavailable("STT", this.providerId);
  }
}

class UnavailableStreamingLlm implements StreamingLlmProvider {
  public constructor(private readonly providerId: string) {}

  public stream(): AsyncIterable<never> {
    const error = unavailable("Chat", this.providerId);
    return {
      [Symbol.asyncIterator](): AsyncIterator<never> {
        return {
          next: async () => Promise.reject(error)
        };
      }
    };
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
