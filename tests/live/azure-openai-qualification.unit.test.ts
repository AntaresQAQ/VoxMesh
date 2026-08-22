import { MockLlmProvider } from "../../packages/agent-core/src/index.js";
import type {
  SpeechToTextProvider,
  TextToSpeechProvider
} from "../../packages/audio/src/index.js";
import { describe, expect, it } from "vitest";

import {
  AzureOpenAiQualification,
  azureMinimumRequestCount
} from "./azure-openai-qualification.js";
import {
  createSyntheticPcm16Wav,
  LiveRequestBudget,
  LiveTestRequestError,
  SecretValue,
  type LiveProviderConfiguration
} from "./provider-test-harness.js";

const inputAudio = {
  data: createSyntheticPcm16Wav(),
  mimeType: "audio/wav"
};
const outputAudio = {
  data: createSyntheticPcm16Wav(250, 440, 24_000),
  mimeType: "audio/wav"
};
const config: LiveProviderConfiguration = {
  chat: {
    endpoint: new URL("https://azure.example.test"),
    apiKey: new SecretValue("chat-secret"),
    model: "chat-deployment",
    apiVersion: "2024-10-21",
    timeoutMs: 1_000,
    maxOutputTokens: 128
  },
  stt: {
    endpoint: new URL("https://azure.example.test"),
    apiKey: new SecretValue("stt-secret"),
    model: "stt-deployment",
    apiVersion: "2025-04-01-preview",
    language: "en",
    fixturePath: "/synthetic/check-light.wav",
    timeoutMs: 1_000
  },
  tts: {
    endpoint: new URL("https://azure.example.test"),
    apiKey: new SecretValue("tts-secret"),
    model: "tts-deployment",
    apiVersion: "2025-03-01-preview",
    voice: "test-voice",
    instructions: "Speak clearly.",
    responseFormat: "wav",
    timeoutMs: 1_000
  }
};

describe("AzureOpenAiQualification", () => {
  it("runs every scenario through production-shaped provider contracts", async () => {
    const budget = new LiveRequestBudget(9);
    const evidence: string[] = [];
    const stt: SpeechToTextProvider = {
      transcribe: async () => ({
        text: "Check the light status",
        language: "en"
      })
    };
    const tts: TextToSpeechProvider = {
      synthesize: async () => outputAudio
    };
    const qualification = new AzureOpenAiQualification(config, budget, {
      createChat: () => new MockLlmProvider(),
      createStt: () => stt,
      createTts: () => tts,
      readAudioFixture: async () => inputAudio,
      recordEvidence: async (_provider, capability, operation) => {
        evidence.push(capability);
        return await operation();
      }
    });

    await expect(qualification.chatDirect()).resolves.toContain(
      "Mock assistant received"
    );
    await expect(qualification.chatWithTools()).resolves.toContain(
      "living-room-light"
    );
    await expect(qualification.transcribe()).resolves.toBe(
      "Check the light status"
    );
    await expect(qualification.synthesize()).resolves.toEqual(outputAudio);
    await expect(qualification.composedVoice()).resolves.toMatchObject({
      transcript: "Check the light status",
      usedTools: ["mock.get_device_status"],
      audioMimeType: "audio/wav",
      audioByteLength: outputAudio.data.byteLength
    });
    expect(evidence).toEqual([
      "chat-direct",
      "chat-tools",
      "stt",
      "tts",
      "composed-voice"
    ]);
    expect(budget.remaining).toBe(0);
  });

  it("surfaces only a fixed safe provider failure", async () => {
    const qualification = new AzureOpenAiQualification(
      config,
      new LiveRequestBudget(1),
      {
        createChat: () => ({
          complete: async () => {
            throw new Error(
              "HTTP 401 https://secret-resource.example.test api-key=chat-secret"
            );
          }
        }),
        createStt: () => {
          throw new Error("STT must not be created");
        },
        createTts: () => {
          throw new Error("TTS must not be created");
        },
        readAudioFixture: async () => {
          throw new Error("Fixture must not be read");
        },
        recordEvidence: async (_provider, _capability, operation) =>
          await operation()
      }
    );

    await expect(qualification.chatDirect()).rejects.toEqual(
      new LiveTestRequestError(
        "authentication",
        "Provider authentication failed."
      )
    );
  });

  it("calculates the exact maximum request count for selected scenarios", () => {
    expect(azureMinimumRequestCount(["chat"])).toBe(3);
    expect(azureMinimumRequestCount(["stt", "tts"])).toBe(2);
    expect(
      azureMinimumRequestCount(["chat", "stt", "tts", "composed-voice"])
    ).toBe(9);
  });
});
