import { MockLlmProvider } from "../../packages/agent-core/src/index.js";
import type {
  SpeechToTextProvider,
  TextToSpeechProvider
} from "../../packages/audio/src/index.js";
import { describe, expect, it } from "vitest";

import {
  createSyntheticPcm16Wav,
  LiveRequestBudget,
  SecretValue,
  type LiveProviderConfiguration
} from "./provider-test-harness.js";
import {
  compatibleMinimumRequestCount,
  OpenAiCompatibleQualification
} from "./openai-compatible-qualification.js";

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
    endpoint: new URL("https://compatible.example.test/v1"),
    apiKey: new SecretValue("chat-secret"),
    model: "chat-model",
    timeoutMs: 1_000,
    maxOutputTokens: 128
  },
  stt: {
    endpoint: new URL("https://speech.example.test/v1"),
    apiKey: new SecretValue("stt-secret"),
    model: "stt-model",
    language: "en",
    fixturePath: "/synthetic/check-light.wav",
    timeoutMs: 1_000
  },
  tts: {
    endpoint: new URL("https://speech.example.test/v1"),
    apiKey: new SecretValue("tts-secret"),
    model: "tts-model",
    voice: "test-voice",
    instructions: "Speak clearly.",
    responseFormat: "wav",
    timeoutMs: 1_000
  }
};

describe("OpenAiCompatibleQualification", () => {
  it("runs selected capabilities through independent provider contracts", async () => {
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
    const qualification = new OpenAiCompatibleQualification(config, budget, {
      createChat: () => new MockLlmProvider(),
      createStt: () => stt,
      createTts: () => tts,
      readAudioFixture: async () => inputAudio,
      recordEvidence: async (_provider, capability, operation) => {
        evidence.push(capability);
        return await operation();
      }
    });

    await qualification.chatDirect();
    await qualification.chatWithTools();
    await expect(qualification.transcribe()).resolves.toBe(
      "Check the light status"
    );
    await expect(qualification.synthesize()).resolves.toEqual(outputAudio);
    await expect(qualification.composedVoice()).resolves.toMatchObject({
      usedTools: ["mock.get_device_status"],
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

  it("requires only the explicitly selected capability configurations", async () => {
    const chatOnly = new OpenAiCompatibleQualification(
      { chat: config.chat },
      new LiveRequestBudget(3),
      {
        createChat: () => new MockLlmProvider(),
        createStt: () => {
          throw new Error("STT is unsupported");
        },
        createTts: () => {
          throw new Error("TTS is unsupported");
        },
        recordEvidence: async (_provider, _capability, operation) =>
          await operation()
      }
    );

    await expect(chatOnly.chatDirect()).resolves.toBeTruthy();
    await expect(chatOnly.chatWithTools()).resolves.toBeTruthy();
  });

  it("calculates exact request counts", () => {
    expect(compatibleMinimumRequestCount(["chat"])).toBe(3);
    expect(compatibleMinimumRequestCount(["stt", "tts"])).toBe(2);
    expect(
      compatibleMinimumRequestCount(["chat", "stt", "tts", "composed-voice"])
    ).toBe(9);
  });
});
