import type {
  LlmProvider,
  LlmResponse,
  StreamingLlmEvent,
  StreamingLlmProvider
} from "@voxmesh/agent-core";
import type { AgentMessage, ToolDefinition } from "@voxmesh/shared";

import {
  createOpenAiChatBody,
  parseOpenAiChatResponse,
  providerErrorDetail
} from "./openai-chat.js";
import {
  streamOpenAiChatCompletion,
  type Fetcher
} from "./openai-streaming-chat.js";

export interface AzureOpenAiConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export class AzureOpenAiProvider implements LlmProvider {
  public constructor(
    private readonly config: AzureOpenAiConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public async complete(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  }): Promise<LlmResponse> {
    const response = await this.fetcher(this.url(), {
      method: "POST",
      headers: {
        "api-key": this.config.apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify(createOpenAiChatBody(input)),
      ...(input.signal ? { signal: input.signal } : {})
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Azure OpenAI request failed (${response.status})${providerErrorDetail(
          detail
        )}`
      );
    }

    return parseOpenAiChatResponse(
      (await response.json()) as unknown,
      "Azure OpenAI"
    );
  }

  private url(): string {
    return azureUrl(this.config);
  }
}

/** Streaming Chat Completions adapter for Azure OpenAI deployments. */
export class AzureOpenAiStreamingProvider implements StreamingLlmProvider {
  public constructor(
    private readonly config: AzureOpenAiConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public stream(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal: AbortSignal;
  }): AsyncIterable<StreamingLlmEvent> {
    return streamOpenAiChatCompletion({
      url: azureUrl(this.config),
      headers: {
        "api-key": this.config.apiKey,
        "content-type": "application/json"
      },
      providerName: "Azure OpenAI",
      ...(this.config.timeoutMs === undefined
        ? {}
        : { timeoutMs: this.config.timeoutMs }),
      ...(this.config.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: this.config.maxOutputTokens }),
      ...input,
      fetcher: this.fetcher
    });
  }
}

function azureUrl(config: AzureOpenAiConfig): string {
  const endpoint = config.endpoint.replace(/\/+$/, "");
  return `${endpoint}/openai/deployments/${encodeURIComponent(
    config.deployment
  )}/chat/completions?api-version=${encodeURIComponent(config.apiVersion)}`;
}
