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

export type StreamingLlmFailureCode =
  "provider_failed" | "timeout" | "content_filter" | "invalid_response";

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
    }
  | {
      type: "failure";
      code: StreamingLlmFailureCode;
      /** Provider-normalized safe text; never a raw response body or payload. */
      safeMessage: string;
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

export type StreamingAgentErrorCode =
  | "INVALID_STREAM_EVENT"
  | "STREAM_LIMIT_EXCEEDED"
  | "INCOMPLETE_TOOL_CALL"
  | "UNSUPPORTED_FINISH_REASON"
  | "PROVIDER_FAILED"
  | "MCP_RESULT_INVALID";

export class StreamingAgentError extends Error {
  public constructor(
    public readonly code: StreamingAgentErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "StreamingAgentError";
  }
}

export type StreamingAgentEvent =
  | {
      type: "text_delta";
      completionIndex: number;
      delta: string;
      speakable: boolean;
    }
  | {
      type: "tool_call_delta";
      completionIndex: number;
      toolCallIndex: number;
      toolName: string | null;
      argumentsBytes: number;
      complete: boolean;
    }
  | {
      type: "tool_started";
      completionIndex: number;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: "tool_finished";
      completionIndex: number;
      toolCallId: string;
      toolName: string;
      success: boolean;
    }
  | {
      type: "usage";
      completionIndex: number;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      type: "completion_finished";
      completionIndex: number;
      finishReason: StreamingLlmFinishReason;
      text: string;
      speakableText: string | null;
      usage: {
        inputTokens: number;
        outputTokens: number;
      } | null;
    };

export interface StreamingAgentRunOptions {
  toolMode: "enabled" | "disabled";
  signal: AbortSignal;
  history?: AgentMessage[];
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
