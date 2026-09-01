import {
  MockStreamingLlmProvider,
  type StreamingLlmProvider
} from "../../packages/agent-core/src/index.js";
import {
  MockStreamingSpeechToTextProvider,
  MockStreamingTextToSpeechProvider
} from "../../packages/audio/src/index.js";
import { describe, expect, it } from "vitest";

import {
  createSyntheticPcm16Wav,
  LiveRequestBudget,
  SecretValue,
  type LiveProviderConfiguration
} from "./provider-test-harness.js";
import {
  StreamingProviderQualification,
  streamingMinimumRequestCount
} from "./streaming-provider-qualification.js";

const config: LiveProviderConfiguration = {
  chat: {
    endpoint: new URL("https://chat.example.test/v1"),
    apiKey: new SecretValue("chat-secret"),
    model: "chat-test",
    timeoutMs: 1_000,
    maxOutputTokens: 128
  },
  stt: {
    endpoint: new URL("wss://speech.example.test/stt"),
    apiKey: new SecretValue("stt-secret"),
    model: "stt-test",
    language: "en",
    fixturePath: "/synthetic/check-light.wav",
    timeoutMs: 1_000
  },
  tts: {
    endpoint: new URL("wss://speech.example.test/tts"),
    apiKey: new SecretValue("tts-secret"),
    model: "tts-test",
    voice: "voice-test",
    responseFormat: "wav",
    timeoutMs: 1_000
  }
};

describe("StreamingProviderQualification", () => {
  it("runs every streaming scenario with exact request accounting", async () => {
    const budget = new LiveRequestBudget(9);
    const evidence: string[] = [];
    const qualification = new StreamingProviderQualification(
      "test-provider",
      "Test provider",
      config,
      budget,
      {
        createChat: (): StreamingLlmProvider =>
          new MockStreamingLlmProvider({ chunkSize: 5 }),
        createStt: () =>
          new MockStreamingSpeechToTextProvider({
            framesPerPartial: 20
          }),
        createTts: () =>
          new MockStreamingTextToSpeechProvider({
            format: {
              encoding: "pcm16le",
              sampleRate: 24_000,
              channels: 1
            }
          }),
        readAudioFixture: async () => ({
          data: createSyntheticPcm16Wav(100, 440, 16_000),
          mimeType: "audio/wav"
        }),
        recordEvidence: async (_provider, capability, operation) => {
          evidence.push(capability);
          return await operation();
        }
      }
    );

    await expect(qualification.chatDirect()).resolves.toBeTruthy();
    await expect(qualification.chatWithTools()).resolves.toBeTruthy();
    await expect(qualification.transcribe()).resolves.toBe(
      "Check the light status"
    );
    const synthesis = await qualification.synthesize();
    expect(synthesis.audioByteLength).toBeGreaterThan(0);
    expect(synthesis.durationMs).toBeGreaterThan(0);
    expect(synthesis.chunkCount).toBeGreaterThan(0);
    const composed = await qualification.composedVoice();
    expect(composed).toMatchObject({
      transcript: "Check the light status",
      usedTools: ["mock.get_device_status"]
    });
    expect(composed.audioByteLength).toBeGreaterThan(0);
    expect(evidence).toEqual([
      "streaming-chat-direct",
      "streaming-chat-tools",
      "streaming-stt",
      "streaming-tts",
      "streaming-composed-voice"
    ]);
    expect(budget.remaining).toBe(0);
  });

  it("calculates exact request counts for independent streaming selectors", () => {
    expect(streamingMinimumRequestCount(["streaming-chat"])).toBe(3);
    expect(
      streamingMinimumRequestCount([
        "streaming-stt",
        "streaming-tts",
        "streaming-composed-voice"
      ])
    ).toBe(6);
  });

  it("rejects a partial input frame before consuming request budget", async () => {
    const budget = new LiveRequestBudget(1);
    const qualification = new StreamingProviderQualification(
      "test-provider",
      "Test provider",
      { stt: config.stt },
      budget,
      {
        createChat: () => new MockStreamingLlmProvider(),
        createStt: () => new MockStreamingSpeechToTextProvider(),
        createTts: () => new MockStreamingTextToSpeechProvider(),
        readAudioFixture: async () => ({
          data: createSyntheticPcm16Wav(101, 440, 16_000),
          mimeType: "audio/wav"
        }),
        recordEvidence: async (_provider, _capability, operation) =>
          await operation()
      }
    );

    await expect(qualification.transcribe()).rejects.toThrow(
      "Streaming STT fixture must contain complete 20 ms frames within the 60-second limit"
    );
    expect(budget.remaining).toBe(1);
  });

  it("rejects synthesis when completion is not final or duration is invalid", async () => {
    const qualification = new StreamingProviderQualification(
      "test-provider",
      "Test provider",
      { tts: config.tts },
      new LiveRequestBudget(1),
      {
        createChat: () => new MockStreamingLlmProvider(),
        createStt: () => new MockStreamingSpeechToTextProvider(),
        createTts: () => ({
          startSynthesis: async () => ({
            close: async () => undefined,
            async *[Symbol.asyncIterator]() {
              yield {
                type: "completed" as const,
                sequence: 1,
                format: {
                  encoding: "pcm16le" as const,
                  sampleRate: 24_000,
                  channels: 1
                },
                audioBytes: 2,
                durationMs: 999_999
              };
              yield {
                type: "audio" as const,
                chunk: {
                  sequence: 2,
                  format: {
                    encoding: "pcm16le" as const,
                    sampleRate: 24_000,
                    channels: 1
                  },
                  data: new Uint8Array(2)
                }
              };
            }
          })
        }),
        recordEvidence: async (_provider, _capability, operation) =>
          await operation()
      }
    );

    await expect(qualification.synthesize()).rejects.toThrow(
      "Streaming TTS returned an invalid response"
    );
  });

  it("rejects transcription events emitted after the final result", async () => {
    const qualification = new StreamingProviderQualification(
      "test-provider",
      "Test provider",
      { stt: config.stt },
      new LiveRequestBudget(1),
      {
        createChat: () => new MockStreamingLlmProvider(),
        createStt: () => ({
          startSession: async () => ({
            write: async () => undefined,
            finishInput: async () => undefined,
            close: async () => undefined,
            async *[Symbol.asyncIterator]() {
              yield {
                type: "final" as const,
                sequence: 1,
                result: {
                  text: "Check the light status",
                  language: "en"
                }
              };
              yield {
                type: "partial" as const,
                sequence: 2,
                text: "late partial"
              };
            }
          })
        }),
        createTts: () => new MockStreamingTextToSpeechProvider(),
        readAudioFixture: async () => ({
          data: createSyntheticPcm16Wav(100, 440, 16_000),
          mimeType: "audio/wav"
        }),
        recordEvidence: async (_provider, _capability, operation) =>
          await operation()
      }
    );

    await expect(qualification.transcribe()).rejects.toThrow(
      "Streaming STT returned an invalid response"
    );
  });
});
