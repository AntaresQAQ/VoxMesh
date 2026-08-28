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

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

/** Generic Chat Completions adapter for OpenAI-compatible providers. */
export class OpenAiCompatibleProvider implements LlmProvider {
  public constructor(
    private readonly config: OpenAiCompatibleConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public async complete(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  }): Promise<LlmResponse> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 30_000);
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
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
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
    return compatibleUrl(this.config);
  }
}

/** Streaming Chat Completions adapter for OpenAI-compatible providers. */
export class OpenAiCompatibleStreamingProvider implements StreamingLlmProvider {
  public constructor(
    private readonly config: OpenAiCompatibleConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public stream(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal: AbortSignal;
  }): AsyncIterable<StreamingLlmEvent> {
    return streamOpenAiChatCompletion({
      url: compatibleUrl(this.config),
      headers: {
        authorization: ["Bearer", this.config.apiKey].join(" "),
        "content-type": "application/json"
      },
      providerName: "OpenAI-compatible provider",
      model: this.config.model,
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

function compatibleUrl(config: OpenAiCompatibleConfig): string {
  return `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}
