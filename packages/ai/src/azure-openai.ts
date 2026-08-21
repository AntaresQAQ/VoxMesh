import type { LlmProvider, LlmResponse } from "@voxmesh/agent-core";
import type { AgentMessage, ToolDefinition } from "@voxmesh/shared";

import {
  createOpenAiChatBody,
  parseOpenAiChatResponse,
  providerErrorDetail
} from "./openai-chat.js";

export interface AzureOpenAiConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

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
    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    return `${endpoint}/openai/deployments/${encodeURIComponent(
      this.config.deployment
    )}/chat/completions?api-version=${encodeURIComponent(
      this.config.apiVersion
    )}`;
  }
}
