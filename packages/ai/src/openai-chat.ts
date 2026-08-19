import type { LlmResponse } from "@voxmesh/agent-core";
import type { AgentMessage, ToolDefinition } from "@voxmesh/shared";

interface OpenAiToolCall {
  id?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

interface OpenAiResponseBody {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
}

export function createOpenAiChatBody(input: {
  messages: AgentMessage[];
  tools: ToolDefinition[];
  model?: string;
}): Record<string, unknown> {
  return {
    ...(input.model ? { model: input.model } : {}),
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
  };
}

export function parseOpenAiChatResponse(
  body: unknown,
  providerName: string
): LlmResponse {
  const response = body as OpenAiResponseBody;
  const message = response.choices?.[0]?.message;
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
      throw new Error(`${providerName} returned a malformed tool call`);
    }
    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(argumentsValue) as unknown;
    } catch {
      throw new Error(`${providerName} returned invalid JSON tool arguments`);
    }
    if (!isRecord(parsedArguments)) {
      throw new Error(`${providerName} tool arguments must be an object`);
    }
    return {
      type: "tool_call",
      toolCall: { id, name, arguments: parsedArguments }
    };
  }
  if (typeof message?.content !== "string") {
    throw new Error(`${providerName} returned an empty response`);
  }
  return {
    type: "message",
    content: message.content
  };
}

export function providerErrorDetail(detail: string): string {
  return detail ? `: ${detail.slice(0, 500)}` : "";
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
  return { role: message.role, content: message.content };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
