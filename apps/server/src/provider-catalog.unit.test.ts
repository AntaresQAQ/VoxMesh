import { describe, expect, it } from "vitest";

import { providerCatalog } from "./provider-catalog.js";

describe("providerCatalog", () => {
  it("merges LLM, STT, and TTS capabilities by provider ID", () => {
    expect(providerCatalog()).toEqual([
      {
        id: "alibaba-model-studio",
        displayName: "Alibaba Cloud Model Studio",
        capabilities: ["stt", "tts"]
      },
      {
        id: "azure-openai",
        displayName: "Azure OpenAI",
        capabilities: ["llm", "stt", "tts"]
      },
      {
        id: "mock",
        displayName: "Mock",
        capabilities: ["llm", "stt", "tts"]
      },
      {
        id: "mock-native",
        displayName: "Mock Native Multimodal",
        capabilities: [
          "native-multimodal",
          "audio-input",
          "audio-output",
          "tool-calling"
        ]
      },
      {
        id: "openai-compatible",
        displayName: "OpenAI-compatible",
        capabilities: ["llm", "stt", "tts"]
      }
    ]);
  });
});
