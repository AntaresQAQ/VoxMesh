import type { AgentMessage, ToolDefinition } from "@voxmesh/shared";

import {
  throwIfAgentRunCancelled,
  type StreamingLlmEvent,
  type StreamingLlmProvider
} from "./types.js";

type Delay = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export interface MockStreamingLlmOptions {
  chunkSize?: number;
  eventDelayMs?: number;
  delay?: Delay;
}

/** Deterministic Streaming LLM for direct and Mock MCP-assisted Agent tests. */
export class MockStreamingLlmProvider implements StreamingLlmProvider {
  private readonly chunkSize: number;
  private readonly eventDelayMs: number;
  private readonly delay: Delay;

  public constructor(options: MockStreamingLlmOptions = {}) {
    this.chunkSize = options.chunkSize ?? 8;
    this.eventDelayMs = options.eventDelayMs ?? 0;
    this.delay = options.delay ?? delay;
    if (!Number.isInteger(this.chunkSize) || this.chunkSize < 1) {
      throw new Error("Mock Streaming LLM chunkSize must be positive");
    }
    if (!Number.isFinite(this.eventDelayMs) || this.eventDelayMs < 0) {
      throw new Error("Mock Streaming LLM eventDelayMs must be non-negative");
    }
  }

  public async *stream(input: {
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal: AbortSignal;
  }): AsyncIterable<StreamingLlmEvent> {
    throwIfAgentRunCancelled(input.signal);
    const toolResult = [...input.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (toolResult) {
      const parsed = JSON.parse(toolResult.content) as {
        result: { device: string; state: string };
      };
      yield* this.message(
        `Mock tool reports ${parsed.result.device} is ${parsed.result.state}.`,
        input.signal
      );
      return;
    }

    const userMessage =
      [...input.messages].reverse().find((message) => message.role === "user")
        ?.content ?? "";
    if (
      input.tools.some((tool) => tool.name === "mock.get_device_status") &&
      /\b(light|device|tool|status)\b/i.test(userMessage)
    ) {
      for (const event of [
        {
          type: "tool_call_delta",
          index: 0,
          id: "mock-tool-call",
          nameDelta: "mock.get_",
          argumentsDelta: ""
        },
        {
          type: "tool_call_delta",
          index: 0,
          id: null,
          nameDelta: "device_status",
          argumentsDelta: '{"device":"living-'
        },
        {
          type: "tool_call_delta",
          index: 0,
          id: null,
          nameDelta: "",
          argumentsDelta: 'room-light"}'
        },
        {
          type: "usage",
          inputTokens: 8,
          outputTokens: 6
        },
        {
          type: "completed",
          finishReason: "tool_call"
        }
      ] satisfies StreamingLlmEvent[]) {
        await this.wait(input.signal);
        yield event;
      }
      return;
    }

    yield* this.message(
      `Mock assistant received: ${userMessage}`,
      input.signal
    );
  }

  private async *message(
    content: string,
    signal: AbortSignal
  ): AsyncGenerator<StreamingLlmEvent> {
    for (let offset = 0; offset < content.length; offset += this.chunkSize) {
      await this.wait(signal);
      yield {
        type: "text_delta",
        content: content.slice(offset, offset + this.chunkSize)
      };
    }
    await this.wait(signal);
    yield {
      type: "usage",
      inputTokens: 4,
      outputTokens: Math.max(1, Math.ceil(content.length / 4))
    };
    await this.wait(signal);
    yield { type: "completed", finishReason: "stop" };
  }

  private wait(signal: AbortSignal): Promise<void> {
    return this.delay(this.eventDelayMs, signal);
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAgentRunCancelled(signal);
  if (milliseconds === 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
