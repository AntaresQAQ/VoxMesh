import type { AgentMessage, ToolCall, ToolDefinition } from "@voxmesh/shared";

export type LlmResponse =
  | {
      type: "message";
      content: string;
    }
  | {
      type: "tool_call";
      toolCall: ToolCall & { id: string };
    };

export interface LlmProvider {
  complete(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmResponse>;
}

export interface McpServer {
  readonly name: string;
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown>;
}

export interface AgentEvent {
  category: "AGENT" | "MCP" | "ERROR";
  level: "INFO" | "WARN" | "ERROR";
  message: string;
}

export interface AgentRunResult {
  response: string;
  usedTools: string[];
  events: AgentEvent[];
  transcript: AgentMessage[];
}
