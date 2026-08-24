import { describe, expect, it, vi } from "vitest";

import type { AgentMessage, ToolDefinition } from "@voxmesh/shared";

import { MockMcpServer } from "./mock.js";
import { MockStreamingLlmProvider } from "./mock-streaming.js";
import { StreamingAgentRuntime } from "./streaming-runtime.js";
import {
  AgentRunCancelledError,
  type AgentRunResult,
  type McpServer,
  type StreamingAgentEvent,
  type StreamingLlmEvent,
  type StreamingLlmProvider
} from "./types.js";

describe("StreamingAgentRuntime", () => {
  it("streams a direct tool-disabled response as immediately speakable text", async () => {
    const mcp = new MockMcpServer();
    const listTools = vi.spyOn(mcp, "listTools");
    const runtime = new StreamingAgentRuntime(
      new MockStreamingLlmProvider({ chunkSize: 6 }),
      mcp
    );

    const run = await collectRun(
      runtime.run("Hello", {
        toolMode: "disabled",
        signal: new AbortController().signal
      })
    );

    expect(run.result.response).toBe("Mock assistant received: Hello");
    expect(
      run.events
        .filter((event) => event.type === "text_delta")
        .every((event) => event.speakable)
    ).toBe(true);
    expect(
      run.events.find((event) => event.type === "completion_finished")
    ).toMatchObject({ speakableText: null, finishReason: "stop" });
    expect(listTools).not.toHaveBeenCalled();
  });

  it("buffers tool-enabled direct text until the stop completion", async () => {
    const runtime = new StreamingAgentRuntime(
      new MockStreamingLlmProvider({ chunkSize: 5 }),
      new MockMcpServer()
    );

    const run = await collectRun(
      runtime.run("Hello", {
        toolMode: "enabled",
        signal: new AbortController().signal
      })
    );

    expect(
      run.events
        .filter((event) => event.type === "text_delta")
        .every((event) => !event.speakable)
    ).toBe(true);
    expect(
      run.events.find((event) => event.type === "completion_finished")
    ).toMatchObject({
      speakableText: "Mock assistant received: Hello",
      finishReason: "stop"
    });
  });

  it("assembles a fragmented tool call before MCP and streams the follow-up", async () => {
    const mcp = new MockMcpServer();
    const callTool = vi.spyOn(mcp, "callTool");
    const runtime = new StreamingAgentRuntime(
      new MockStreamingLlmProvider({ chunkSize: 7 }),
      mcp
    );

    const run = await collectRun(
      runtime.run("Check the light status", {
        toolMode: "enabled",
        signal: new AbortController().signal
      })
    );

    expect(callTool).toHaveBeenCalledWith(
      "mock.get_device_status",
      { device: "living-room-light" },
      expect.any(AbortSignal)
    );
    expect(run.result.response).toContain("living-room-light is on");
    expect(run.result.usedTools).toEqual(["mock.get_device_status"]);
    expect(
      run.events.filter((event) => event.type === "completion_finished")
    ).toHaveLength(2);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call_delta",
          complete: true,
          toolName: "mock.get_device_status"
        }),
        expect.objectContaining({
          type: "tool_started",
          toolName: "mock.get_device_status"
        }),
        expect.objectContaining({
          type: "tool_finished",
          success: true
        })
      ])
    );
  });

  it("passes durable history and session tool mode to the provider", async () => {
    let receivedMessages: AgentMessage[] = [];
    let receivedTools: ToolDefinition[] = [];
    const provider: StreamingLlmProvider = {
      stream: async function* ({ messages, tools }) {
        receivedMessages = messages.map((message) => ({ ...message }));
        receivedTools = tools;
        yield { type: "text_delta", content: "Answer" };
        yield { type: "completed", finishReason: "stop" };
      }
    };
    const runtime = new StreamingAgentRuntime(provider, new MockMcpServer());

    await collectRun(
      runtime.run("Current", {
        toolMode: "disabled",
        signal: new AbortController().signal,
        history: [
          { role: "user", content: "Previous" },
          { role: "assistant", content: "Earlier answer" }
        ]
      })
    );

    expect(receivedMessages).toEqual([
      { role: "user", content: "Previous" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Current" }
    ]);
    expect(receivedTools).toEqual([]);
  });

  it.each([
    {
      name: "malformed tool JSON",
      events: toolCompletion('{"device":'),
      code: "INCOMPLETE_TOOL_CALL"
    },
    {
      name: "multiple tool calls in one completion",
      events: [
        toolDelta(1, "call-2", "mock.get_device_status", "{}"),
        { type: "completed", finishReason: "tool_call" }
      ] satisfies StreamingLlmEvent[],
      code: "INVALID_STREAM_EVENT"
    },
    {
      name: "tool call while disabled",
      events: toolCompletion("{}"),
      code: "INVALID_STREAM_EVENT",
      toolMode: "disabled" as const
    },
    {
      name: "missing completion",
      events: [
        { type: "text_delta", content: "partial" }
      ] satisfies StreamingLlmEvent[],
      code: "INVALID_STREAM_EVENT"
    },
    {
      name: "event after completion",
      events: [
        { type: "completed", finishReason: "stop" },
        { type: "text_delta", content: "late" }
      ] satisfies StreamingLlmEvent[],
      code: "INVALID_STREAM_EVENT"
    },
    {
      name: "unsupported finish reason",
      events: [
        { type: "text_delta", content: "partial" },
        { type: "completed", finishReason: "length" }
      ] satisfies StreamingLlmEvent[],
      code: "UNSUPPORTED_FINISH_REASON"
    },
    {
      name: "provider failure event",
      events: [
        {
          type: "failure",
          code: "provider_failed",
          safeMessage: "Provider unavailable"
        }
      ] satisfies StreamingLlmEvent[],
      code: "PROVIDER_FAILED"
    }
  ])("rejects $name without unsafe MCP execution", async (fixture) => {
    const mcp = new MockMcpServer();
    const callTool = vi.spyOn(mcp, "callTool");
    const runtime = new StreamingAgentRuntime(
      new ScriptedStreamingLlmProvider([fixture.events]),
      mcp
    );

    await expect(
      collectRun(
        runtime.run("Test", {
          toolMode: fixture.toolMode ?? "enabled",
          signal: new AbortController().signal
        })
      )
    ).rejects.toMatchObject({ code: fixture.code });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("includes only validated safe provider failure text", async () => {
    const runtime = new StreamingAgentRuntime(
      new ScriptedStreamingLlmProvider([
        [
          {
            type: "failure",
            code: "timeout",
            safeMessage: "Provider response timed out"
          }
        ]
      ]),
      new MockMcpServer()
    );

    await expect(
      collectRun(
        runtime.run("Failure", {
          toolMode: "disabled",
          signal: new AbortController().signal
        })
      )
    ).rejects.toMatchObject({
      code: "PROVIDER_FAILED",
      message: "Streaming LLM failed: timeout: Provider response timed out"
    });
  });

  it("rejects oversized text and fragmented arguments", async () => {
    const textRuntime = new StreamingAgentRuntime(
      new ScriptedStreamingLlmProvider([
        [
          { type: "text_delta", content: "x".repeat(32_001) },
          { type: "completed", finishReason: "stop" }
        ]
      ]),
      new MockMcpServer()
    );
    await expect(
      collectRun(
        textRuntime.run("Text", {
          toolMode: "disabled",
          signal: new AbortController().signal
        })
      )
    ).rejects.toMatchObject({ code: "STREAM_LIMIT_EXCEEDED" });

    const toolRuntime = new StreamingAgentRuntime(
      new ScriptedStreamingLlmProvider([
        toolCompletion(`{"value":"${"x".repeat(32_768)}"}`)
      ]),
      new MockMcpServer()
    );
    await expect(
      collectRun(
        toolRuntime.run("Tool", {
          toolMode: "enabled",
          signal: new AbortController().signal
        })
      )
    ).rejects.toMatchObject({ code: "STREAM_LIMIT_EXCEEDED" });
  });

  it("normalizes cancellation during LLM streaming", async () => {
    const controller = new AbortController();
    const provider: StreamingLlmProvider = {
      stream: async function* ({ signal }) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
        yield { type: "completed", finishReason: "stop" };
      }
    };
    const runtime = new StreamingAgentRuntime(provider, new MockMcpServer());
    const pending = collectRun(
      runtime.run("Wait", {
        toolMode: "disabled",
        signal: controller.signal
      })
    );

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AgentRunCancelledError);
  });

  it("normalizes cancellation during tool discovery", async () => {
    const controller = new AbortController();
    const mcp: McpServer = {
      name: "Discovery MCP",
      listTools: async (signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        }),
      callTool: async () => ({})
    };
    const runtime = new StreamingAgentRuntime(
      new MockStreamingLlmProvider(),
      mcp
    );
    const pending = collectRun(
      runtime.run("Wait", {
        toolMode: "enabled",
        signal: controller.signal
      })
    );

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AgentRunCancelledError);
  });

  it("normalizes cancellation during provider shutdown", async () => {
    const controller = new AbortController();
    const provider: StreamingLlmProvider = {
      stream: async function* () {
        yield { type: "text_delta", content: "Finished" };
        yield { type: "completed", finishReason: "stop" };
        controller.abort();
      }
    };
    const runtime = new StreamingAgentRuntime(provider, new MockMcpServer());

    await expect(
      collectRun(
        runtime.run("Wait", {
          toolMode: "disabled",
          signal: controller.signal
        })
      )
    ).rejects.toBeInstanceOf(AgentRunCancelledError);
  });

  it("does not invoke MCP when cancelled while suspended at tool_started", async () => {
    const controller = new AbortController();
    const callTool = vi.fn(async () => ({ state: "on" }));
    const mcp: McpServer = {
      name: "Delayed MCP",
      listTools: async () => [
        {
          name: "mock.get_device_status",
          description: "Status"
        }
      ],
      callTool
    };
    const runtime = new StreamingAgentRuntime(
      new ScriptedStreamingLlmProvider([toolCompletion("{}")]),
      mcp
    );
    const iterator = runtime.run("Tool", {
      toolMode: "enabled",
      signal: controller.signal
    });
    const observed: StreamingAgentEvent[] = [];
    let pending: Promise<IteratorResult<StreamingAgentEvent, unknown>>;
    while (true) {
      pending = iterator.next();
      const next = await pending;
      if (next.done) throw new Error("Expected tool execution");
      observed.push(next.value);
      if (next.value.type === "tool_started") break;
    }
    controller.abort();
    pending = iterator.next();

    await expect(pending).resolves.toMatchObject({
      done: false,
      value: { type: "tool_finished", success: false }
    });
    await expect(iterator.next()).rejects.toBeInstanceOf(
      AgentRunCancelledError
    );
    expect(callTool).not.toHaveBeenCalled();
    expect(observed).toContainEqual(
      expect.objectContaining({ type: "tool_started" })
    );
  });

  it("normalizes cancellation during an active MCP call", async () => {
    const controller = new AbortController();
    let toolStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      toolStarted = resolve;
    });
    const mcp: McpServer = {
      name: "Active MCP",
      listTools: async () => [
        {
          name: "mock.get_device_status",
          description: "Status"
        }
      ],
      callTool: async (_name, _arguments, signal) =>
        new Promise((_resolve, reject) => {
          toolStarted?.();
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    };
    const runtime = new StreamingAgentRuntime(
      new ScriptedStreamingLlmProvider([toolCompletion("{}")]),
      mcp
    );
    const pending = collectRun(
      runtime.run("Tool", {
        toolMode: "enabled",
        signal: controller.signal
      })
    );

    await started;
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AgentRunCancelledError);
  });

  it("emits failed tool lifecycle for unserializable MCP results", async () => {
    const mcp: McpServer = {
      name: "Invalid MCP",
      listTools: async () => [
        {
          name: "mock.get_device_status",
          description: "Status"
        }
      ],
      callTool: async () => ({ value: 1n })
    };
    const iterator = new StreamingAgentRuntime(
      new ScriptedStreamingLlmProvider([toolCompletion("{}")]),
      mcp
    ).run("Tool", {
      toolMode: "enabled",
      signal: new AbortController().signal
    });
    while (true) {
      const next = await iterator.next();
      if (next.done) throw new Error("Expected tool execution");
      if (next.value.type === "tool_started") break;
    }

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "tool_finished", success: false }
    });
    await expect(iterator.next()).rejects.toMatchObject({
      code: "MCP_RESULT_INVALID"
    });
  });

  it("counts UTF-8 arguments correctly across split surrogate pairs", async () => {
    const prefix = '{"value":"';
    const suffix = '"}';
    const fixedBytes =
      new TextEncoder().encode(prefix).byteLength +
      new TextEncoder().encode(suffix).byteLength;
    const emojiCount = Math.floor((32_768 - fixedBytes) / 4);
    const remainder = 32_768 - fixedBytes - emojiCount * 4;
    const argumentsJson =
      prefix + "😀".repeat(emojiCount) + "x".repeat(remainder) + suffix;
    expect(new TextEncoder().encode(argumentsJson)).toHaveLength(32_768);
    const split = argumentsJson.indexOf("😀") + 1;
    const provider = new ScriptedStreamingLlmProvider([
      [
        toolDelta(
          0,
          "unicode-call",
          "mock.get_device_status",
          argumentsJson.slice(0, split)
        ),
        toolDelta(0, null, "", argumentsJson.slice(split)),
        { type: "completed", finishReason: "tool_call" }
      ],
      [
        { type: "text_delta", content: "Completed" },
        { type: "completed", finishReason: "stop" }
      ]
    ]);

    const run = await collectRun(
      new StreamingAgentRuntime(provider, new MockMcpServer()).run("Tool", {
        toolMode: "enabled",
        signal: new AbortController().signal
      })
    );

    expect(run.result.response).toBe("Completed");
    expect(run.result.usedTools).toEqual(["mock.get_device_status"]);
  });

  it("enforces the sequential tool-call limit", async () => {
    const provider = new ScriptedStreamingLlmProvider([
      toolCompletion("{}"),
      toolCompletion("{}")
    ]);
    const mcp = new MockMcpServer();
    const callTool = vi.spyOn(mcp, "callTool");
    const runtime = new StreamingAgentRuntime(provider, mcp, 1);

    await expect(
      collectRun(
        runtime.run("Tool", {
          toolMode: "enabled",
          signal: new AbortController().signal
        })
      )
    ).rejects.toThrow("tool-call limit");
    expect(callTool).toHaveBeenCalledOnce();
  });
});

class ScriptedStreamingLlmProvider implements StreamingLlmProvider {
  private call = 0;

  public constructor(private readonly scripts: StreamingLlmEvent[][]) {}

  public async *stream(): AsyncIterable<StreamingLlmEvent> {
    const script = this.scripts[this.call];
    this.call += 1;
    if (!script) throw new Error("Unexpected Streaming LLM call");
    for (const event of script) yield event;
  }
}

function toolCompletion(argumentsJson: string): StreamingLlmEvent[] {
  return [
    toolDelta(0, "mock-tool-call", "mock.get_", argumentsJson.slice(0, 5)),
    toolDelta(0, null, "device_status", argumentsJson.slice(5)),
    { type: "completed", finishReason: "tool_call" }
  ];
}

function toolDelta(
  index: number,
  id: string | null,
  nameDelta: string,
  argumentsDelta: string
): StreamingLlmEvent {
  return {
    type: "tool_call_delta",
    index,
    id,
    nameDelta,
    argumentsDelta
  };
}

async function collectRun(
  run: AsyncGenerator<StreamingAgentEvent, AgentRunResult>
): Promise<{
  events: StreamingAgentEvent[];
  result: AgentRunResult;
}> {
  const events: StreamingAgentEvent[] = [];
  while (true) {
    const next = await run.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}
