import {
  NativeVoiceRuntime,
  StreamingAgentRuntime,
  type LlmProvider,
  type McpServer,
  type StreamingLlmProvider
} from "@voxmesh/agent-core";
import type {
  StreamingSpeechToTextProvider,
  StreamingTextToSpeechProvider
} from "@voxmesh/audio";
import type { RuntimeRoutingSummary } from "@voxmesh/shared";
import { VOICE_STREAM_LIMITS } from "@voxmesh/shared/voice-stream";
import type {
  StoredLlmConfiguration,
  StoredSpeechConfiguration,
  VoxMeshStore
} from "@voxmesh/storage";

import { createNativeVoiceProvider } from "./native-voice-providers.js";
import { safeProviderReadinessError } from "./provider-readiness.js";
import {
  createSpeechToTextProvider,
  createTextToSpeechProvider
} from "./speech-providers.js";
import {
  createStreamingLlmProvider,
  createStreamingSpeechToTextProvider,
  createStreamingTextToSpeechProvider
} from "./streaming-voice-providers.js";

type ReadinessTest = ReturnType<VoxMeshStore["beginRuntimeRouteReadinessTest"]>;
type RuntimeRole = "stt" | "chat" | "tts" | "native";

export interface StreamingProviderFactories {
  createStt(
    configuration: StoredSpeechConfiguration
  ): StreamingSpeechToTextProvider;
  createChat(configuration: StoredLlmConfiguration): StreamingLlmProvider;
  createTts(
    configuration: StoredSpeechConfiguration
  ): StreamingTextToSpeechProvider;
}

const defaultStreamingFactories: StreamingProviderFactories = {
  createStt: createStreamingSpeechToTextProvider,
  createChat: createStreamingLlmProvider,
  createTts: createStreamingTextToSpeechProvider
};

/** Executes explicit route qualification and owns readiness transitions. */
export class RuntimeRouteTester {
  public constructor(
    private readonly store: VoxMeshStore,
    private readonly mcp: McpServer,
    private readonly createLlm: (routeId?: string) => LlmProvider,
    private readonly streamingFactories: StreamingProviderFactories = defaultStreamingFactories,
    private readonly streamingVerificationTimeoutMs: number = VOICE_STREAM_LIMITS.providerStageTimeoutMs
  ) {
    if (
      !Number.isFinite(streamingVerificationTimeoutMs) ||
      streamingVerificationTimeoutMs <= 0
    ) {
      throw new Error("Streaming verification timeout must be positive");
    }
  }

  public async test(routeId: string): Promise<RuntimeRoutingSummary> {
    const route = this.store.getRuntimeRoute(routeId);
    const verification = this.store.captureRuntimeRouteVerification(route.id);
    const readinessTest =
      this.store.beginRuntimeRouteReadinessTest(verification);
    try {
      if (route.mode === "composed") {
        await this.testComposed(readinessTest);
      } else {
        await this.testConnection(readinessTest, "native", async () => {
          const pipeline = this.store.getRuntimeVoiceRouteConfiguration(
            route.id
          );
          await new NativeVoiceRuntime(
            createNativeVoiceProvider(pipeline),
            this.mcp
          ).run({
            data: new Uint8Array([1]),
            mimeType: "audio/wav"
          });
        });
      }
      this.store.markRuntimeRouteReadinessReady(readinessTest);
      return this.store.getRuntimeRoutingSummary();
    } catch (error) {
      const safeError = safeProviderReadinessError(error);
      this.store.markRuntimeRouteReadinessFailed(readinessTest, safeError);
      throw requestError(safeError.message, statusCode(error));
    }
  }

  private async testComposed(test: ReadinessTest): Promise<void> {
    const speechConfiguration = this.store.getRuntimeSpeechConfiguration(
      test.routeId
    );
    await this.testConnection(test, "chat", async () => {
      const llmProvider = this.createLlm(test.routeId);
      const result = await llmProvider.complete({
        messages: [
          {
            role: "user",
            content:
              "Reply with a short confirmation that the connection works."
          }
        ],
        tools: []
      });
      if (result.type !== "message") {
        throw requestError("Chat model returned an unexpected tool call", 400);
      }
      const diagnosticTool = (await this.mcp.listTools())[0];
      if (!diagnosticTool) {
        throw requestError(
          "No MCP tool is available for tool-calling verification",
          400
        );
      }
      const toolPrompt = `Call the ${diagnosticTool.name} tool exactly once to verify tool calling.`;
      const toolResult = await llmProvider.complete({
        messages: [{ role: "user", content: toolPrompt }],
        tools: [diagnosticTool]
      });
      if (
        toolResult.type !== "tool_call" ||
        toolResult.toolCall.name !== diagnosticTool.name
      ) {
        throw requestError(
          `Chat model did not return the ${diagnosticTool.name} tool call`,
          400
        );
      }
      const mcpResult = await this.mcp.callTool(
        toolResult.toolCall.name,
        toolResult.toolCall.arguments
      );
      const finalResult = await llmProvider.complete({
        messages: [
          { role: "user", content: toolPrompt },
          {
            role: "assistant",
            content: "",
            toolCall: toolResult.toolCall
          },
          {
            role: "tool",
            content: JSON.stringify({
              name: toolResult.toolCall.name,
              result: mcpResult
            }),
            toolCallId: toolResult.toolCall.id
          }
        ],
        tools: [diagnosticTool]
      });
      if (finalResult.type !== "message") {
        throw requestError(
          "Chat model did not complete after the test tool call",
          400
        );
      }
      if (streamingEnabled(test, "chat")) {
        await this.testStreamingChat(test.routeId);
      }
    });

    const sampleText =
      speechConfiguration.sttLanguage === "zh"
        ? "语音连接测试成功。"
        : "Speech connection test succeeded.";
    const audio = await this.testConnection(test, "tts", async () => {
      const result =
        await createTextToSpeechProvider(speechConfiguration).synthesize(
          sampleText
        );
      if (streamingEnabled(test, "tts")) {
        await this.verifyStreaming((signal) =>
          testStreamingTts(
            this.streamingFactories.createTts(speechConfiguration),
            sampleText,
            signal
          )
        );
      }
      return result;
    });
    await this.testConnection(test, "stt", async () => {
      await createSpeechToTextProvider(speechConfiguration).transcribe(audio);
      if (streamingEnabled(test, "stt")) {
        await this.verifyStreaming((signal) =>
          testStreamingStt(
            this.streamingFactories.createStt(speechConfiguration),
            signal
          )
        );
      }
    });
  }

  private async testStreamingChat(routeId: string): Promise<void> {
    await this.verifyStreaming(async (signal) => {
      const runtime = new StreamingAgentRuntime(
        this.streamingFactories.createChat(
          this.store.getRuntimeLlmConfiguration(routeId)
        ),
        this.mcp
      );
      const run = runtime.run(
        "Reply with a short confirmation that streaming works.",
        {
          toolMode: "disabled",
          signal
        }
      );
      while (true) {
        const next = await run.next();
        if (!next.done) continue;
        if (!next.value.response.trim()) {
          throw requestError("Streaming Chat returned empty text", 400);
        }
        return;
      }
    });
  }

  private async verifyStreaming<T>(
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutError = new DOMException(
      "Streaming verification timed out",
      "TimeoutError"
    );
    let rejectTimeout: (error: Error) => void = () => undefined;
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, this.streamingVerificationTimeoutMs);
    try {
      return await Promise.race([operation(controller.signal), timeoutFailure]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async testConnection<T>(
    test: ReadinessTest,
    role: RuntimeRole,
    operation: () => Promise<T>
  ): Promise<T> {
    this.store.beginRuntimeConnectionReadinessTest(test, role);
    try {
      const result = await operation();
      this.store.markRuntimeConnectionReadinessReady(test, role);
      return result;
    } catch (error) {
      this.store.markRuntimeConnectionReadinessFailed(
        test,
        role,
        safeProviderReadinessError(error)
      );
      throw error;
    }
  }
}

async function testStreamingStt(
  provider: StreamingSpeechToTextProvider,
  signal: AbortSignal
): Promise<void> {
  const session = await provider.startSession({
    format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
    signal
  });
  await session.close();
}

async function testStreamingTts(
  provider: StreamingTextToSpeechProvider,
  text: string,
  signal: AbortSignal
): Promise<void> {
  const session = await provider.startSynthesis({
    text,
    signal
  });
  let audioSeen = false;
  let completed = false;
  try {
    for await (const event of session) {
      if (event.type === "audio") audioSeen = true;
      if (event.type === "completed") completed = true;
    }
  } finally {
    await session.close();
  }
  if (!audioSeen || !completed) {
    throw requestError("Streaming TTS returned incomplete audio", 400);
  }
}

function streamingEnabled(
  test: ReadinessTest,
  role: "stt" | "chat" | "tts"
): boolean {
  return (
    test.snapshot.assignments.find((assignment) => assignment.role === role)
      ?.streamingEnabled ?? false
  );
}

function statusCode(error: unknown): number {
  return error instanceof Error &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
    ? error.statusCode
    : 500;
}

function requestError(message: string, code: number): Error {
  return Object.assign(new Error(message), { statusCode: code });
}
