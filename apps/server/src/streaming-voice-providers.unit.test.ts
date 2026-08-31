import { describe, expect, it } from "vitest";

import {
  AzureOpenAiStreamingProvider,
  OpenAiCompatibleStreamingProvider
} from "@voxmesh/ai";
import {
  AlibabaModelStudioStreamingSpeechToTextProvider,
  AlibabaModelStudioStreamingTextToSpeechProvider
} from "@voxmesh/audio";
import type {
  StoredLlmConfiguration,
  StoredSpeechConfiguration
} from "@voxmesh/storage";

import {
  createStreamingLlmProvider,
  createStreamingSpeechToTextProvider,
  createStreamingTextToSpeechProvider,
  streamingRuntimeAvailability
} from "./streaming-voice-providers.js";

const llm: StoredLlmConfiguration = {
  mode: "azure-openai",
  endpoint: "https://example.openai.azure.com",
  deployment: "chat-model",
  apiVersion: "2025-01-01-preview",
  baseUrl: "",
  model: "chat-model",
  timeoutMs: 30_000,
  maxOutputTokens: 1_024,
  apiKey: "test-api-key"
};

const speech: StoredSpeechConfiguration = {
  sttMode: "alibaba-model-studio",
  ttsMode: "alibaba-model-studio",
  sttEndpoint:
    "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
  sttDeployment: "fun-asr-realtime",
  sttApiVersion: "",
  sttLanguage: "zh",
  sttApiKey: "test-stt-key",
  ttsEndpoint:
    "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
  ttsDeployment: "qwen-audio-3.0-tts-plus",
  ttsApiVersion: "",
  ttsVoice: "longanlingxin",
  ttsInstructions: "",
  ttsApiKey: "test-tts-key"
};

describe("streaming voice provider registration", () => {
  it("declares every production streaming runtime surface", () => {
    expect(streamingRuntimeAvailability).toEqual({
      transportAvailable: true,
      browserClientAvailable: true,
      sttProviderIds: ["mock", "alibaba-model-studio"],
      chatProviderIds: ["mock", "azure-openai", "openai-compatible"],
      ttsProviderIds: ["mock", "alibaba-model-studio"]
    });
  });

  it("creates Azure, compatible, and Alibaba streaming adapters", () => {
    expect(createStreamingLlmProvider(llm)).toBeInstanceOf(
      AzureOpenAiStreamingProvider
    );
    expect(
      createStreamingLlmProvider({
        ...llm,
        mode: "openai-compatible",
        endpoint: "",
        baseUrl: "https://provider.example.com/v1",
        model: "compatible-model"
      })
    ).toBeInstanceOf(OpenAiCompatibleStreamingProvider);
    expect(createStreamingSpeechToTextProvider(speech)).toBeInstanceOf(
      AlibabaModelStudioStreamingSpeechToTextProvider
    );
    expect(createStreamingTextToSpeechProvider(speech)).toBeInstanceOf(
      AlibabaModelStudioStreamingTextToSpeechProvider
    );
  });

  it("keeps unsupported streaming speech providers unavailable", async () => {
    const controller = new AbortController();
    const stt = createStreamingSpeechToTextProvider({
      ...speech,
      sttMode: "azure-openai"
    });
    const tts = createStreamingTextToSpeechProvider({
      ...speech,
      ttsMode: "openai-compatible"
    });

    await expect(
      stt.startSession({
        format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
        signal: controller.signal
      })
    ).rejects.toThrow(
      "STT streaming adapter is unavailable for provider azure-openai"
    );
    await expect(
      tts.startSynthesis({ text: "Test", signal: controller.signal })
    ).rejects.toThrow(
      "TTS streaming adapter is unavailable for provider openai-compatible"
    );
  });
});
