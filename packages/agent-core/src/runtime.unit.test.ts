import { describe, expect, it } from "vitest";

import type { LlmProvider, McpServer } from "./types.js";
import { AgentRunCancelledError } from "./types.js";
import { MockLlmProvider, MockMcpServer } from "./mock.js";
import { AgentRuntime } from "./runtime.js";

describe("AgentRuntime", () => {
  it("returns a direct mock response", async () => {
    const runtime = new AgentRuntime(
      new MockLlmProvider(),
      new MockMcpServer()
    );

    const result = await runtime.run("Hello");

    expect(result.response).toBe("Mock assistant received: Hello");
    expect(result.usedTools).toEqual([]);
  });

  it("executes an MCP tool and returns the final response", async () => {
    const runtime = new AgentRuntime(
      new MockLlmProvider(),
      new MockMcpServer()
    );

    const result = await runtime.run("Check the light status");

    expect(result.response).toContain("living-room-light is on");
    expect(result.usedTools).toEqual(["mock.get_device_status"]);
    expect(result.events.some((event) => event.category === "MCP")).toBe(true);
  });

  it("rejects oversized MCP results before the follow-up LLM request", async () => {
    let completions = 0;
    const llm: LlmProvider = {
      complete: async () => {
        completions += 1;
        return {
          type: "tool_call",
          toolCall: {
            id: "large-result",
            name: "large",
            arguments: {}
          }
        };
      }
    };
    const mcp: McpServer = {
      name: "Large MCP",
      listTools: async () => [{ name: "large", description: "Large result" }],
      callTool: async () => ({ value: "x".repeat(64 * 1024) })
    };

    await expect(new AgentRuntime(llm, mcp).run("Test")).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: "MCP tool result exceeded its byte limit"
    });
    expect(completions).toBe(1);
  });

  it("normalizes provider abortion as an Agent cancellation", async () => {
    const controller = new AbortController();
    const provider: LlmProvider = {
      complete: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    };
    const runtime = new AgentRuntime(provider, new MockMcpServer());
    const pending = runtime.run("Wait", { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AgentRunCancelledError);
  });

  it("supplies durable conversation history before the new user input", async () => {
    let receivedMessages: unknown;
    const provider: LlmProvider = {
      complete: async ({ messages }) => {
        receivedMessages = messages.map((message) => ({ ...message }));
        return { type: "message", content: "Current answer" };
      }
    };
    const runtime = new AgentRuntime(provider, new MockMcpServer());

    await runtime.run("Current question", {
      history: [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" }
      ]
    });

    expect(receivedMessages).toEqual([
      { role: "user", content: "Previous question" },
      { role: "assistant", content: "Previous answer" },
      { role: "user", content: "Current question" }
    ]);
  });
});
