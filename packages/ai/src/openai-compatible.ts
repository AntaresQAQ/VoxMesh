import type { LlmProvider, LlmResponse } from "@voxmesh/agent-core";
import type { AgentMessage, ToolDefinition } from "@voxmesh/shared";

import {
  createOpenAiChatBody,
  parseOpenAiChatResponse,
  providerErrorDetail
} from "./openai-chat.js";

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

/** Generic Chat Completions adapter for OpenAI-compatible providers. */
export class OpenAiCompatibleProvider implements LlmProvider {
  public constructor(
    private readonly config: OpenAiCompatibleConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public async complete(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmResponse> {
    const response = await this.fetcher(this.url(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ...createOpenAiChatBody({ ...input, model: this.config.model }),
        ...(this.config.maxOutputTokens
          ? { max_tokens: this.config.maxOutputTokens }
          : {})
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `OpenAI-compatible request failed (${response.status})${providerErrorDetail(
          detail
        )}`
      );
    }
    return parseOpenAiChatResponse(
      (await response.json()) as unknown,
      "OpenAI-compatible provider"
    );
  }

  private url(): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }
}
