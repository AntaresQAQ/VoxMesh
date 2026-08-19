import { describe, expect, it } from "vitest";

import { AzureOpenAiProvider, OpenAiCompatibleProvider } from "@voxmesh/ai";
import type { StoredLlmConfiguration } from "@voxmesh/storage";

import {
  createLlmProvider,
  validateLlmConfiguration
} from "./llm-providers.js";

const base: StoredLlmConfiguration = {
  mode: "mock",
  endpoint: "",
  deployment: "",
  apiVersion: "2024-10-21",
  baseUrl: "",
  model: "qwen-plus",
  timeoutMs: 30_000,
  maxOutputTokens: 1_024,
  apiKey: null
};

describe("LLM provider registry", () => {
  it("creates Azure and OpenAI-compatible providers", () => {
    expect(
      createLlmProvider({
        ...base,
        mode: "azure-openai",
        endpoint: "https://example.openai.azure.com",
        deployment: "gpt",
        apiKey: "secret"
      })
    ).toBeInstanceOf(AzureOpenAiProvider);
    expect(
      createLlmProvider({
        ...base,
        mode: "openai-compatible",
        baseUrl:
          "https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
        apiKey: "secret"
      })
    ).toBeInstanceOf(OpenAiCompatibleProvider);
  });

  it("rejects invalid compatible provider configuration", () => {
    expect(() =>
      validateLlmConfiguration({
        ...base,
        mode: "openai-compatible",
        baseUrl: "http://example.com",
        apiKey: "secret"
      })
    ).toThrow("must use HTTPS");
  });
});
