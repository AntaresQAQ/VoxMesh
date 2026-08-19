import { describe, expect, it } from "vitest";

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
});
