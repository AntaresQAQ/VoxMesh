import type { LlmProvider } from "@voxmesh/agent-core";
import { MockLlmProvider } from "@voxmesh/agent-core";
import { AzureOpenAiProvider, OpenAiCompatibleProvider } from "@voxmesh/ai";
import { ProviderRegistry } from "@voxmesh/shared";
import type { StoredLlmConfiguration } from "@voxmesh/storage";

const registry = new ProviderRegistry<StoredLlmConfiguration, LlmProvider>(
  (config) => config.mode
)
  .register({
    id: "mock",
    displayName: "Mock",
    capabilities: ["llm"],
    validate: () => undefined,
    create: () => new MockLlmProvider()
  })
  .register({
    id: "azure-openai",
    displayName: "Azure OpenAI",
    capabilities: ["llm"],
    validate: validateAzure,
    create: (config) =>
      new AzureOpenAiProvider({
        endpoint: config.endpoint,
        deployment: config.deployment,
        apiVersion: config.apiVersion,
        apiKey: config.apiKey ?? ""
      })
  })
  .register({
    id: "openai-compatible",
    displayName: "OpenAI-compatible",
    capabilities: ["llm"],
    validate: validateCompatible,
    create: (config) =>
      new OpenAiCompatibleProvider({
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey ?? "",
        timeoutMs: config.timeoutMs,
        maxOutputTokens: config.maxOutputTokens
      })
  });

export function createLlmProvider(config: StoredLlmConfiguration): LlmProvider {
  return registry.create(config);
}

export function validateLlmConfiguration(config: StoredLlmConfiguration): void {
  registry.create(config);
}

function validateAzure(config: StoredLlmConfiguration): void {
  requireApiKey(config);
  requireHttpsUrl(config.endpoint, "Azure OpenAI endpoint");
  if (!config.deployment || !config.apiVersion) {
    throw badRequest("Azure OpenAI requires deployment and API version");
  }
}

function validateCompatible(config: StoredLlmConfiguration): void {
  requireApiKey(config);
  requireHttpsUrl(config.baseUrl, "OpenAI-compatible base URL");
  if (!config.model) {
    throw badRequest("OpenAI-compatible providers require a model name");
  }
}

function requireApiKey(config: StoredLlmConfiguration): void {
  if (!config.apiKey) {
    throw badRequest("The selected LLM provider requires an API key");
  }
}

function requireHttpsUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw badRequest(`${label} must use HTTPS`);
  }
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}
