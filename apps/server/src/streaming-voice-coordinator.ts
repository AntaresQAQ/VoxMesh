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
  type StreamingTextToSpeechProvider,
  type TextToSpeechProvider,
  type TranscriptionResult
} from "@voxmesh/audio";
import { BoundedAsyncQueue, VOICE_STREAM_LIMITS } from "@voxmesh/shared";
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
      type: "audio_completed";
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

  public async *run(
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
        maxBytes:
          VOICE_STREAM_LIMITS.maxBufferedTtsBytes +
          VOICE_STREAM_LIMITS.maxAssistantCharacters * 4,
        maxDurationMs: VOICE_STREAM_LIMITS.maxSessionDurationMs
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
    try {
      try {
        for await (const event of events) {
          yield event;
        }
      } catch {
        return await execution;
      }
      return await execution;
    } finally {
      localAbort.abort();
      await execution.catch(() => undefined);
    }
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
    let pressureHigh = false;
    const unsubscribePressure = events.subscribePressure((pressure) => {
      if (pressure === "high" && !pressureHigh) {
        pressureHigh = true;
        this.store.addLog({
          conversationId: run.conversationId,
          category: "SYSTEM",
          level: "WARN",
          message: `${pressureStage} output queue entered high pressure`
        });
      } else if (pressure === "normal" && pressureHigh) {
        pressureHigh = false;
        this.store.addLog({
          conversationId: run.conversationId,
          category: "SYSTEM",
          level: "INFO",
          message: `${pressureStage} output queue pressure recovered`
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
          pressureStage = "TTS";
        }
      );
      stage = "TTS";
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
    audio: { audioBytes: number; durationMs: number };
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
      await emit(events, stageSignal, {
        type: "stage",
        stage: "TTS",
        status: "started",
        durationMs: null,
        message: "TTS stage started"
      });
    };
    let segmenter: StreamingTtsSegmenter | undefined;
    let streamingAudio:
      Promise<{ audioBytes: number; durationMs: number }> | undefined;
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
    const agentExecution = chatStreaming
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
      throw error;
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
    let resolvedAudio: { audioBytes: number; durationMs: number };
    try {
      const audio = ttsStreaming
        ? (streamingAudio ??
          (await synthesizeStreamingText(
            agent.response,
            input.providers.streamingTts,
            signal,
            events
          )))
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
  const session = await input.providers.streamingStt.startSession({
    format: input.format,
    signal
  });
  let final: { result: TranscriptionResult; sequence: number } | undefined;
  let frames = 0;
  let audioBytes = 0;
  const consume = (async () => {
    for await (const event of session) {
      if (event.type === "partial") {
        await emit(events, signal, {
          type: "transcript_partial",
          sequence: event.sequence,
          text: event.text
        });
      } else {
        final = { result: event.result, sequence: event.sequence };
      }
    }
  })();
  try {
    for await (const chunk of input.audio) {
      throwIfAborted(signal);
      frames += 1;
      audioBytes += chunk.data.byteLength;
      await session.write(chunk);
    }
    await session.finishInput();
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
    await session.close();
    await consume.catch(() => undefined);
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
  let expectedSequence = 1;
  let audioBytes = 0;
  for await (const chunk of input.audio) {
    throwIfAborted(signal);
    validateAudioChunk(chunk, input.format, expectedSequence);
    expectedSequence += 1;
    audioBytes += chunk.data.byteLength;
    if (audioBytes > VOICE_STREAM_LIMITS.maxBufferedSttBytes) {
      throw new Error("Buffered STT audio exceeds its byte limit");
    }
    chunks.push(chunk.data);
  }
  if (chunks.length === 0) {
    throw new Error("Streaming voice requires at least one audio frame");
  }
  const durationMs = audioDurationMs(audioBytes, input.format);
  if (durationMs > VOICE_STREAM_LIMITS.maxBufferedSttDurationMs) {
    throw new Error("Buffered STT audio exceeds its duration limit");
  }
  const result = await input.providers.bufferedStt.transcribe({
    data: encodePcm16Wav({
      channels: input.format.channels,
      sampleRate: input.format.sampleRate,
      pcm: concatenate(chunks, audioBytes)
    }),
    mimeType: "audio/wav",
    sampleRate: input.format.sampleRate,
    channels: input.format.channels
  });
  throwIfAborted(signal);
  return {
    result,
    frames: chunks.length,
    audioBytes,
    finalSequence: 1
  };
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
  while (true) {
    const next = await iterator.next();
    if (next.done) return next.value;
    await emit(events, signal, { type: "agent", event: next.value });
    if (segmenter) {
      try {
        await segmenter.accept(next.value);
      } catch (error) {
        throw new StreamingVoiceStageError("TTS", error);
      }
    }
  }
}

async function synthesizeSegments(
  segments: AsyncIterable<{ text: string }>,
  provider: StreamingTextToSpeechProvider,
  signal: AbortSignal,
  events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>
): Promise<{ audioBytes: number; durationMs: number }> {
  let audioBytes = 0;
  let durationMs = 0;
  let sequence = 1;
  for await (const segment of segments) {
    const result = await synthesizeStreamingText(
      segment.text,
      provider,
      signal,
      events,
      sequence
    );
    audioBytes += result.audioBytes;
    durationMs += result.durationMs;
    sequence = result.nextSequence;
  }
  return { audioBytes, durationMs };
}

async function synthesizeStreamingText(
  text: string,
  provider: StreamingTextToSpeechProvider,
  signal: AbortSignal,
  events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>,
  initialSequence = 1
): Promise<{ audioBytes: number; durationMs: number; nextSequence: number }> {
  const session = await provider.startSynthesis({ text, signal });
  let audioBytes = 0;
  let durationMs = 0;
  let sequence = initialSequence;
  try {
    for await (const event of session) {
      if (event.type === "audio") {
        audioBytes += event.chunk.data.byteLength;
        await emit(events, signal, {
          type: "audio",
          chunk: { ...event.chunk, sequence }
        });
        sequence += 1;
      } else {
        durationMs += event.durationMs;
      }
    }
    return { audioBytes, durationMs, nextSequence: sequence };
  } finally {
    await session.close();
  }
}

async function synthesizeBufferedText(
  text: string,
  provider: TextToSpeechProvider,
  signal: AbortSignal,
  events: BoundedAsyncQueue<StreamingVoiceCoordinatorEvent>
): Promise<{ audioBytes: number; durationMs: number }> {
  throwIfAborted(signal);
  const audio = await provider.synthesize(text);
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
  const durationMs = audioDurationMs(decoded.pcm.byteLength, format);
  if (
    decoded.pcm.byteLength > VOICE_STREAM_LIMITS.maxBufferedTtsBytes ||
    durationMs > VOICE_STREAM_LIMITS.maxBufferedTtsDurationMs
  ) {
    throw new Error("Buffered TTS output exceeds its limits");
  }
  const frameBytes = Math.max(
    2,
    Math.floor((format.sampleRate * format.channels * 2 * 20) / 1_000)
  );
  let sequence = 1;
  for (let offset = 0; offset < decoded.pcm.byteLength; offset += frameBytes) {
    await emit(events, signal, {
      type: "audio",
      chunk: {
        sequence,
        format,
        data: decoded.pcm.slice(
          offset,
          Math.min(offset + frameBytes, decoded.pcm.byteLength)
        )
      }
    });
    sequence += 1;
  }
  return { audioBytes: decoded.pcm.byteLength, durationMs };
}

function validateCoordinatorInput(input: StreamingVoiceCoordinatorInput): void {
  if (input.format.encoding !== "pcm16le") {
    throw new Error("Streaming voice coordinator requires PCM16LE input");
  }
  if (
    !Number.isInteger(input.format.sampleRate) ||
    input.format.sampleRate < 1 ||
    input.format.channels !== 1
  ) {
    throw new Error("Streaming voice coordinator received an invalid format");
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
    chunk.data.byteLength % 2 !== 0
  ) {
    throw new Error("Streaming voice received an invalid audio chunk");
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
