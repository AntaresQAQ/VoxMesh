import {
  AgentRuntime,
  AgentRunCancelledError,
  NativeVoiceRuntime,
  type LlmProvider,
  type McpServer,
  type NativeVoiceProvider
} from "@voxmesh/agent-core";
import type {
  AudioData,
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptionResult
} from "@voxmesh/audio";
import type { ConversationRun } from "@voxmesh/shared";
import type {
  StoredVoicePipelineConfiguration,
  VoxMeshStore
} from "@voxmesh/storage";

export interface ConversationResult {
  conversationId: string;
  response: string;
  usedTools: string[];
}

export interface TextConversationResult extends ConversationResult {
  runId: string;
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
    private readonly createLlm: (routeId?: string) => LlmProvider,
    private readonly createStt: (routeId?: string) => SpeechToTextProvider,
    private readonly createTts: (routeId?: string) => TextToSpeechProvider,
    private readonly createNativeVoice: (
      config: StoredVoicePipelineConfiguration
    ) => NativeVoiceProvider
  ) {}

  public startTextRun(
    runId: string,
    message: string,
    conversationId?: string
  ): ConversationRun {
    return this.store.createChatRun(runId, message, conversationId);
  }

  public startTextRetry(runId: string, retryOfRunId: string): ConversationRun {
    return this.store.createChatRetry(runId, retryOfRunId);
  }

  public async executeTextRun(
    run: ConversationRun,
    signal: AbortSignal
  ): Promise<TextConversationResult> {
    const agent = new AgentRuntime(this.createLlm(), this.mcp);
    try {
      const context = this.store.getChatContext(run.id);
      const result = await agent.run(context.inputMessage, {
        history: context.history,
        signal
      });
      const finalized = this.store.completeChatRun({
        runId: run.id,
        messages: result.transcript
          .slice(context.history.length + 1)
          .filter((entry) => !entry.toolCall)
          .map((entry) => ({ role: entry.role, content: entry.content })),
        events: result.events
      });
      if (!finalized.transitioned) {
        if (finalized.run.status === "cancelled") {
          throw new AgentRunCancelledError();
        }
        throw new Error(
          `Conversation run ended as ${finalized.run.status} before completion`
        );
      }
      return {
        runId: run.id,
        conversationId: run.conversationId,
        response: result.response,
        usedTools: result.usedTools
      };
    } catch (error) {
      if (signal.aborted || error instanceof AgentRunCancelledError) {
        this.store.cancelChatRun(run.id);
        throw new AgentRunCancelledError();
      }
      const message =
        error instanceof Error ? error.message : "Agent run failed";
      this.store.failChatRun(run.id, "AGENT_FAILED", message);
      throw error;
    }
  }

  public async runVoice(audio: AudioData): Promise<VoiceConversationResult> {
    const pipeline = this.store.getRuntimeVoicePipelineConfiguration();
    if (pipeline.mode === "native-multimodal") {
      try {
        return await this.runNativeVoice(audio, pipeline);
      } catch (error) {
        if (!pipeline.fallbackRouteId) throw error;
        return this.runComposedVoice(
          audio,
          pipeline.fallbackRouteId,
          `Fallback activated after Native route ${pipeline.routeId ?? "unknown"} failed`
        );
      }
    }
    return this.runComposedVoice(audio, pipeline.routeId);
  }

  private async runComposedVoice(
    audio: AudioData,
    routeId?: string,
    fallbackMessage?: string
  ): Promise<VoiceConversationResult> {
    const conversationId =
      this.store.createPendingConversation("Voice request");
    let transcription: TranscriptionResult;
    try {
      transcription = await this.createStt(routeId).transcribe(audio);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "STT transcription failed";
      this.store.addLog({
        category: "ERROR",
        level: "ERROR",
        message,
        conversationId
      });
      this.store.addPipelineEvent({
        conversationId,
        stage: "STT",
        status: "failed",
        message
      });
      throw error;
    }
    this.store.addMessage(conversationId, "user", transcription.text);
    this.store.updateConversationTitle(conversationId, transcription.text);
    this.store.addPipelineEvent({
      conversationId,
      stage: "STT",
      status: "completed",
      message: `Transcribed ${audio.mimeType} audio as ${transcription.language}`
    });
    if (fallbackMessage) {
      this.store.addPipelineEvent({
        conversationId,
        stage: "AGENT",
        status: "completed",
        message: fallbackMessage
      });
    }

    const agentResult = await this.runAgent(
      conversationId,
      transcription.text,
      routeId
    );
    try {
      const synthesized = await this.createTts(routeId).synthesize(
        agentResult.response
      );
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

  private async runNativeVoice(
    audio: AudioData,
    pipeline: StoredVoicePipelineConfiguration
  ): Promise<VoiceConversationResult> {
    const runtime = new NativeVoiceRuntime(
      this.createNativeVoice(pipeline),
      this.mcp
    );
    const result = await runtime.run(audio);
    const conversationId = this.store.createConversation(result.transcript);
    this.store.addPipelineEvent({
      conversationId,
      stage: "AGENT",
      status: "completed",
      message: `Native multimodal input accepted by ${pipeline.nativeProviderId}`
    });
    for (const message of result.transcriptMessages.filter(
      (entry) => entry.role !== "user" && !entry.toolCall
    )) {
      this.store.addMessage(conversationId, message.role, message.content);
    }
    for (const event of result.events) {
      this.store.addLog({ ...event, conversationId });
      this.store.addPipelineEvent({
        conversationId,
        stage: event.category === "MCP" ? "MCP" : "AGENT",
        status: "completed",
        message: event.message
      });
    }
    this.store.addPipelineEvent({
      conversationId,
      stage: "AGENT",
      status: "completed",
      message: `Native multimodal audio output produced by ${pipeline.nativeProviderId}`
    });
    return {
      conversationId,
      transcript: result.transcript,
      response: result.response,
      usedTools: result.usedTools,
      audio: result.audio
    };
  }

  private async runAgent(
    conversationId: string,
    message: string,
    routeId?: string
  ): Promise<ConversationResult> {
    const agent = new AgentRuntime(this.createLlm(routeId), this.mcp);
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
