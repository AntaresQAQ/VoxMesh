import { describe, expect, it } from "vitest";

import type { LlmProvider } from "./types.js";
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
});
