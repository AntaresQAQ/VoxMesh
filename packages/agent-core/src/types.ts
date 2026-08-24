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
    signal?: AbortSignal;
  }): Promise<LlmResponse>;
}

export type StreamingLlmFinishReason =
  "stop" | "tool_call" | "length" | "content_filter" | "other";

export type StreamingLlmEvent =
  | {
      type: "text_delta";
      content: string;
    }
  | {
      type: "tool_call_delta";
      index: number;
      id: string | null;
      nameDelta: string;
      argumentsDelta: string;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
    }
  | {
      type: "completed";
      finishReason: StreamingLlmFinishReason;
    };

/**
 * Provider-independent Streaming Chat contract.
 *
 * Provider adapters own SSE or vendor protocol parsing. Agent Core receives
 * only typed deltas and a single completed event.
 */
export interface StreamingLlmProvider {
  stream(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal: AbortSignal;
  }): AsyncIterable<StreamingLlmEvent>;
}

export interface McpServer {
  readonly name: string;
  listTools(signal?: AbortSignal): Promise<ToolDefinition[]>;
  callTool(
    name: string,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown>;
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

/** Context and cancellation controls for one provider-independent Agent run. */
export interface AgentRunOptions {
  signal?: AbortSignal;
  /**
   * Durable user and final assistant messages that precede the new input.
   * Tool-call transcripts remain scoped to their original run.
   */
  history?: AgentMessage[];
}

export class AgentRunCancelledError extends Error {
  public readonly code = "RUN_CANCELLED";

  public constructor() {
    super("Agent run cancelled");
    this.name = "AgentRunCancelledError";
  }
}

export function throwIfAgentRunCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AgentRunCancelledError();
}
