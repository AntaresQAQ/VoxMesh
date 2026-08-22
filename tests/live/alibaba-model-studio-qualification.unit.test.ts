import { MockLlmProvider } from "../../packages/agent-core/src/index.js";
import type {
  SpeechToTextProvider,
  TextToSpeechProvider
} from "../../packages/audio/src/index.js";
import { describe, expect, it } from "vitest";

import {
  AlibabaModelStudioQualification,
  alibabaMinimumRequestCount
} from "./alibaba-model-studio-qualification.js";
import {
  createSyntheticPcm16Wav,
  LiveRequestBudget,
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
    endpoint: new URL("https://workspace.example.test/compatible-mode/v1"),
    apiKey: new SecretValue("chat-secret"),
    model: "qwen-test",
    timeoutMs: 1_000,
    maxOutputTokens: 128
  },
  stt: {
    endpoint: new URL("wss://workspace.example.test/api-ws/v1/inference"),
    apiKey: new SecretValue("stt-secret"),
    model: "fun-asr-test",
    language: "en",
    fixturePath: "/synthetic/check-light.wav",
    timeoutMs: 1_000
  },
  tts: {
    endpoint: new URL("wss://workspace.example.test/api-ws/v1/inference"),
    apiKey: new SecretValue("tts-secret"),
    model: "qwen-tts-test",
    voice: "test-voice",
    instructions: "Speak clearly.",
    responseFormat: "wav",
    timeoutMs: 1_000
  }
};

describe("AlibabaModelStudioQualification", () => {
  it("runs dedicated speech and composed scenarios through bounded contracts", async () => {
    const budget = new LiveRequestBudget(6);
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
    const qualification = new AlibabaModelStudioQualification(config, budget, {
      createChat: () => new MockLlmProvider(),
      createStt: () => stt,
      createTts: () => tts,
      readAudioFixture: async () => inputAudio,
      recordEvidence: async (_provider, capability, operation) => {
        evidence.push(capability);
        return await operation();
      }
    });

    await expect(qualification.transcribe()).resolves.toBe(
      "Check the light status"
    );
    await expect(qualification.synthesize()).resolves.toEqual(outputAudio);
    await expect(qualification.composedVoice()).resolves.toMatchObject({
      usedTools: ["mock.get_device_status"],
      audioByteLength: outputAudio.data.byteLength
    });
    expect(evidence).toEqual(["stt", "tts", "composed-voice"]);
    expect(budget.remaining).toBe(0);
  });

  it("supports speech-only qualification without Chat configuration", async () => {
    const qualification = new AlibabaModelStudioQualification(
      { stt: config.stt },
      new LiveRequestBudget(1),
      {
        createChat: () => {
          throw new Error("Chat must not be created");
        },
        createStt: () => ({
          transcribe: async () => ({
            text: "Check the light status",
            language: "en"
          })
        }),
        createTts: () => {
          throw new Error("TTS must not be created");
        },
        readAudioFixture: async () => inputAudio,
        recordEvidence: async (_provider, _capability, operation) =>
          await operation()
      }
    );

    await expect(qualification.transcribe()).resolves.toBe(
      "Check the light status"
    );
  });

  it("calculates the exact six-request Alibaba matrix", () => {
    expect(alibabaMinimumRequestCount(["stt", "tts"])).toBe(2);
    expect(alibabaMinimumRequestCount(["stt", "tts", "composed-voice"])).toBe(
      6
    );
  });
});
