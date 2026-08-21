import type { ToolDefinition } from "@voxmesh/shared";

import type { LlmProvider, LlmResponse, McpServer } from "./types.js";
import { throwIfAgentRunCancelled } from "./types.js";

const MOCK_TOOLS: ToolDefinition[] = [
  {
    name: "mock.get_device_status",
    description: "Return the status of a simulated smart-home device",
    inputSchema: {
      type: "object",
      properties: {
        device: { type: "string" }
      }
    }
  }
];

export class MockMcpServer implements McpServer {
  public readonly name = "Mock MCP";

  public async listTools(signal?: AbortSignal): Promise<ToolDefinition[]> {
    throwIfAgentRunCancelled(signal);
    return MOCK_TOOLS;
  }

  public async callTool(
    name: string,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    throwIfAgentRunCancelled(signal);
    if (name !== "mock.get_device_status") {
      throw new Error(`Unknown mock tool: ${name}`);
    }

    const device =
      typeof arguments_.device === "string"
        ? arguments_.device
        : "living-room-light";
    return {
      device,
      state: "on",
      source: "mock"
    };
  }
}

export class MockLlmProvider implements LlmProvider {
  public async complete(input: {
    messages: Parameters<LlmProvider["complete"]>[0]["messages"];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  }): Promise<LlmResponse> {
    throwIfAgentRunCancelled(input.signal);
    const toolResult = [...input.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (toolResult) {
      const parsed = JSON.parse(toolResult.content) as {
        result: { device: string; state: string };
      };
      return {
        type: "message",
        content: `Mock tool reports ${parsed.result.device} is ${parsed.result.state}.`
      };
    }

    const userMessage =
      [...input.messages].reverse().find((message) => message.role === "user")
        ?.content ?? "";
    if (/\b(light|device|tool|status)\b/i.test(userMessage)) {
      return {
        type: "tool_call",
        toolCall: {
          id: "mock-tool-call",
          name: "mock.get_device_status",
          arguments: {
            device: "living-room-light"
          }
        }
      };
    }

    return {
      type: "message",
      content: `Mock assistant received: ${userMessage}`
    };
  }
}
