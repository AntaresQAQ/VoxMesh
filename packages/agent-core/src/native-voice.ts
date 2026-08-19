import type { AudioData } from "@voxmesh/audio";
import type { AgentMessage, ToolCall, ToolDefinition } from "@voxmesh/shared";

import type { AgentEvent, McpServer } from "./types.js";

export type NativeVoiceProviderResponse =
  | {
      type: "tool_call";
      transcript: string;
      toolCall: ToolCall & { id: string };
    }
  | {
      type: "response";
      transcript: string;
      text: string;
      audio: AudioData;
    };

export interface NativeVoiceProvider {
  complete(input: {
    audio?: AudioData;
    messages: AgentMessage[];
    tools: ToolDefinition[];
  }): Promise<NativeVoiceProviderResponse>;
}

export interface NativeVoiceRunResult {
  transcript: string;
  response: string;
  audio: AudioData;
  usedTools: string[];
  events: AgentEvent[];
  transcriptMessages: AgentMessage[];
}

/**
 * Executes bounded tool calls for a provider that owns audio input and output.
 */
export class NativeVoiceRuntime {
  public constructor(
    private readonly provider: NativeVoiceProvider,
    private readonly mcp: McpServer,
    private readonly maxToolCalls = 3
  ) {}

  public async run(audio: AudioData): Promise<NativeVoiceRunResult> {
    const messages: AgentMessage[] = [];
    const events: AgentEvent[] = [
      {
        category: "AGENT",
        level: "INFO",
        message: "Native multimodal run started"
      }
    ];
    const usedTools: string[] = [];
    const tools = await this.mcp.listTools();

    for (let iteration = 0; iteration <= this.maxToolCalls; iteration += 1) {
      const result = await this.provider.complete({
        ...(iteration === 0 ? { audio } : {}),
        messages,
        tools
      });
      if (result.type === "response") {
        messages.push({ role: "assistant", content: result.text });
        events.push({
          category: "AGENT",
          level: "INFO",
          message: "Native multimodal run completed"
        });
        return {
          transcript: result.transcript,
          response: result.text,
          audio: result.audio,
          usedTools,
          events,
          transcriptMessages: messages
        };
      }
      if (iteration === this.maxToolCalls) {
        throw new Error("Native multimodal tool-call limit exceeded");
      }
      const tool = tools.find(
        (candidate) => candidate.name === result.toolCall.name
      );
      if (!tool) {
        throw new Error(`Unknown MCP tool: ${result.toolCall.name}`);
      }
      messages.push({
        role: "user",
        content: result.transcript
      });
      messages.push({
        role: "assistant",
        content: "",
        toolCall: result.toolCall
      });
      events.push({
        category: "MCP",
        level: "INFO",
        message: `Calling MCP tool ${tool.name}`
      });
      const toolResult = await this.mcp.callTool(
        tool.name,
        result.toolCall.arguments
      );
      usedTools.push(tool.name);
      messages.push({
        role: "tool",
        toolCallId: result.toolCall.id,
        content: JSON.stringify({ name: tool.name, result: toolResult })
      });
    }
    throw new Error("Native multimodal run ended without a response");
  }
}
