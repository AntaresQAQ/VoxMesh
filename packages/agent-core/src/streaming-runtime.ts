import type { AgentMessage, ToolCall, ToolDefinition } from "@voxmesh/shared";
import { VOICE_STREAM_LIMITS } from "@voxmesh/shared/voice-stream";

import {
  AgentRunCancelledError,
  StreamingAgentError,
  throwIfAgentRunCancelled,
  type AgentEvent,
  type AgentRunResult,
  type McpServer,
  type StreamingAgentEvent,
  type StreamingAgentRunOptions,
  type StreamingLlmEvent,
  type StreamingLlmFinishReason,
  type StreamingLlmProvider
} from "./types.js";

interface CompletionResult {
  finishReason: StreamingLlmFinishReason;
  text: string;
  toolCall: (ToolCall & { id: string }) | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
}

/**
 * Provider-independent Streaming Agent state machine.
 *
 * One provider completion may contain at most one sequential tool call. The
 * runtime validates the complete fragmented call before invoking MCP.
 */
export class StreamingAgentRuntime {
  public constructor(
    private readonly llm: StreamingLlmProvider,
    private readonly mcp: McpServer,
    private readonly maxToolCalls: number = VOICE_STREAM_LIMITS.maxToolCalls
  ) {}

  public async *run(
    userMessage: string,
    options: StreamingAgentRunOptions
  ): AsyncGenerator<StreamingAgentEvent, AgentRunResult> {
    const { signal, toolMode, history = [] } = options;
    throwIfAgentRunCancelled(signal);
    const messages: AgentMessage[] = [
      ...history,
      { role: "user", content: userMessage }
    ];
    const events: AgentEvent[] = [
      { category: "AGENT", level: "INFO", message: "Agent run started" }
    ];
    const usedTools: string[] = [];

    try {
      const tools =
        toolMode === "enabled" ? await this.mcp.listTools(signal) : [];
      throwIfAgentRunCancelled(signal);
      for (
        let completionIndex = 0;
        completionIndex <= this.maxToolCalls;
        completionIndex += 1
      ) {
        const completion = yield* this.consumeCompletion(
          completionIndex,
          messages,
          tools,
          toolMode,
          signal
        );
        throwIfAgentRunCancelled(signal);
        yield {
          type: "completion_finished",
          completionIndex,
          finishReason: completion.finishReason,
          text: completion.text,
          speakableText:
            completion.finishReason === "stop" && toolMode === "enabled"
              ? completion.text
              : null,
          usage: completion.usage
        };
        throwIfAgentRunCancelled(signal);

        if (completion.finishReason === "stop") {
          messages.push({ role: "assistant", content: completion.text });
          events.push({
            category: "AGENT",
            level: "INFO",
            message: "Agent run completed"
          });
          return {
            response: completion.text,
            usedTools,
            events,
            transcript: messages
          };
        }

        if (completion.finishReason !== "tool_call") {
          throw new StreamingAgentError(
            "UNSUPPORTED_FINISH_REASON",
            `Streaming LLM ended with ${completion.finishReason}`
          );
        }
        if (!completion.toolCall) {
          throw new StreamingAgentError(
            "INCOMPLETE_TOOL_CALL",
            "Streaming LLM did not complete its tool call"
          );
        }
        if (completionIndex === this.maxToolCalls) {
          throw new Error("Agent tool-call limit exceeded");
        }
        const tool = findTool(tools, completion.toolCall.name);
        events.push({
          category: "MCP",
          level: "INFO",
          message: `Calling MCP tool ${tool.name}`
        });
        yield {
          type: "tool_started",
          completionIndex,
          toolCallId: completion.toolCall.id,
          toolName: tool.name
        };
        let toolResultContent: string;
        try {
          throwIfAgentRunCancelled(signal);
          const toolResult = await this.mcp.callTool(
            tool.name,
            completion.toolCall.arguments,
            signal
          );
          throwIfAgentRunCancelled(signal);
          toolResultContent = serializeToolResult(tool.name, toolResult);
        } catch (error) {
          yield {
            type: "tool_finished",
            completionIndex,
            toolCallId: completion.toolCall.id,
            toolName: tool.name,
            success: false
          };
          throw error;
        }
        usedTools.push(tool.name);
        messages.push({
          role: "assistant",
          content: "",
          toolCall: completion.toolCall
        });
        messages.push({
          role: "tool",
          toolCallId: completion.toolCall.id,
          content: toolResultContent
        });
        yield {
          type: "tool_finished",
          completionIndex,
          toolCallId: completion.toolCall.id,
          toolName: tool.name,
          success: true
        };
      }
    } catch (error) {
      if (signal.aborted && !(error instanceof AgentRunCancelledError)) {
        throw new AgentRunCancelledError();
      }
      throw error;
    }

    throw new Error("Streaming Agent run ended without a response");
  }

  private async *consumeCompletion(
    completionIndex: number,
    messages: AgentMessage[],
    tools: ToolDefinition[],
    toolMode: StreamingAgentRunOptions["toolMode"],
    signal: AbortSignal
  ): AsyncGenerator<StreamingAgentEvent, CompletionResult> {
    const assembler = new ToolCallAssembler();
    let text = "";
    let usage: CompletionResult["usage"] = null;
    let finishReason: StreamingLlmFinishReason | null = null;
    let eventCount = 0;

    for await (const event of this.llm.stream({
      messages,
      tools,
      signal
    })) {
      throwIfAgentRunCancelled(signal);
      eventCount += 1;
      if (
        eventCount >
        VOICE_STREAM_LIMITS.maxAssistantCharacters +
          VOICE_STREAM_LIMITS.maxToolArgumentsBytes +
          1_024
      ) {
        throw new StreamingAgentError(
          "STREAM_LIMIT_EXCEEDED",
          "Streaming LLM emitted too many events"
        );
      }
      if (finishReason !== null) {
        throw new StreamingAgentError(
          "INVALID_STREAM_EVENT",
          "Streaming LLM emitted an event after completion"
        );
      }
      switch (event.type) {
        case "text_delta":
          if (event.content.length === 0) {
            throw invalidEvent("Streaming LLM emitted an empty text delta");
          }
          text += event.content;
          if (text.length > VOICE_STREAM_LIMITS.maxAssistantCharacters) {
            throw new StreamingAgentError(
              "STREAM_LIMIT_EXCEEDED",
              "Streaming assistant text exceeded its limit"
            );
          }
          yield {
            type: "text_delta",
            completionIndex,
            delta: event.content,
            speakable: toolMode === "disabled"
          };
          break;
        case "tool_call_delta": {
          if (toolMode === "disabled") {
            throw invalidEvent(
              "Streaming LLM emitted a tool call while tools were disabled"
            );
          }
          const progress = assembler.apply(event);
          yield {
            type: "tool_call_delta",
            completionIndex,
            toolCallIndex: event.index,
            toolName: progress.toolName,
            argumentsBytes: progress.argumentsBytes,
            complete: false
          };
          break;
        }
        case "usage":
          validateUsage(event);
          if (usage !== null) {
            throw invalidEvent("Streaming LLM emitted duplicate usage");
          }
          usage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens
          };
          yield { type: "usage", completionIndex, ...usage };
          break;
        case "completed":
          finishReason = event.finishReason;
          break;
        case "failure":
          if (
            event.safeMessage.length === 0 ||
            event.safeMessage.length > 512
          ) {
            throw invalidEvent("Streaming LLM failure message is invalid");
          }
          throw new StreamingAgentError(
            "PROVIDER_FAILED",
            `Streaming LLM failed: ${event.code}: ${event.safeMessage}`
          );
        default:
          throw invalidEvent("Streaming LLM emitted an unknown event");
      }
    }

    if (finishReason === null) {
      throw invalidEvent("Streaming LLM ended without a completed event");
    }
    const toolCall = finishReason === "tool_call" ? assembler.complete() : null;
    if (finishReason === "stop" && assembler.hasFragments) {
      throw invalidEvent("A stop completion contained tool-call fragments");
    }
    if (toolCall) {
      yield {
        type: "tool_call_delta",
        completionIndex,
        toolCallIndex: 0,
        toolName: toolCall.name,
        argumentsBytes: assembler.argumentsBytes,
        complete: true
      };
    }
    return { finishReason, text, toolCall, usage };
  }
}

class ToolCallAssembler {
  private id: string | null = null;
  private name = "";
  private argumentsJson = "";
  private argumentsByteCount = 0;
  private pendingHighSurrogate = false;
  private seen = false;

  public get hasFragments(): boolean {
    return this.seen;
  }

  public get argumentsBytes(): number {
    return this.argumentsByteCount;
  }

  public apply(
    event: Extract<StreamingLlmEvent, { type: "tool_call_delta" }>
  ): { toolName: string | null; argumentsBytes: number } {
    if (!Number.isInteger(event.index) || event.index !== 0) {
      throw invalidEvent(
        "Streaming Agent supports one sequential tool call per completion"
      );
    }
    if (
      event.id === null &&
      event.nameDelta.length === 0 &&
      event.argumentsDelta.length === 0
    ) {
      throw invalidEvent("Streaming tool-call delta was empty");
    }
    this.seen = true;
    if (event.id !== null) {
      if (event.id.length === 0 || event.id.length > 256) {
        throw invalidEvent("Streaming tool-call ID is invalid");
      }
      if (this.id !== null && this.id !== event.id) {
        throw invalidEvent("Streaming tool-call ID changed");
      }
      this.id = event.id;
    }
    this.name += event.nameDelta;
    if (this.name.length > 256) {
      throw new StreamingAgentError(
        "STREAM_LIMIT_EXCEEDED",
        "Streaming tool name exceeded its limit"
      );
    }
    this.argumentsJson += event.argumentsDelta;
    const counted = countUtf8Fragment(
      event.argumentsDelta,
      this.pendingHighSurrogate
    );
    this.argumentsByteCount += counted.bytes;
    this.pendingHighSurrogate = counted.pendingHighSurrogate;
    if (this.argumentsBytes > VOICE_STREAM_LIMITS.maxToolArgumentsBytes) {
      throw new StreamingAgentError(
        "STREAM_LIMIT_EXCEEDED",
        "Streaming tool arguments exceeded their limit"
      );
    }
    return {
      toolName: this.name.length > 0 ? this.name : null,
      argumentsBytes: this.argumentsBytes
    };
  }

  public complete(): ToolCall & { id: string } {
    if (!this.seen || !this.id || this.name.length === 0) {
      throw new StreamingAgentError(
        "INCOMPLETE_TOOL_CALL",
        "Streaming tool call was incomplete"
      );
    }
    if (this.pendingHighSurrogate) {
      this.argumentsByteCount += 3;
      this.pendingHighSurrogate = false;
      if (this.argumentsByteCount > VOICE_STREAM_LIMITS.maxToolArgumentsBytes) {
        throw new StreamingAgentError(
          "STREAM_LIMIT_EXCEEDED",
          "Streaming tool arguments exceeded their limit"
        );
      }
    }
    let arguments_: unknown;
    try {
      arguments_ = JSON.parse(this.argumentsJson);
    } catch {
      throw new StreamingAgentError(
        "INCOMPLETE_TOOL_CALL",
        "Streaming tool arguments were not valid JSON"
      );
    }
    if (
      arguments_ === null ||
      typeof arguments_ !== "object" ||
      Array.isArray(arguments_)
    ) {
      throw new StreamingAgentError(
        "INCOMPLETE_TOOL_CALL",
        "Streaming tool arguments must be an object"
      );
    }
    return {
      id: this.id,
      name: this.name,
      arguments: arguments_ as Record<string, unknown>
    };
  }
}

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
  return tool;
}

function validateUsage(
  event: Extract<StreamingLlmEvent, { type: "usage" }>
): void {
  if (
    !Number.isInteger(event.inputTokens) ||
    event.inputTokens < 0 ||
    !Number.isInteger(event.outputTokens) ||
    event.outputTokens < 0
  ) {
    throw invalidEvent("Streaming LLM usage is invalid");
  }
}

function invalidEvent(message: string): StreamingAgentError {
  return new StreamingAgentError("INVALID_STREAM_EVENT", message);
}

function serializeToolResult(toolName: string, result: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify({ name: toolName, result });
    if (typeof serialized !== "string") throw new Error("No JSON result");
  } catch (error) {
    throw new StreamingAgentError(
      "MCP_RESULT_INVALID",
      "MCP tool result could not be serialized",
      { cause: error }
    );
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
    VOICE_STREAM_LIMITS.maxMcpResultBytes
  ) {
    throw new StreamingAgentError(
      "STREAM_LIMIT_EXCEEDED",
      "MCP tool result exceeded its byte limit"
    );
  }
  return serialized;
}

function countUtf8Fragment(
  fragment: string,
  pendingHighSurrogate: boolean
): { bytes: number; pendingHighSurrogate: boolean } {
  let bytes = 0;
  let index = 0;
  if (pendingHighSurrogate) {
    if (fragment.length === 0) {
      return { bytes, pendingHighSurrogate: true };
    }
    const first = fragment.charCodeAt(0);
    if (first >= 0xdc00 && first <= 0xdfff) {
      bytes += 4;
      index = 1;
    } else {
      bytes += 3;
    }
    pendingHighSurrogate = false;
  }
  while (index < fragment.length) {
    const code = fragment.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
      index += 1;
      continue;
    }
    if (code <= 0x7ff) {
      bytes += 2;
      index += 1;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= fragment.length) {
        pendingHighSurrogate = true;
        index += 1;
        continue;
      }
      const next = fragment.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 2;
        continue;
      }
    }
    bytes += 3;
    index += 1;
  }
  return { bytes, pendingHighSurrogate };
}
