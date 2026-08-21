import type { AgentMessage } from "@voxmesh/shared";

import {
  AgentRunCancelledError,
  throwIfAgentRunCancelled,
  type AgentEvent,
  type AgentRunOptions,
  type AgentRunResult,
  type LlmProvider,
  type McpServer
} from "./types.js";

export class AgentRuntime {
  public constructor(
    private readonly llm: LlmProvider,
    private readonly mcp: McpServer,
    private readonly maxToolCalls = 3
  ) {}

  public async run(
    userMessage: string,
    options: AgentRunOptions = {}
  ): Promise<AgentRunResult> {
    const { history = [], signal } = options;
    throwIfAgentRunCancelled(signal);
    const messages: AgentMessage[] = [
      ...history,
      { role: "user", content: userMessage }
    ];
    const events: AgentEvent[] = [
      { category: "AGENT", level: "INFO", message: "Agent run started" }
    ];
    const usedTools: string[] = [];
    const tools = await this.mcp.listTools(signal);
    throwIfAgentRunCancelled(signal);

    try {
      for (let iteration = 0; iteration <= this.maxToolCalls; iteration += 1) {
        throwIfAgentRunCancelled(signal);
        const result = await this.llm.complete({
          messages,
          tools,
          ...(signal ? { signal } : {})
        });
        throwIfAgentRunCancelled(signal);

        if (result.type === "message") {
          messages.push({ role: "assistant", content: result.content });
          events.push({
            category: "AGENT",
            level: "INFO",
            message: "Agent run completed"
          });
          return {
            response: result.content,
            usedTools,
            events,
            transcript: messages
          };
        }

        if (iteration === this.maxToolCalls) {
          throw new Error("Agent tool-call limit exceeded");
        }

        const tool = tools.find(
          (candidate) => candidate.name === result.toolCall.name
        );
        if (!tool) {
          throw new Error(`Unknown MCP tool: ${result.toolCall.name}`);
        }

        events.push({
          category: "MCP",
          level: "INFO",
          message: `Calling MCP tool ${tool.name}`
        });
        messages.push({
          role: "assistant",
          content: "",
          toolCall: result.toolCall
        });
        const toolResult = await this.mcp.callTool(
          tool.name,
          result.toolCall.arguments,
          signal
        );
        throwIfAgentRunCancelled(signal);
        usedTools.push(tool.name);
        messages.push({
          role: "tool",
          toolCallId: result.toolCall.id,
          content: JSON.stringify({
            name: tool.name,
            result: toolResult
          })
        });
      }
    } catch (error) {
      if (signal?.aborted && !(error instanceof AgentRunCancelledError)) {
        throw new AgentRunCancelledError();
      }
      throw error;
    }

    throw new Error("Agent run ended without a response");
  }
}
