export type MessageRole = "user" | "assistant" | "tool";
export type LogCategory = "AGENT" | "MCP" | "AUTH" | "SYSTEM" | "ERROR";
export type LogLevel = "INFO" | "WARN" | "ERROR";
export type PipelineStage = "STT" | "AGENT" | "MCP" | "TTS";
export type PipelineStatus = "started" | "completed" | "failed" | "cancelled";

export interface AgentMessage {
  role: MessageRole;
  content: string;
  toolCall?: ToolCall & { id: string };
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}
