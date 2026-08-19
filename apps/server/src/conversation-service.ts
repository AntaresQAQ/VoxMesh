import {
  AgentRuntime,
  type LlmProvider,
  type McpServer
} from "@voxmesh/agent-core";
import type {
  AudioData,
  SpeechToTextProvider,
  TextToSpeechProvider
} from "@voxmesh/audio";
import type { VoxMeshStore } from "@voxmesh/storage";

export interface ConversationResult {
  conversationId: string;
  response: string;
  usedTools: string[];
}

export interface VoiceConversationResult extends ConversationResult {
  transcript: string;
  audio: AudioData;
}

/**
 * Coordinates persistence and provider-independent conversation execution.
 *
 * HTTP routes depend on this service rather than duplicating Agent Core,
 * pipeline-event, and transcript persistence behavior.
 */
export class ConversationService {
  public constructor(
    private readonly store: VoxMeshStore,
    private readonly mcp: McpServer,
    private readonly createLlm: () => LlmProvider,
    private readonly stt: SpeechToTextProvider,
    private readonly tts: TextToSpeechProvider
  ) {}

  public async runText(message: string): Promise<ConversationResult> {
    const conversationId = this.store.createConversation(message);
    return this.runAgent(conversationId, message);
  }

  public async runVoice(audio: AudioData): Promise<VoiceConversationResult> {
    const transcription = await this.stt.transcribe(audio);
    const conversationId = this.store.createConversation(transcription.text);
    this.store.addPipelineEvent({
      conversationId,
      stage: "STT",
      status: "completed",
      message: `Transcribed ${audio.mimeType} audio as ${transcription.language}`
    });

    const agentResult = await this.runAgent(conversationId, transcription.text);
    try {
      const synthesized = await this.tts.synthesize(agentResult.response);
      this.store.addPipelineEvent({
        conversationId,
        stage: "TTS",
        status: "completed",
        message: `Synthesized ${synthesized.mimeType} audio`
      });
      return {
        ...agentResult,
        transcript: transcription.text,
        audio: synthesized
      };
    } catch (error) {
      this.store.addPipelineEvent({
        conversationId,
        stage: "TTS",
        status: "failed",
        message: error instanceof Error ? error.message : "TTS failed"
      });
      throw error;
    }
  }

  private async runAgent(
    conversationId: string,
    message: string
  ): Promise<ConversationResult> {
    const agent = new AgentRuntime(this.createLlm(), this.mcp);
    try {
      const result = await agent.run(message);
      for (const transcriptMessage of result.transcript
        .slice(1)
        .filter((entry) => !entry.toolCall)) {
        this.store.addMessage(
          conversationId,
          transcriptMessage.role,
          transcriptMessage.content
        );
      }
      for (const event of result.events) {
        this.store.addLog({
          ...event,
          conversationId
        });
        this.store.addPipelineEvent({
          conversationId,
          stage: event.category === "MCP" ? "MCP" : "AGENT",
          status: "completed",
          message: event.message
        });
      }
      return {
        conversationId,
        response: result.response,
        usedTools: result.usedTools
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Agent run failed";
      this.store.addLog({
        category: "ERROR",
        level: "ERROR",
        message,
        conversationId
      });
      this.store.addPipelineEvent({
        conversationId,
        stage: "AGENT",
        status: "failed",
        message
      });
      throw error;
    }
  }
}
