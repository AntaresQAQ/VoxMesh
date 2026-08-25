import {
  AgentRunCancelledError,
  AgentRuntime,
  StreamingAgentRuntime,
  StreamingTtsSegmenter,
  type AgentRunResult,
  type LlmProvider,
  type McpServer,
  type StreamingAgentEvent,
  type StreamingLlmProvider
} from "@voxmesh/agent-core";
import {
  decodePcm16Wav,
  encodePcm16Wav,
  type SpeechToTextProvider,
  type StreamingAudioChunk,
  type StreamingAudioFormat,
  type StreamingSpeechToTextProvider,
  type StreamingSynthesisEvent,
  type StreamingTranscriptionEvent,
  type StreamingTextToSpeechProvider,
  type TextToSpeechProvider,
  type TranscriptionResult
} from "@voxmesh/audio";
import {
  BoundedAsyncQueue,
  VOICE_STREAM_BINARY_HEADER_BYTES,
  VOICE_STREAM_LIMITS,
  type VoiceStreamPcmFormat
} from "@voxmesh/shared";
import type { RuntimeVoiceRouteSnapshot, VoxMeshStore } from "@voxmesh/storage";

export type StreamingVoiceCoordinatorEvent =
  | {
      type: "stage";
      stage: "STT" | "AGENT" | "TTS";
      status: "started" | "completed";
      durationMs: number | null;
      message: string;
    }
  | {
      type: "transcript_partial";
      sequence: number;
      text: string;
    }
  | {
      type: "transcript_final";
      sequence: number;
      transcript: string;
      language: string;
    }
  | {
      type: "agent";
      event: StreamingAgentEvent;
    }
  | {
      type: "audio";
      chunk: StreamingAudioChunk;
    }
  | {
      type: "segment_started";
      segmentIndex: number;
      text: string;
      format: VoiceStreamPcmFormat;
    }
  | {
      type: "segment_finished";
      segmentIndex: number;
    }
  | {
      type: "audio_completed";
      segments: number;
      audioBytes: number;
      durationMs: number;
    };

export interface StreamingVoiceCoordinatorResult {
  runId: string;
  conversationId: string;
  transcript: string;
  response: string;
  usedTools: string[];
  audioBytes: number;
  audioDurationMs: number;
}

export type StreamingVoiceCoordinatorErrorCode =
  "STT_FAILED" | "AGENT_FAILED" | "TTS_FAILED";

export class StreamingVoiceCoordinatorError extends Error {
  public constructor(
    public readonly code: StreamingVoiceCoordinatorErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "StreamingVoiceCoordinatorError";
  }
}

export interface StreamingVoiceCoordinatorProviders {
  bufferedStt: SpeechToTextProvider;
  streamingStt: StreamingSpeechToTextProvider;
  bufferedLlm: LlmProvider;
  streamingLlm: StreamingLlmProvider;
  bufferedTts: TextToSpeechProvider;
  streamingTts: StreamingTextToSpeechProvider;
}

export interface StreamingVoiceRunPreparation {
  route: RuntimeVoiceRouteSnapshot;
  providers: StreamingVoiceCoordinatorProviders;
}

export interface StreamingVoiceCoordinatorInput {
  runId: string;
  preparation: StreamingVoiceRunPreparation;
  format: StreamingAudioFormat;
  audio: AsyncIterable<StreamingAudioChunk>;
  toolMode: "enabled" | "disabled";
  signal: AbortSignal;
}

type ResolvedStreamingVoiceCoordinatorInput = Omit<
  StreamingVoiceCoordinatorInput,
  "preparation"
> & {
  route: RuntimeVoiceRouteSnapshot;
  providers: StreamingVoiceCoordinatorProviders;
};

/**
 * Coordinates one provider-independent Composed streaming voice run.
 *
 * Partial transcript, Agent deltas, and audio chunks are emitted only through
 * the returned iterator. Storage receives the safe route snapshot, aggregate
 * lifecycle metrics, and final user/assistant messages.
 */
export class StreamingVoiceCoordinator {
  public constructor(
    private readonly store: VoxMeshStore,
    private readonly mcp: McpServer
  ) {}

  public run(
    input: StreamingVoiceCoordinatorInput
  ): AsyncGenerator<
    StreamingVoiceCoordinatorEvent,
    StreamingVoiceCoordinatorResult
  > {
    const localAbort = new AbortController();
    const signal = AbortSignal.any([input.signal, localAbort.signal]);
    const events = new BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>(
      {
        maxItems: 4_096,
        maxBytes: VOICE_STREAM_LIMITS.maxOutputQueueBytes,
        maxDurationMs: VOICE_STREAM_LIMITS.maxOutputQueueDurationMs
      },
      measureCoordinatorEvent
    );
    const execution = this.execute(input, signal, events).then(
      (result) => {
        events.close();
        return result;
      },
      (error: unknown) => {
        events.fail(error);
        throw error;
      }
    );
    return {
      next: async () => {
        try {
          const event = await events.dequeue({ signal: localAbort.signal });
          if (event !== null) {
            return { done: false, value: event };
          }
          return { done: true, value: await execution };
        } catch {
          return { done: true, value: await execution };
        }
      },
      return: async (
        value:
          | StreamingVoiceCoordinatorResult
          | PromiseLike<StreamingVoiceCoordinatorResult>
      ) => {
        localAbort.abort();
        await execution.catch(() => undefined);
        return {
          done: true,
          value: await value
        };
      },
      throw: async (error?: unknown) => {
        localAbort.abort();
        await execution.catch(() => undefined);
        throw asError(error);
      },
      [Symbol.asyncIterator]() {
        return this;
      }
    };
  }

  private async execute(
    input: StreamingVoiceCoordinatorInput,
    signal: AbortSignal,
    events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>
  ): Promise<StreamingVoiceCoordinatorResult> {
    validateCoordinatorInput(input);
    const resolved: ResolvedStreamingVoiceCoordinatorInput = {
      ...input,
      route: input.preparation.route,
      providers: input.preparation.providers
    };
    const run = this.store.createVoiceRun(input.runId, resolved.route);
    let stage: "STT" | "AGENT" | "TTS" = "STT";
    let pressureStage: "STT" | "AGENT" | "TTS" = "STT";
    let pressureOrigin: "STT" | "AGENT" | "TTS" | null = null;
    const unsubscribePressure = events.subscribePressure((pressure) => {
      if (pressure === "high" && pressureOrigin === null) {
        pressureOrigin = pressureStage;
        this.store.addLog({
          conversationId: run.conversationId,
          category: "SYSTEM",
          level: "WARN",
          message: `${pressureOrigin} output queue entered high pressure`
        });
      } else if (pressure === "normal" && pressureOrigin !== null) {
        const recoveredStage = pressureOrigin;
        pressureOrigin = null;
        this.store.addLog({
          conversationId: run.conversationId,
          category: "SYSTEM",
          level: "INFO",
          message: `${recoveredStage} output queue pressure recovered`
        });
      }
    });
    try {
      const transcription = await this.runStt(
        resolved,
        run.conversationId,
        run.correlationId,
        signal,
        events
      );
      stage = "AGENT";
      pressureStage = "AGENT";
      const agentAndTts = await this.runAgentAndTts(
        resolved,
        transcription.result.text,
        run.conversationId,
        run.correlationId,
        signal,
        events,
        () => {
          stage = "TTS";
          pressureStage = "TTS";
        }
      );
      stage = "TTS";
      throwIfAborted(signal);
      const finalized = this.store.completeVoiceRun({
        runId: run.id,
        transcript: transcription.result.text,
        response: agentAndTts.agent.response,
        events: agentAndTts.agent.events
      });
      if (!finalized.transitioned) {
        if (finalized.run.status === "cancelled") {
          throw new AgentRunCancelledError();
        }
        throw new Error(
          `Streaming voice run ended as ${finalized.run.status} before completion`
        );
      }
      return {
        runId: run.id,
        conversationId: run.conversationId,
        transcript: transcription.result.text,
        response: agentAndTts.agent.response,
        usedTools: agentAndTts.agent.usedTools,
        audioBytes: agentAndTts.audio.audioBytes,
        audioDurationMs: agentAndTts.audio.durationMs
      };
    } catch (error) {
      if (signal.aborted || error instanceof AgentRunCancelledError) {
        const cancelled = this.store.cancelVoiceRun(run.id);
        if (cancelled.transitioned) {
          this.store.addPipelineEvent({
            conversationId: run.conversationId,
            runId: run.id,
            correlationId: run.correlationId,
            stage,
            status: "cancelled",
            message: `Streaming ${stage} stage cancelled`
          });
        }
        throw new AgentRunCancelledError();
      }
      const failedStage =
        error instanceof StreamingVoiceStageError ? error.stage : stage;
      const safeMessage = `Streaming ${failedStage} stage failed`;
      this.store.addPipelineEvent({
        conversationId: run.conversationId,
        runId: run.id,
        correlationId: run.correlationId,
        stage: failedStage,
        status: "failed",
        message: safeMessage
      });
      this.store.failVoiceRun(run.id, `${failedStage}_FAILED`, safeMessage);
      throw new StreamingVoiceCoordinatorError(
        `${failedStage}_FAILED`,
        safeMessage,
        {
          cause: error instanceof StreamingVoiceStageError ? error.cause : error
        }
      );
    } finally {
      unsubscribePressure();
    }
  }

  private async runStt(
    input: ResolvedStreamingVoiceCoordinatorInput,
    conversationId: string,
    correlationId: string,
    signal: AbortSignal,
    events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>
  ): Promise<{
    result: TranscriptionResult;
    frames: number;
    audioBytes: number;
    finalSequence: number;
  }> {
    const startedAt = Date.now();
    await emit(events, signal, {
      type: "stage",
      stage: "STT",
      status: "started",
      durationMs: null,
      message: "STT stage started"
    });
    const streaming = role(input.route, "stt").streamingEnabled;
    const result = streaming
      ? await consumeStreamingStt(input, signal, events)
      : await consumeBufferedStt(input, signal);
    validateTranscriptionResult(result.result);
    const durationMs = Date.now() - startedAt;
    const message = `STT completed with ${result.frames} frames and ${result.audioBytes} audio bytes`;
    this.store.addPipelineEvent({
      conversationId,
      runId: input.runId,
      correlationId,
      stage: "STT",
      status: "completed",
      durationMs,
      message
    });
    await emit(events, signal, {
      type: "transcript_final",
      sequence: result.finalSequence,
      transcript: result.result.text,
      language: result.result.language
    });
    await emit(events, signal, {
      type: "stage",
      stage: "STT",
      status: "completed",
      durationMs,
      message
    });
    return result;
  }

  private async runAgentAndTts(
    input: ResolvedStreamingVoiceCoordinatorInput,
    transcript: string,
    conversationId: string,
    correlationId: string,
    signal: AbortSignal,
    events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>,
    onTtsStarted: () => void
  ): Promise<{
    agent: AgentRunResult;
    audio: { segments: number; audioBytes: number; durationMs: number };
  }> {
    const agentStartedAt = Date.now();
    this.store.addPipelineEvent({
      conversationId,
      runId: input.runId,
      correlationId,
      stage: "AGENT",
      status: "started",
      message: "Streaming Agent stage started"
    });
    await emit(events, signal, {
      type: "stage",
      stage: "AGENT",
      status: "started",
      durationMs: null,
      message: "Agent stage started"
    });
    const chatStreaming = role(input.route, "chat").streamingEnabled;
    const ttsStreaming = role(input.route, "tts").streamingEnabled;
    const stageAbort = new AbortController();
    const stageSignal = AbortSignal.any([signal, stageAbort.signal]);
    let ttsStartedAt: number | undefined;
    const startTtsStage = async () => {
      if (ttsStartedAt !== undefined) return;
      ttsStartedAt = Date.now();
      onTtsStarted();
      this.store.addPipelineEvent({
        conversationId,
        runId: input.runId,
        correlationId,
        stage: "TTS",
        status: "started",
        message: "TTS stage started"
      });
      try {
        await emit(events, stageSignal, {
          type: "stage",
          stage: "TTS",
          status: "started",
          durationMs: null,
          message: "TTS stage started"
        });
      } catch (error) {
        throw new StreamingVoiceStageError("TTS", error);
      }
    };
    let segmenter: StreamingTtsSegmenter | undefined;
    let streamingAudio:
      | Promise<{ segments: number; audioBytes: number; durationMs: number }>
      | undefined;
    if (chatStreaming && ttsStreaming) {
      await startTtsStage();
      segmenter = new StreamingTtsSegmenter({ signal: stageSignal });
      streamingAudio = synthesizeSegments(
        segmenter,
        input.providers.streamingTts,
        stageSignal,
        events
      );
      void streamingAudio.catch(() => undefined);
    }
    const rawAgentExecution = chatStreaming
      ? consumeStreamingAgent(
          transcript,
          input,
          this.mcp,
          stageSignal,
          events,
          segmenter
        )
      : new AgentRuntime(
          input.providers.bufferedLlm,
          input.toolMode === "enabled" ? this.mcp : disabledMcp
        ).run(transcript, { signal: stageSignal });
    let agentFailure: unknown;
    const agentExecution = withOperationTimeout(
      rawAgentExecution,
      stageSignal,
      VOICE_STREAM_LIMITS.providerStageTimeoutMs,
      stageAbort
    ).catch((error: unknown) => {
      agentFailure = error;
      throw error;
    });
    void agentExecution.catch(() => undefined);
    let agent: AgentRunResult;
    try {
      agent = streamingAudio
        ? await Promise.race([
            agentExecution,
            streamingAudio.then(
              () => new Promise<never>(() => undefined),
              (error: unknown) => {
                throw new StreamingVoiceStageError("TTS", error);
              }
            )
          ])
        : await agentExecution;
      if (segmenter) {
        try {
          await segmenter.finish(agent.response);
        } catch (error) {
          throw new StreamingVoiceStageError("TTS", error);
        }
      }
    } catch (error) {
      stageAbort.abort();
      segmenter?.cancel();
      await streamingAudio?.catch(() => undefined);
      if (
        ttsStartedAt !== undefined &&
        !signal.aborted &&
        !(error instanceof StreamingVoiceStageError && error.stage === "TTS")
      ) {
        this.store.addPipelineEvent({
          conversationId,
          runId: input.runId,
          correlationId,
          stage: "TTS",
          status: "cancelled",
          message: "TTS stage cancelled before completion"
        });
      }
      if (error instanceof StreamingVoiceStageError) {
        throw error;
      }
      if (agentFailure !== undefined) {
        throw new StreamingVoiceStageError("AGENT", agentFailure);
      }
      throw error;
    }
    validateAssistantResponse(agent.response);
    if (!chatStreaming) {
      await emit(events, stageSignal, {
        type: "agent",
        event: {
          type: "completion_finished",
          completionIndex: 0,
          finishReason: "stop",
          text: agent.response,
          speakableText: agent.response,
          usage: null
        }
      });
    }
    const agentDurationMs = Date.now() - agentStartedAt;
    const agentMessage = `Agent completed with ${agent.usedTools.length} tool calls`;
    this.store.addPipelineEvent({
      conversationId,
      runId: input.runId,
      correlationId,
      stage: "AGENT",
      status: "completed",
      durationMs: agentDurationMs,
      message: agentMessage
    });
    await emit(events, signal, {
      type: "stage",
      stage: "AGENT",
      status: "completed",
      durationMs: agentDurationMs,
      message: agentMessage
    });

    await startTtsStage();
    let resolvedAudio: {
      segments: number;
      audioBytes: number;
      durationMs: number;
    };
    try {
      const audio = ttsStreaming
        ? (streamingAudio ??
          synthesizeSegments(
            bufferedSegments(agent.response),
            input.providers.streamingTts,
            signal,
            events
          ))
        : await synthesizeBufferedText(
            agent.response,
            input.providers.bufferedTts,
            signal,
            events
          );
      resolvedAudio = await audio;
    } catch (error) {
      throw error instanceof StreamingVoiceStageError
        ? error
        : new StreamingVoiceStageError("TTS", error);
    }
    const ttsDurationMs = Date.now() - (ttsStartedAt ?? Date.now());
    const ttsMessage = `TTS completed with ${resolvedAudio.audioBytes} audio bytes over ${resolvedAudio.durationMs} ms`;
    this.store.addPipelineEvent({
      conversationId,
      runId: input.runId,
      correlationId,
      stage: "TTS",
      status: "completed",
      durationMs: ttsDurationMs,
      message: ttsMessage
    });
    await emit(events, signal, {
      type: "audio_completed",
      ...resolvedAudio
    });
    await emit(events, signal, {
      type: "stage",
      stage: "TTS",
      status: "completed",
      durationMs: ttsDurationMs,
      message: ttsMessage
    });
    return { agent, audio: resolvedAudio };
  }
}

async function consumeStreamingStt(
  input: ResolvedStreamingVoiceCoordinatorInput,
  signal: AbortSignal,
  events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>
): Promise<{
  result: TranscriptionResult;
  frames: number;
  audioBytes: number;
  finalSequence: number;
}> {
  const providerAbort = new AbortController();
  const providerSignal = AbortSignal.any([signal, providerAbort.signal]);
  const session = await withOperationTimeout(
    input.providers.streamingStt.startSession({
      format: input.format,
      signal: providerSignal
    }),
    providerSignal,
    VOICE_STREAM_LIMITS.providerStageTimeoutMs,
    providerAbort
  );
  let providerIterator: AsyncIterator<StreamingTranscriptionEvent> | undefined;
  let inputIterator: AsyncIterator<StreamingAudioChunk> | undefined;
  let final: { result: TranscriptionResult; sequence: number } | undefined;
  let inputFinished = false;
  let expectedEventSequence = 1;
  let frames = 0;
  let audioBytes = 0;
  let consume: Promise<void> | undefined;
  try {
    providerIterator = session[Symbol.asyncIterator]();
    inputIterator = input.audio[Symbol.asyncIterator]();
    consume = (async () => {
      while (true) {
        const next = await withOperationTimeout(
          providerIterator.next(),
          providerSignal,
          VOICE_STREAM_LIMITS.providerStageTimeoutMs,
          providerAbort
        );
        if (next.done) break;
        const event = next.value;
        if (event.sequence !== expectedEventSequence) {
          throw new Error("Streaming STT emitted an invalid event sequence");
        }
        expectedEventSequence += 1;
        if (final) {
          throw new Error(
            "Streaming STT emitted an event after its final result"
          );
        }
        if (event.type === "partial") {
          if (
            event.text.length === 0 ||
            event.text.length > VOICE_STREAM_LIMITS.maxTranscriptCharacters
          ) {
            throw new Error("Streaming STT partial text is invalid");
          }
          await emit(events, signal, {
            type: "transcript_partial",
            sequence: event.sequence,
            text: event.text
          });
        } else if (event.type === "final") {
          if (!inputFinished) {
            throw new Error(
              "Streaming STT emitted its final result before input finished"
            );
          }
          final = { result: event.result, sequence: event.sequence };
        } else {
          throw new Error("Streaming STT emitted an unknown event");
        }
      }
      if (!inputFinished) {
        throw new Error("Streaming STT ended before input was finished");
      }
    })();
  } catch (error) {
    providerAbort.abort();
    await settleWithTimeout(session.close());
    throw error;
  }
  const providerEnded = consume.then(
    () => {
      if (!inputFinished) {
        throw new Error("Streaming STT ended before input was finished");
      }
      return new Promise<never>(() => undefined);
    },
    (error: unknown) => Promise.reject(asError(error))
  );
  void providerEnded.catch(() => undefined);
  try {
    let expectedInputSequence = 1;
    while (true) {
      const next = await Promise.race([
        withOperationTimeout(
          inputIterator.next(),
          providerSignal,
          VOICE_STREAM_LIMITS.inputIdleTimeoutMs,
          providerAbort
        ),
        providerEnded
      ]);
      if (next.done) break;
      const chunk = next.value;
      validateAudioChunk(chunk, input.format, expectedInputSequence);
      expectedInputSequence += 1;
      frames += 1;
      audioBytes += chunk.data.byteLength;
      enforceCaptureLimits(audioBytes, input.format);
      await Promise.race([
        withOperationTimeout(
          session.write(chunk),
          providerSignal,
          VOICE_STREAM_LIMITS.providerStageTimeoutMs,
          providerAbort
        ),
        providerEnded
      ]);
    }
    if (frames === 0) {
      throw new Error("Streaming voice requires at least one audio frame");
    }
    inputFinished = true;
    await Promise.race([
      withOperationTimeout(
        session.finishInput(),
        providerSignal,
        VOICE_STREAM_LIMITS.providerStageTimeoutMs,
        providerAbort
      ),
      providerEnded
    ]);
    await consume;
    if (!final) {
      throw new Error("Streaming STT ended without a final transcript");
    }
    return {
      result: final.result,
      frames,
      audioBytes,
      finalSequence: final.sequence
    };
  } finally {
    providerAbort.abort();
    if (inputIterator?.return) {
      await settleWithTimeout(Promise.resolve(inputIterator.return()));
    }
    await settleWithTimeout(session.close());
    await consume?.catch(() => undefined);
  }
}

async function consumeBufferedStt(
  input: ResolvedStreamingVoiceCoordinatorInput,
  signal: AbortSignal
): Promise<{
  result: TranscriptionResult;
  frames: number;
  audioBytes: number;
  finalSequence: number;
}> {
  const chunks: Uint8Array[] = [];
  const providerAbort = new AbortController();
  const providerSignal = AbortSignal.any([signal, providerAbort.signal]);
  const inputIterator = input.audio[Symbol.asyncIterator]();
  let expectedSequence = 1;
  let audioBytes = 0;
  try {
    while (true) {
      const next = await withOperationTimeout(
        inputIterator.next(),
        providerSignal,
        VOICE_STREAM_LIMITS.inputIdleTimeoutMs,
        providerAbort
      );
      if (next.done) break;
      const chunk = next.value;
      validateAudioChunk(chunk, input.format, expectedSequence);
      expectedSequence += 1;
      audioBytes += chunk.data.byteLength;
      enforceCaptureLimits(audioBytes, input.format);
      chunks.push(chunk.data);
    }
    if (chunks.length === 0) {
      throw new Error("Streaming voice requires at least one audio frame");
    }
    const result = await withOperationTimeout(
      input.providers.bufferedStt.transcribe(
        {
          data: encodePcm16Wav({
            channels: input.format.channels,
            sampleRate: input.format.sampleRate,
            pcm: concatenate(chunks, audioBytes)
          }),
          mimeType: "audio/wav",
          sampleRate: input.format.sampleRate,
          channels: input.format.channels
        },
        { signal: providerSignal }
      ),
      providerSignal,
      VOICE_STREAM_LIMITS.providerStageTimeoutMs,
      providerAbort
    );
    throwIfAborted(signal);
    return {
      result,
      frames: chunks.length,
      audioBytes,
      finalSequence: 1
    };
  } finally {
    providerAbort.abort();
    if (inputIterator.return) {
      await settleWithTimeout(Promise.resolve(inputIterator.return()));
    }
  }
}

async function consumeStreamingAgent(
  transcript: string,
  input: ResolvedStreamingVoiceCoordinatorInput,
  mcp: McpServer,
  signal: AbortSignal,
  events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>,
  segmenter?: StreamingTtsSegmenter
): Promise<AgentRunResult> {
  const run = new StreamingAgentRuntime(
    input.providers.streamingLlm,
    input.toolMode === "enabled" ? mcp : disabledMcp
  ).run(transcript, { signal, toolMode: input.toolMode });
  const iterator = run[Symbol.asyncIterator]();
  let completed = false;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        completed = true;
        return next.value;
      }
      await emit(events, signal, { type: "agent", event: next.value });
      if (segmenter) {
        try {
          await segmenter.accept(next.value);
        } catch (error) {
          throw new StreamingVoiceStageError("TTS", error);
        }
      }
    }
  } finally {
    if (!completed && iterator.throw) {
      await settleWithTimeout(iterator.throw(new AgentRunCancelledError()));
    }
  }
}

async function synthesizeSegments(
  segments: AsyncIterable<{ text: string }>,
  provider: StreamingTextToSpeechProvider,
  signal: AbortSignal,
  events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>
): Promise<{ segments: number; audioBytes: number; durationMs: number }> {
  const totals = { audioBytes: 0, durationMs: 0 };
  let sequence = 1;
  let segmentCount = 0;
  for await (const segment of segments) {
    for (const text of splitProtocolSegments(segment.text)) {
      const result = await synthesizeStreamingText(
        text,
        provider,
        signal,
        events,
        sequence,
        segmentCount,
        totals
      );
      sequence = result.nextSequence;
      segmentCount += 1;
      if (segmentCount > 10_000) {
        throw new Error("Streaming TTS segment count exceeds its limit");
      }
    }
  }
  return { segments: segmentCount, ...totals };
}

async function synthesizeStreamingText(
  text: string,
  provider: StreamingTextToSpeechProvider,
  signal: AbortSignal,
  events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>,
  initialSequence = 1,
  segmentIndex = 0,
  totals = { audioBytes: 0, durationMs: 0 }
): Promise<{
  segments: number;
  audioBytes: number;
  durationMs: number;
  nextSequence: number;
}> {
  const providerAbort = new AbortController();
  const providerSignal = AbortSignal.any([signal, providerAbort.signal]);
  const session = await withOperationTimeout(
    provider.startSynthesis({ text, signal: providerSignal }),
    providerSignal,
    VOICE_STREAM_LIMITS.providerStageTimeoutMs,
    providerAbort
  );
  let iterator: AsyncIterator<StreamingSynthesisEvent> | undefined;
  let audioBytes = 0;
  let completedDurationMs: number | undefined;
  let sequence = initialSequence;
  let expectedProviderSequence = 1;
  let outputFormat: StreamingAudioFormat | undefined;
  let outputFrameBytes: number | undefined;
  let outputFrameDurationMs: number | undefined;
  let segmentStarted = false;
  let completed = false;
  try {
    iterator = session[Symbol.asyncIterator]();
    while (true) {
      const next = await withOperationTimeout(
        iterator.next(),
        providerSignal,
        VOICE_STREAM_LIMITS.providerStageTimeoutMs,
        providerAbort
      );
      if (next.done) break;
      const event = next.value;
      if (completed) {
        throw new Error("Streaming TTS emitted an event after completion");
      }
      if (event.type === "audio") {
        const frameDurationMs = validateOutputChunk(
          event.chunk,
          expectedProviderSequence
        );
        expectedProviderSequence += 1;
        if (
          outputFormat &&
          !sameAudioFormat(outputFormat, event.chunk.format)
        ) {
          throw new Error("Streaming TTS changed output format");
        }
        outputFormat ??= event.chunk.format;
        outputFrameBytes ??= event.chunk.data.byteLength;
        outputFrameDurationMs ??= frameDurationMs;
        if (
          event.chunk.data.byteLength !== outputFrameBytes ||
          frameDurationMs !== outputFrameDurationMs
        ) {
          throw new Error("Streaming TTS changed output frame duration");
        }
        if (!segmentStarted) {
          await emit(events, providerSignal, {
            type: "segment_started",
            segmentIndex,
            text,
            format: {
              ...outputFormat,
              frameDurationMs: outputFrameDurationMs
            }
          });
          segmentStarted = true;
        }
        audioBytes += event.chunk.data.byteLength;
        const cumulativeBytes = totals.audioBytes + audioBytes;
        const cumulativeDurationMs =
          totals.durationMs + audioDurationMs(audioBytes, outputFormat);
        enforceOutputLimits(cumulativeBytes, cumulativeDurationMs);
        await emit(events, providerSignal, {
          type: "audio",
          chunk: { ...event.chunk, sequence }
        });
        sequence += 1;
      } else if (event.type === "completed") {
        if (
          event.sequence !== expectedProviderSequence ||
          !outputFormat ||
          !sameAudioFormat(outputFormat, event.format) ||
          event.audioBytes !== audioBytes
        ) {
          throw new Error("Streaming TTS completion metadata is inconsistent");
        }
        completedDurationMs = audioDurationMs(audioBytes, outputFormat);
        if (event.durationMs !== completedDurationMs) {
          throw new Error("Streaming TTS duration metadata is inconsistent");
        }
        completed = true;
      } else {
        throw new Error("Streaming TTS emitted an unknown event");
      }
    }
    if (!completed || !segmentStarted || completedDurationMs === undefined) {
      throw new Error("Streaming TTS ended without one complete audio segment");
    }
    totals.audioBytes += audioBytes;
    totals.durationMs += completedDurationMs;
    enforceOutputLimits(totals.audioBytes, totals.durationMs);
    await emit(events, providerSignal, {
      type: "segment_finished",
      segmentIndex
    });
    return {
      segments: 1,
      audioBytes,
      durationMs: completedDurationMs,
      nextSequence: sequence
    };
  } finally {
    providerAbort.abort();
    await settleWithTimeout(session.close());
  }
}

async function synthesizeBufferedText(
  text: string,
  provider: TextToSpeechProvider,
  signal: AbortSignal,
  events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>
): Promise<{ segments: number; audioBytes: number; durationMs: number }> {
  throwIfAborted(signal);
  const providerAbort = new AbortController();
  const providerSignal = AbortSignal.any([signal, providerAbort.signal]);
  const audio = await withOperationTimeout(
    provider.synthesize(text, { signal: providerSignal }),
    providerSignal,
    VOICE_STREAM_LIMITS.providerStageTimeoutMs,
    providerAbort
  );
  providerAbort.abort();
  throwIfAborted(signal);
  if (audio.mimeType !== "audio/wav") {
    throw new Error("Buffered TTS must return PCM16 WAV audio");
  }
  const decoded = decodePcm16Wav(audio.data);
  const format: StreamingAudioFormat = {
    encoding: "pcm16le",
    sampleRate: decoded.sampleRate,
    channels: decoded.channels
  };
  if (format.sampleRate < 8_000 || format.sampleRate > 96_000) {
    throw new Error("Buffered TTS sample rate is outside protocol bounds");
  }
  const durationMs = audioDurationMs(decoded.pcm.byteLength, format);
  enforceOutputLimits(decoded.pcm.byteLength, durationMs);
  const frameDurationMs = selectOutputFrameDuration(format.sampleRate);
  const segments = splitProtocolSegments(text);
  await emit(events, signal, {
    type: "segment_started",
    segmentIndex: 0,
    text: segments[0] ?? text,
    format: { ...format, frameDurationMs }
  });
  const sampleFrameBytes = format.channels * 2;
  const frameBytes = Math.max(
    sampleFrameBytes,
    ((format.sampleRate * frameDurationMs) / 1_000) * sampleFrameBytes
  );
  const paddedBytes =
    Math.ceil(decoded.pcm.byteLength / frameBytes) * frameBytes;
  const outputPcm = new Uint8Array(paddedBytes);
  outputPcm.set(decoded.pcm);
  const outputDurationMs = audioDurationMs(outputPcm.byteLength, format);
  enforceOutputLimits(outputPcm.byteLength, outputDurationMs);
  let sequence = 1;
  for (let offset = 0; offset < outputPcm.byteLength; offset += frameBytes) {
    await emit(events, signal, {
      type: "audio",
      chunk: {
        sequence,
        format,
        data: outputPcm.slice(offset, offset + frameBytes)
      }
    });
    sequence += 1;
  }
  await emit(events, signal, {
    type: "segment_finished",
    segmentIndex: 0
  });
  for (
    let segmentIndex = 1;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    await emit(events, signal, {
      type: "segment_started",
      segmentIndex,
      text: segments[segmentIndex] ?? "",
      format: { ...format, frameDurationMs }
    });
    await emit(events, signal, {
      type: "segment_finished",
      segmentIndex
    });
  }
  return {
    segments: segments.length,
    audioBytes: outputPcm.byteLength,
    durationMs: outputDurationMs
  };
}

function splitProtocolSegments(text: string): string[] {
  const segments: string[] = [];
  let pending = "";
  for (const codePoint of text) {
    if (
      pending.length + codePoint.length >
      VOICE_STREAM_LIMITS.maxTtsSegmentCharacters
    ) {
      if (pending.length > 0) segments.push(pending);
      pending = codePoint;
    } else {
      pending += codePoint;
    }
  }
  if (pending.length > 0) segments.push(pending);
  return segments;
}

async function* bufferedSegments(
  text: string
): AsyncGenerator<{ text: string }> {
  for (const segment of splitProtocolSegments(text)) {
    yield { text: segment };
  }
}

function validateCoordinatorInput(input: StreamingVoiceCoordinatorInput): void {
  if (input.format.encoding !== "pcm16le") {
    throw new Error("Streaming voice coordinator requires PCM16LE input");
  }
  if (
    input.format.sampleRate !== VOICE_STREAM_LIMITS.inputSampleRate ||
    input.format.channels !== VOICE_STREAM_LIMITS.inputChannels
  ) {
    throw new Error("Streaming voice coordinator requires 16 kHz mono input");
  }
}

function validateTranscriptionResult(result: TranscriptionResult): void {
  if (
    typeof result.text !== "string" ||
    result.text.trim().length === 0 ||
    result.text.length > VOICE_STREAM_LIMITS.maxTranscriptCharacters
  ) {
    throw new Error("Final transcript text is empty or exceeds its limit");
  }
  if (
    typeof result.language !== "string" ||
    result.language.length < 1 ||
    result.language.length > 64
  ) {
    throw new Error("Final transcript language is invalid");
  }
}

function validateAssistantResponse(response: string): void {
  if (
    response.length === 0 ||
    response.length > VOICE_STREAM_LIMITS.maxAssistantCharacters
  ) {
    throw new Error("Assistant response is empty or exceeds its limit");
  }
}

function role(
  snapshot: RuntimeVoiceRouteSnapshot,
  expected: "stt" | "chat" | "tts"
) {
  const assignment = snapshot.assignments.find(
    (candidate) => candidate.role === expected
  );
  if (!assignment) {
    throw new Error(`Voice route snapshot has no ${expected} assignment`);
  }
  return assignment;
}

function validateAudioChunk(
  chunk: StreamingAudioChunk,
  format: StreamingAudioFormat,
  sequence: number
): void {
  if (
    chunk.sequence !== sequence ||
    chunk.format.encoding !== format.encoding ||
    chunk.format.sampleRate !== format.sampleRate ||
    chunk.format.channels !== format.channels ||
    chunk.data.byteLength === 0 ||
    chunk.data.byteLength % (format.channels * 2) !== 0 ||
    chunk.data.byteLength + VOICE_STREAM_BINARY_HEADER_BYTES >
      VOICE_STREAM_LIMITS.maxBinaryMessageBytes
  ) {
    throw new Error("Streaming voice received an invalid audio chunk");
  }
}

function validateOutputChunk(
  chunk: StreamingAudioChunk,
  expectedSequence: number
): number {
  const sampleFrameBytes = chunk.format.channels * 2;
  if (
    chunk.sequence !== expectedSequence ||
    chunk.format.encoding !== "pcm16le" ||
    !Number.isInteger(chunk.format.sampleRate) ||
    chunk.format.sampleRate < 8_000 ||
    chunk.format.sampleRate > 96_000 ||
    !Number.isInteger(chunk.format.channels) ||
    chunk.format.channels < 1 ||
    chunk.format.channels > 2 ||
    chunk.data.byteLength === 0 ||
    chunk.data.byteLength % sampleFrameBytes !== 0 ||
    chunk.data.byteLength + VOICE_STREAM_BINARY_HEADER_BYTES >
      VOICE_STREAM_LIMITS.maxBinaryMessageBytes
  ) {
    throw new Error("Streaming TTS emitted an invalid audio chunk");
  }
  const frameSamples = chunk.data.byteLength / sampleFrameBytes;
  const frameDurationMs = (frameSamples / chunk.format.sampleRate) * 1_000;
  if (
    !Number.isInteger(frameDurationMs) ||
    frameDurationMs < 5 ||
    frameDurationMs > 100 ||
    frameSamples !== (chunk.format.sampleRate * frameDurationMs) / 1_000
  ) {
    throw new Error("Streaming TTS emitted an invalid frame duration");
  }
  return frameDurationMs;
}

function selectOutputFrameDuration(sampleRate: number): number {
  const preferred = [
    VOICE_STREAM_LIMITS.inputFrameDurationMs,
    ...Array.from({ length: 96 }, (_, index) => index + 5)
  ];
  const durationMs = preferred.find(
    (candidate) =>
      candidate >= 5 &&
      candidate <= 100 &&
      Number.isInteger((sampleRate * candidate) / 1_000)
  );
  if (durationMs === undefined) {
    throw new Error("Buffered TTS sample rate has no protocol frame duration");
  }
  return durationMs;
}

function sameAudioFormat(
  left: StreamingAudioFormat,
  right: StreamingAudioFormat
): boolean {
  return (
    left.encoding === right.encoding &&
    left.sampleRate === right.sampleRate &&
    left.channels === right.channels
  );
}

function enforceOutputLimits(audioBytes: number, durationMs: number): void {
  if (
    audioBytes > VOICE_STREAM_LIMITS.maxBufferedTtsBytes ||
    durationMs > VOICE_STREAM_LIMITS.maxBufferedTtsDurationMs
  ) {
    throw new Error("TTS output exceeds its aggregate limits");
  }
}

function enforceCaptureLimits(
  audioBytes: number,
  format: StreamingAudioFormat
): void {
  if (audioBytes > VOICE_STREAM_LIMITS.maxBufferedSttBytes) {
    throw new Error("STT audio exceeds its byte limit");
  }
  if (
    audioDurationMs(audioBytes, format) >
    VOICE_STREAM_LIMITS.maxBufferedSttDurationMs
  ) {
    throw new Error("STT audio exceeds its duration limit");
  }
}

function audioDurationMs(
  audioBytes: number,
  format: StreamingAudioFormat
): number {
  return Math.round(
    (audioBytes / (format.sampleRate * format.channels * 2)) * 1_000
  );
}

function concatenate(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AgentRunCancelledError();
}

function emit(
  events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>,
  signal: AbortSignal,
  event: StreamingVoiceCoordinatorEvent
): Promise<void> {
  return events.enqueue(event, {
    signal,
    timeoutMs: VOICE_STREAM_LIMITS.providerStageTimeoutMs
  });
}

function withOperationTimeout<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  abortController?: AbortController
): Promise<T> {
  if (signal.aborted) return Promise.reject(new AgentRunCancelledError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new AgentRunCancelledError());
    };
    const timeout = setTimeout(() => {
      cleanup();
      abortController?.abort();
      reject(new Error("Provider operation timed out"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(asError(error));
      }
    );
  });
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Provider operation failed");
}

async function settleWithTimeout(operation: Promise<unknown>): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(
      resolve,
      VOICE_STREAM_LIMITS.providerStageTimeoutMs
    );
    operation.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      () => {
        clearTimeout(timeout);
        resolve();
      }
    );
  });
}

function measureCoordinatorEvent(event: StreamingVoiceCoordinatorEvent): {
  bytes: number;
  durationMs: number;
} {
  if (event.type === "audio") {
    return {
      bytes: event.chunk.data.byteLength,
      durationMs: audioDurationMs(
        event.chunk.data.byteLength,
        event.chunk.format
      )
    };
  }
  return {
    bytes: new TextEncoder().encode(JSON.stringify(event)).byteLength,
    durationMs: 0
  };
}

const disabledMcp: McpServer = {
  name: "Disabled MCP",
  listTools: async () => [],
  callTool: async () => {
    throw new Error("MCP tools are disabled for this streaming voice run");
  }
};

class StreamingVoiceStageError extends Error {
  public constructor(
    public readonly stage: "STT" | "AGENT" | "TTS",
    public override readonly cause: unknown
  ) {
    super(`Streaming ${stage} stage failed`, { cause });
    this.name = "StreamingVoiceStageError";
  }
}
