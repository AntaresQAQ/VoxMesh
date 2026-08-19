import type { LlmProvider, LlmResponse } from "@voxmesh/agent-core";
import type { AgentMessage, ToolDefinition } from "@voxmesh/shared";

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

interface AzureToolCall {
  id?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

interface AzureResponseBody {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: AzureToolCall[];
    };
  }>;
}

export class AzureOpenAiProvider implements LlmProvider {
  public constructor(
    private readonly config: AzureOpenAiConfig,
    private readonly fetcher: Fetcher = globalThis.fetch
  ) {}

  public async complete(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmResponse> {
    const response = await this.fetcher(this.url(), {
      method: "POST",
      headers: {
        "api-key": this.config.apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messages: input.messages.map(mapMessage),
        tools: input.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema ?? {
              type: "object",
              properties: {}
            }
          }
        }))
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Azure OpenAI request failed (${response.status})${safeDetail(detail)}`
      );
    }

    const body = (await response.json()) as AzureResponseBody;
    const message = body.choices?.[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    if (toolCall) {
      const id = toolCall.id;
      const name = toolCall.function?.name;
      const argumentsValue = toolCall.function?.arguments;
      if (
        typeof id !== "string" ||
        typeof name !== "string" ||
        typeof argumentsValue !== "string"
      ) {
        throw new Error("Azure OpenAI returned a malformed tool call");
      }
      const parsedArguments = JSON.parse(argumentsValue) as unknown;
      if (!isRecord(parsedArguments)) {
        throw new Error("Azure OpenAI tool arguments must be an object");
      }
      return {
        type: "tool_call",
        toolCall: {
          id,
          name,
          arguments: parsedArguments
        }
      };
    }

    if (typeof message?.content !== "string") {
      throw new Error("Azure OpenAI returned an empty response");
    }
    return {
      type: "message",
      content: message.content
    };
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

function mapMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCall) {
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: message.toolCall.id,
          type: "function",
          function: {
            name: message.toolCall.name,
            arguments: JSON.stringify(message.toolCall.arguments)
          }
        }
      ]
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content
    };
  }
  return {
    role: message.role,
    content: message.content
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDetail(detail: string): string {
  if (!detail) {
    return "";
  }
  return `: ${detail.slice(0, 500)}`;
}
