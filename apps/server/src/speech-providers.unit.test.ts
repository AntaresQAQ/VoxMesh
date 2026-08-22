import { describe, expect, it, vi } from "vitest";

import {
  AlibabaModelStudioSpeechToTextProvider,
  AlibabaModelStudioTextToSpeechProvider,
  AzureOpenAiSpeechToTextProvider,
  AzureOpenAiTextToSpeechProvider,
  MockSpeechToTextProvider,
  MockTextToSpeechProvider,
  OpenAiCompatibleSpeechToTextProvider,
  OpenAiCompatibleTextToSpeechProvider
} from "@voxmesh/audio";
import type { StoredSpeechConfiguration } from "@voxmesh/storage";

import {
  createSpeechToTextProvider,
  createTextToSpeechProvider,
  testSpeechProviders,
  validateSpeechConfiguration
} from "./speech-providers.js";

const mockConfig: StoredSpeechConfiguration = {
  sttMode: "mock",
  ttsMode: "mock",
  sttEndpoint: "",
  sttDeployment: "",
  sttApiVersion: "2025-04-01-preview",
  sttLanguage: "zh",
  sttApiKey: null,
  ttsEndpoint: "",
  ttsDeployment: "",
  ttsApiVersion: "2025-03-01-preview",
  ttsVoice: "coral",
  ttsInstructions: "Speak clearly.",
  ttsApiKey: null
};

describe("speech provider factory", () => {
  it("creates Mock providers without Azure credentials", () => {
    expect(createSpeechToTextProvider(mockConfig)).toBeInstanceOf(
      MockSpeechToTextProvider
    );
    expect(createTextToSpeechProvider(mockConfig)).toBeInstanceOf(
      MockTextToSpeechProvider
    );
  });

  it("creates Azure OpenAI providers from valid configuration", () => {
    const azureConfig: StoredSpeechConfiguration = {
      ...mockConfig,
      sttMode: "azure-openai",
      ttsMode: "azure-openai",
      sttEndpoint: "https://stt.openai.azure.com",
      sttDeployment: "gpt-4o-mini-transcribe",
      sttApiKey: "stt-secret",
      ttsEndpoint: "https://tts.openai.azure.com",
      ttsDeployment: "gpt-4o-mini-tts",
      ttsApiKey: "tts-secret"
    };

    expect(createSpeechToTextProvider(azureConfig)).toBeInstanceOf(
      AzureOpenAiSpeechToTextProvider
    );
    expect(createTextToSpeechProvider(azureConfig)).toBeInstanceOf(
      AzureOpenAiTextToSpeechProvider
    );
  });

  it("rejects incomplete Azure configuration", () => {
    expect(() =>
      validateSpeechConfiguration({
        ...mockConfig,
        sttMode: "azure-openai"
      })
    ).toThrow("requires an endpoint and API key");
  });

  it("creates OpenAI-compatible speech providers", () => {
    const compatibleConfig: StoredSpeechConfiguration = {
      ...mockConfig,
      sttMode: "openai-compatible",
      ttsMode: "openai-compatible",
      sttEndpoint: "https://provider.example.com/v1",
      sttDeployment: "stt-model",
      sttApiKey: "stt-secret",
      ttsEndpoint: "https://provider.example.com/v1",
      ttsDeployment: "tts-model",
      ttsApiKey: "tts-secret"
    };

    expect(createSpeechToTextProvider(compatibleConfig)).toBeInstanceOf(
      OpenAiCompatibleSpeechToTextProvider
    );
    expect(createTextToSpeechProvider(compatibleConfig)).toBeInstanceOf(
      OpenAiCompatibleTextToSpeechProvider
    );
  });

  it("creates dedicated Alibaba Model Studio speech providers", () => {
    const alibabaConfig: StoredSpeechConfiguration = {
      ...mockConfig,
      sttMode: "alibaba-model-studio",
      ttsMode: "alibaba-model-studio",
      sttEndpoint:
        "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      sttDeployment: "fun-asr-realtime",
      sttApiKey: "stt-secret",
      ttsEndpoint:
        "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      ttsDeployment: "qwen-audio-3.0-tts-plus",
      ttsVoice: "longanlingxin",
      ttsApiKey: "tts-secret"
    };

    expect(createSpeechToTextProvider(alibabaConfig)).toBeInstanceOf(
      AlibabaModelStudioSpeechToTextProvider
    );
    expect(createTextToSpeechProvider(alibabaConfig)).toBeInstanceOf(
      AlibabaModelStudioTextToSpeechProvider
    );
  });

  it("rejects invalid Alibaba endpoints and non-realtime STT models", () => {
    expect(() =>
      validateSpeechConfiguration({
        ...mockConfig,
        sttMode: "alibaba-model-studio",
        sttEndpoint:
          "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        sttDeployment: "qwen-audio-3.0-asr-flash-filetrans",
        sttApiKey: "secret"
      })
    ).toThrow("endpoint must use WSS");
    expect(() =>
      validateSpeechConfiguration({
        ...mockConfig,
        sttMode: "alibaba-model-studio",
        sttEndpoint:
          "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        sttDeployment: "qwen-audio-3.0-asr-flash-filetrans",
        sttApiKey: "secret"
      })
    ).toThrow("requires a realtime Fun-ASR or Qwen Audio streaming model");
    expect(() =>
      validateSpeechConfiguration({
        ...mockConfig,
        sttMode: "alibaba-model-studio",
        sttEndpoint: "wss://attacker.example.test/api-ws/v1/inference",
        sttDeployment: "fun-asr-realtime",
        sttApiKey: "secret"
      })
    ).toThrow("endpoint must use an Alibaba Cloud host");
  });

  it("rejects Alibaba Qwen Audio voices from a different model family", () => {
    expect(() =>
      validateSpeechConfiguration({
        ...mockConfig,
        ttsMode: "alibaba-model-studio",
        ttsEndpoint:
          "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        ttsDeployment: "qwen-audio-3.0-tts-plus",
        ttsVoice: "longpaopao_v3.6",
        ttsApiKey: "secret"
      })
    ).toThrow("does not support this Flash voice");
  });

  it("tests STT with actual audio produced by the selected TTS provider", async () => {
    const audio = {
      data: new Uint8Array([82, 73, 70, 70]),
      mimeType: "audio/wav"
    };
    const synthesize = vi.fn(async () => audio);
    const transcribe = vi.fn(async () => ({
      text: "语音连接测试成功",
      language: "zh"
    }));

    await expect(
      testSpeechProviders(mockConfig, {
        tts: { synthesize },
        stt: { transcribe }
      })
    ).resolves.toEqual({
      success: true,
      transcript: "语音连接测试成功",
      audioMimeType: "audio/wav"
    });
    expect(synthesize).toHaveBeenCalledWith("语音连接测试成功。");
    expect(transcribe).toHaveBeenCalledWith(audio);
  });
});
