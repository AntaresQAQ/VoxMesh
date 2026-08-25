import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const VOICE_STREAM_PROTOCOL_VERSION = 1 as const;
export const VOICE_STREAM_BINARY_HEADER_BYTES = 16;
export const VOICE_STREAM_LIMITS = Object.freeze({
  maxActiveSessionsPerAdministrator: 1,
  maxActiveSessionsGlobal: 4,
  inputSampleRate: 16_000,
  inputChannels: 1,
  inputFrameDurationMs: 20,
  maxControlMessageBytes: 16 * 1024,
  maxBinaryMessageBytes: 64 * 1024,
  maxWebSocketBufferedBytes: 512 * 1024,
  maxInputQueueBytes: 128 * 1024,
  maxInputQueueDurationMs: 2_000,
  maxOutputQueueBytes: 2 * 1024 * 1024,
  maxOutputQueueDurationMs: 5_000,
  maxBufferedSttBytes: 2 * 1024 * 1024,
  maxBufferedSttDurationMs: 60_000,
  maxBufferedTtsBytes: 10 * 1024 * 1024,
  maxBufferedTtsDurationMs: 120_000,
  maxInputFramesPerSecond: 75,
  maxClientControlsPerSecond: 20,
  sessionSetupTimeoutMs: 10_000,
  inputIdleTimeoutMs: 10_000,
  maxCaptureDurationMs: 60_000,
  maxSessionDurationMs: 120_000,
  providerStageTimeoutMs: 45_000,
  maxTranscriptCharacters: 8_000,
  maxAssistantCharacters: 32_000,
  maxToolArgumentsBytes: 32 * 1024,
  maxMcpResultBytes: 64 * 1024,
  maxToolCalls: 3,
  minTtsSegmentCharacters: 24,
  maxTtsSegmentCharacters: 240,
  maxTtsSegmentWaitMs: 400
});

const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const strict = { additionalProperties: false } as const;
const UuidSchema = Type.String({
  minLength: 36,
  maxLength: 36,
  pattern: UUID_PATTERN
});
const utf8Encoder = new TextEncoder();
const PositiveSequenceSchema = Type.Integer({
  minimum: 1,
  maximum: 0xffff_ffff
});

export const VoiceStreamToolModeSchema = Type.Union([
  Type.Literal("enabled"),
  Type.Literal("disabled")
]);

export const VoiceStreamPcmFormatSchema = Type.Object(
  {
    encoding: Type.Literal("pcm16le"),
    sampleRate: Type.Integer({ minimum: 8_000, maximum: 96_000 }),
    channels: Type.Integer({ minimum: 1, maximum: 2 }),
    frameDurationMs: Type.Integer({ minimum: 5, maximum: 100 })
  },
  strict
);

const InputFormatSchema = Type.Object(
  {
    encoding: Type.Literal("pcm16le"),
    sampleRate: Type.Literal(VOICE_STREAM_LIMITS.inputSampleRate),
    channels: Type.Literal(VOICE_STREAM_LIMITS.inputChannels),
    frameDurationMs: Type.Literal(VOICE_STREAM_LIMITS.inputFrameDurationMs)
  },
  strict
);

export const VoiceStreamTransportProfileSchema = Type.Object(
  {
    stt: Type.Union([Type.Literal("buffered"), Type.Literal("streaming")]),
    chat: Type.Union([Type.Literal("buffered"), Type.Literal("streaming")]),
    tts: Type.Union([Type.Literal("buffered"), Type.Literal("streaming")])
  },
  strict
);

export const VoiceStreamFailureCodeSchema = Type.Union([
  Type.Literal("UNSUPPORTED_VERSION"),
  Type.Literal("INVALID_MESSAGE"),
  Type.Literal("INVALID_STATE"),
  Type.Literal("INVALID_SEQUENCE"),
  Type.Literal("UNSUPPORTED_FORMAT"),
  Type.Literal("FRAME_TOO_LARGE"),
  Type.Literal("RATE_LIMITED"),
  Type.Literal("SESSION_LIMIT"),
  Type.Literal("INPUT_LIMIT"),
  Type.Literal("OUTPUT_LIMIT"),
  Type.Literal("BACKPRESSURE"),
  Type.Literal("TIMEOUT"),
  Type.Literal("RUN_CANCELLED"),
  Type.Literal("PROVIDER_FAILED"),
  Type.Literal("INTERNAL_ERROR")
]);

export const VoiceStreamFailureStageSchema = Type.Union([
  Type.Literal("session"),
  Type.Literal("transport"),
  Type.Literal("stt"),
  Type.Literal("agent"),
  Type.Literal("mcp"),
  Type.Literal("tts"),
  Type.Literal("playback")
]);

const StartSchema = control("voice.start", {
  sequence: Type.Literal(0),
  runId: UuidSchema,
  toolMode: VoiceStreamToolModeSchema,
  inputFormat: InputFormatSchema
});
const InputFinishedSchema = control("voice.input_finished", {
  sequence: PositiveSequenceSchema
});
const CancelSchema = control("voice.cancel", {
  sequence: PositiveSequenceSchema,
  reason: Type.Union([
    Type.Literal("user"),
    Type.Literal("navigation"),
    Type.Literal("shutdown")
  ])
});

export const VoiceStreamClientMessageSchema = Type.Union([
  StartSchema,
  InputFinishedSchema,
  CancelSchema
]);

const ReadySchema = control("voice.ready", {
  sequence: Type.Literal(0),
  runId: UuidSchema,
  toolMode: VoiceStreamToolModeSchema,
  inputFormat: InputFormatSchema,
  profile: VoiceStreamTransportProfileSchema
});
const RejectedSchema = control("voice.rejected", {
  sequence: Type.Literal(0),
  runId: UuidSchema,
  stage: Type.Union([Type.Literal("session"), Type.Literal("transport")]),
  code: VoiceStreamFailureCodeSchema,
  message: Type.String({ minLength: 1, maxLength: 512 })
});
const PartialTranscriptSchema = control("voice.partial_transcript", {
  sequence: PositiveSequenceSchema,
  text: Type.String({
    maxLength: VOICE_STREAM_LIMITS.maxTranscriptCharacters
  })
});
const FinalTranscriptSchema = control("voice.final_transcript", {
  sequence: PositiveSequenceSchema,
  text: Type.String({
    minLength: 1,
    maxLength: VOICE_STREAM_LIMITS.maxTranscriptCharacters
  }),
  language: Type.String({ minLength: 1, maxLength: 64 })
});
const LlmTextDeltaSchema = control("voice.llm_text_delta", {
  sequence: PositiveSequenceSchema,
  completionIndex: Type.Integer({ minimum: 0, maximum: 16 }),
  delta: Type.String({
    minLength: 1,
    maxLength: VOICE_STREAM_LIMITS.maxAssistantCharacters
  })
});
const LlmToolDeltaSchema = control("voice.llm_tool_delta", {
  sequence: PositiveSequenceSchema,
  completionIndex: Type.Integer({ minimum: 0, maximum: 16 }),
  toolCallIndex: Type.Integer({
    minimum: 0,
    maximum: VOICE_STREAM_LIMITS.maxToolCalls - 1
  }),
  toolName: Type.Union([
    Type.String({ minLength: 1, maxLength: 256 }),
    Type.Null()
  ]),
  argumentsBytes: Type.Integer({
    minimum: 0,
    maximum: VOICE_STREAM_LIMITS.maxToolArgumentsBytes
  }),
  complete: Type.Boolean()
});
const ToolStartedSchema = control("voice.tool_started", {
  sequence: PositiveSequenceSchema,
  completionIndex: Type.Integer({ minimum: 0, maximum: 16 }),
  toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
  toolName: Type.String({ minLength: 1, maxLength: 256 })
});
const ToolFinishedSchema = control("voice.tool_finished", {
  sequence: PositiveSequenceSchema,
  completionIndex: Type.Integer({ minimum: 0, maximum: 16 }),
  toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
  toolName: Type.String({ minLength: 1, maxLength: 256 }),
  success: Type.Boolean()
});
const LlmFinishedSchema = control("voice.llm_finished", {
  sequence: PositiveSequenceSchema,
  completionIndex: Type.Integer({ minimum: 0, maximum: 16 }),
  finishReason: Type.Union([
    Type.Literal("stop"),
    Type.Literal("tool_call"),
    Type.Literal("length"),
    Type.Literal("content_filter"),
    Type.Literal("other")
  ]),
  text: Type.String({
    maxLength: VOICE_STREAM_LIMITS.maxAssistantCharacters
  }),
  usage: Type.Union([
    Type.Object(
      {
        inputTokens: Type.Integer({ minimum: 0 }),
        outputTokens: Type.Integer({ minimum: 0 })
      },
      strict
    ),
    Type.Null()
  ])
});
const PressureSchema = control("voice.pressure", {
  sequence: PositiveSequenceSchema,
  queue: Type.Union([Type.Literal("input"), Type.Literal("output")]),
  level: Type.Union([Type.Literal("normal"), Type.Literal("high")]),
  queuedBytes: Type.Integer({ minimum: 0 }),
  queuedDurationMs: Type.Integer({ minimum: 0 })
});
const OutputSegmentStartedSchema = control("voice.output_segment_started", {
  sequence: PositiveSequenceSchema,
  segmentIndex: Type.Integer({ minimum: 0, maximum: 10_000 }),
  text: Type.String({
    minLength: 1,
    maxLength: VOICE_STREAM_LIMITS.maxTtsSegmentCharacters
  }),
  format: VoiceStreamPcmFormatSchema
});
const OutputSegmentFinishedSchema = control("voice.output_segment_finished", {
  sequence: PositiveSequenceSchema,
  segmentIndex: Type.Integer({ minimum: 0, maximum: 10_000 })
});
const OutputFinishedSchema = control("voice.output_finished", {
  sequence: PositiveSequenceSchema,
  segments: Type.Integer({ minimum: 0, maximum: 10_000 }),
  audioBytes: Type.Integer({
    minimum: 0,
    maximum: VOICE_STREAM_LIMITS.maxBufferedTtsBytes
  }),
  durationMs: Type.Integer({
    minimum: 0,
    maximum: VOICE_STREAM_LIMITS.maxBufferedTtsDurationMs
  })
});
const CompletedSchema = control("voice.completed", {
  sequence: PositiveSequenceSchema,
  conversationId: Type.String({ minLength: 1, maxLength: 256 }),
  runId: UuidSchema
});
const CancelledSchema = control("voice.cancelled", {
  sequence: PositiveSequenceSchema,
  code: Type.Literal("RUN_CANCELLED")
});
const FailedSchema = control("voice.failed", {
  sequence: PositiveSequenceSchema,
  stage: VoiceStreamFailureStageSchema,
  code: VoiceStreamFailureCodeSchema,
  message: Type.String({ minLength: 1, maxLength: 512 })
});

export const VoiceStreamServerMessageSchema = Type.Union([
  ReadySchema,
  RejectedSchema,
  PartialTranscriptSchema,
  FinalTranscriptSchema,
  LlmTextDeltaSchema,
  LlmToolDeltaSchema,
  ToolStartedSchema,
  ToolFinishedSchema,
  LlmFinishedSchema,
  PressureSchema,
  OutputSegmentStartedSchema,
  OutputSegmentFinishedSchema,
  OutputFinishedSchema,
  CompletedSchema,
  CancelledSchema,
  FailedSchema
]);

export const VoiceStreamControlMessageSchema = Type.Union([
  VoiceStreamClientMessageSchema,
  VoiceStreamServerMessageSchema
]);

export type VoiceStreamToolMode = Static<typeof VoiceStreamToolModeSchema>;
export type VoiceStreamPcmFormat = Static<typeof VoiceStreamPcmFormatSchema>;
export type VoiceStreamTransportProfile = Static<
  typeof VoiceStreamTransportProfileSchema
>;
export type VoiceStreamFailureCode = Static<
  typeof VoiceStreamFailureCodeSchema
>;
export type VoiceStreamFailureStage = Static<
  typeof VoiceStreamFailureStageSchema
>;
export type VoiceStreamClientMessage = Static<
  typeof VoiceStreamClientMessageSchema
>;
export type VoiceStreamServerMessage = Static<
  typeof VoiceStreamServerMessageSchema
>;
export type VoiceStreamControlMessage = Static<
  typeof VoiceStreamControlMessageSchema
>;

export type VoiceStreamBinaryDirection = "input" | "output";

export interface VoiceStreamBinaryFrame {
  version: typeof VOICE_STREAM_PROTOCOL_VERSION;
  direction: VoiceStreamBinaryDirection;
  sequence: number;
  format: {
    encoding: "pcm16le";
    sampleRate: number;
    channels: number;
  };
  frameSamples: number;
  data: Uint8Array;
}

export class VoiceStreamProtocolError extends Error {
  public constructor(
    public readonly code: VoiceStreamFailureCode,
    message: string
  ) {
    super(message);
    this.name = "VoiceStreamProtocolError";
  }
}

/** Parses one untrusted JSON control message and rejects unknown properties. */
export function parseVoiceStreamControlMessage(
  input: string
): VoiceStreamControlMessage | null {
  if (input.length > VOICE_STREAM_LIMITS.maxControlMessageBytes) {
    return null;
  }
  if (
    utf8Encoder.encode(input).byteLength >
    VOICE_STREAM_LIMITS.maxControlMessageBytes
  ) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return null;
  }
  return Value.Check(VoiceStreamControlMessageSchema, value) ? value : null;
}

/** Encodes one connection-scoped PCM frame using the version 1 fixed header. */
export function encodeVoiceStreamBinaryFrame(
  frame: VoiceStreamBinaryFrame
): Uint8Array {
  validateBinaryFrame(frame);
  const encoded = new Uint8Array(
    VOICE_STREAM_BINARY_HEADER_BYTES + frame.data.byteLength
  );
  const view = new DataView(encoded.buffer);
  view.setUint8(0, frame.version);
  view.setUint8(1, frame.direction === "input" ? 0 : 1);
  view.setUint8(2, 1);
  view.setUint8(3, frame.format.channels);
  view.setUint32(4, frame.sequence);
  view.setUint32(8, frame.format.sampleRate);
  view.setUint32(12, frame.frameSamples);
  encoded.set(frame.data, VOICE_STREAM_BINARY_HEADER_BYTES);
  return encoded;
}

/** Decodes and structurally validates one version 1 binary PCM frame. */
export function decodeVoiceStreamBinaryFrame(
  input: ArrayBuffer | ArrayBufferView
): VoiceStreamBinaryFrame {
  const bytes = toBytes(input);
  if (bytes.byteLength > VOICE_STREAM_LIMITS.maxBinaryMessageBytes) {
    throw protocolError(
      "FRAME_TOO_LARGE",
      "Voice frame exceeds the size limit"
    );
  }
  if (bytes.byteLength < VOICE_STREAM_BINARY_HEADER_BYTES) {
    throw protocolError("INVALID_MESSAGE", "Voice frame header is incomplete");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== VOICE_STREAM_PROTOCOL_VERSION) {
    throw protocolError(
      "UNSUPPORTED_VERSION",
      "Voice frame version is unsupported"
    );
  }
  const directionValue = view.getUint8(1);
  if (directionValue !== 0 && directionValue !== 1) {
    throw protocolError("INVALID_MESSAGE", "Voice frame direction is invalid");
  }
  if (view.getUint8(2) !== 1) {
    throw protocolError(
      "UNSUPPORTED_FORMAT",
      "Voice frame encoding is unsupported"
    );
  }
  const frame: VoiceStreamBinaryFrame = {
    version,
    direction: directionValue === 0 ? "input" : "output",
    sequence: view.getUint32(4),
    format: {
      encoding: "pcm16le",
      sampleRate: view.getUint32(8),
      channels: view.getUint8(3)
    },
    frameSamples: view.getUint32(12),
    data: bytes.slice(VOICE_STREAM_BINARY_HEADER_BYTES)
  };
  validateBinaryFrame(frame);
  return frame;
}

/** Validates client control and audio ordering for one session connection. */
export class VoiceStreamClientProtocolState {
  private sessionId: string | null = null;
  private inputFormat: Static<typeof InputFormatSchema> | null = null;
  private nextControlSequence = 0;
  private nextAudioSequence = 1;
  private inputFinished = false;
  private terminal = false;

  public acceptControl(message: VoiceStreamClientMessage): void {
    if (this.terminal) {
      throw protocolError("INVALID_STATE", "Voice session is already terminal");
    }
    if (message.sequence !== this.nextControlSequence) {
      throw protocolError(
        "INVALID_SEQUENCE",
        "Voice control sequence is invalid"
      );
    }
    if (this.sessionId === null) {
      if (message.type !== "voice.start") {
        throw protocolError("INVALID_STATE", "Voice session must start first");
      }
      this.sessionId = message.sessionId;
      this.inputFormat = message.inputFormat;
    } else {
      this.assertSession(message.sessionId);
      if (message.type === "voice.start") {
        throw protocolError("INVALID_STATE", "Voice session already started");
      }
    }
    if (message.type === "voice.input_finished") {
      if (this.inputFinished) {
        throw protocolError("INVALID_STATE", "Voice input already finished");
      }
      this.inputFinished = true;
    }
    if (message.type === "voice.cancel") {
      this.terminal = true;
    }
    this.nextControlSequence += 1;
  }

  public acceptAudio(frame: VoiceStreamBinaryFrame): void {
    if (this.sessionId === null || this.terminal || this.inputFinished) {
      throw protocolError(
        "INVALID_STATE",
        "Voice input frame is not allowed in the current state"
      );
    }
    if (frame.direction !== "input") {
      throw protocolError("INVALID_MESSAGE", "Expected an input audio frame");
    }
    if (frame.sequence !== this.nextAudioSequence) {
      throw protocolError(
        "INVALID_SEQUENCE",
        "Input audio sequence is invalid"
      );
    }
    if (!this.inputFormat || !matchesInputFormat(frame, this.inputFormat)) {
      throw protocolError(
        "UNSUPPORTED_FORMAT",
        "Input audio frame does not match the negotiated format"
      );
    }
    this.nextAudioSequence += 1;
  }

  private assertSession(sessionId: string): void {
    if (sessionId !== this.sessionId) {
      throw protocolError(
        "INVALID_MESSAGE",
        "Voice control belongs to another session"
      );
    }
  }
}

/** Validates server control and output-frame ordering for one session. */
export class VoiceStreamServerProtocolState {
  private readonly sessionId: string;
  private readonly runId: string;
  private readonly toolMode: VoiceStreamToolMode;
  private readonly inputFormat: Static<typeof InputFormatSchema>;
  private nextControlSequence = 0;
  private nextAudioSequence = 1;
  private ready = false;
  private finalTranscript = false;
  private finalLlmCompletion = false;
  private nextCompletionIndex = 0;
  private activeCompletionIndex: number | null = null;
  private activeCompletionHasText = false;
  private activeCompletionToolCalls = new Map<number, boolean>();
  private awaitingToolResults = false;
  private llmCannotContinue = false;
  private expectedToolResults = 0;
  private finishedToolResults = 0;
  private activeTools = new Map<string, string>();
  private activeSegment: number | null = null;
  private activeOutputFormat: VoiceStreamPcmFormat | null = null;
  private nextSegmentIndex = 0;
  private completedSegments = 0;
  private outputBytes = 0;
  private outputDurationMs = 0;
  private outputFinished = false;
  private terminal = false;

  public constructor(
    start: VoiceStreamClientMessage & { type: "voice.start" }
  ) {
    this.sessionId = start.sessionId;
    this.runId = start.runId;
    this.toolMode = start.toolMode;
    this.inputFormat = start.inputFormat;
  }

  public acceptControl(message: VoiceStreamServerMessage): void {
    if (this.terminal) {
      throw protocolError("INVALID_STATE", "Voice session is already terminal");
    }
    if (message.sequence !== this.nextControlSequence) {
      throw protocolError(
        "INVALID_SEQUENCE",
        "Voice control sequence is invalid"
      );
    }
    this.assertSession(message.sessionId);
    if (!this.ready) {
      if (message.type === "voice.rejected") {
        this.assertRun(message.runId);
        this.terminal = true;
        this.nextControlSequence += 1;
        return;
      }
      if (message.type !== "voice.ready") {
        throw protocolError(
          "INVALID_STATE",
          "Voice ready or rejected must be first"
        );
      }
      this.assertReady(message);
      this.ready = true;
    } else if (
      message.type === "voice.ready" ||
      message.type === "voice.rejected"
    ) {
      throw protocolError("INVALID_STATE", "Voice handshake already completed");
    }
    this.applySemanticState(message);
    this.nextControlSequence += 1;
  }

  public acceptAudio(frame: VoiceStreamBinaryFrame): void {
    if (
      !this.ready ||
      this.terminal ||
      this.outputFinished ||
      this.activeSegment === null
    ) {
      throw protocolError(
        "INVALID_STATE",
        "Voice output frame is not allowed in the current state"
      );
    }
    if (frame.direction !== "output") {
      throw protocolError("INVALID_MESSAGE", "Expected an output audio frame");
    }
    if (frame.sequence !== this.nextAudioSequence) {
      throw protocolError(
        "INVALID_SEQUENCE",
        "Output audio sequence is invalid"
      );
    }
    if (
      !this.activeOutputFormat ||
      !matchesOutputFormat(frame, this.activeOutputFormat)
    ) {
      throw protocolError(
        "UNSUPPORTED_FORMAT",
        "Output audio frame does not match the segment format"
      );
    }
    this.outputBytes += frame.data.byteLength;
    this.outputDurationMs +=
      (frame.frameSamples / frame.format.sampleRate) * 1_000;
    this.nextAudioSequence += 1;
  }

  private applySemanticState(message: VoiceStreamServerMessage): void {
    switch (message.type) {
      case "voice.partial_transcript":
        if (this.finalTranscript) {
          throw protocolError(
            "INVALID_STATE",
            "Partial transcript followed the final transcript"
          );
        }
        return;
      case "voice.final_transcript":
        if (this.finalTranscript) {
          throw protocolError("INVALID_STATE", "Final transcript already sent");
        }
        this.finalTranscript = true;
        return;
      case "voice.llm_text_delta":
        this.requireFinalTranscript();
        this.beginCompletion(message.completionIndex);
        this.activeCompletionHasText = true;
        return;
      case "voice.llm_tool_delta":
        this.requireFinalTranscript();
        if (this.toolMode === "disabled") {
          throw protocolError(
            "INVALID_STATE",
            "Tool deltas are forbidden when tools are disabled"
          );
        }
        this.beginCompletion(message.completionIndex);
        this.activeCompletionToolCalls.set(
          message.toolCallIndex,
          message.complete
        );
        return;
      case "voice.tool_started":
        this.requireToolResults(message.completionIndex);
        if (
          this.activeTools.has(message.toolCallId) ||
          this.activeTools.size + this.finishedToolResults >=
            this.expectedToolResults
        ) {
          throw protocolError(
            "INVALID_STATE",
            "Tool execution does not match the completed tool calls"
          );
        }
        this.activeTools.set(message.toolCallId, message.toolName);
        return;
      case "voice.tool_finished":
        this.requireToolResults(message.completionIndex);
        if (this.activeTools.get(message.toolCallId) !== message.toolName) {
          throw protocolError(
            "INVALID_STATE",
            "Tool finish does not match its start"
          );
        }
        this.activeTools.delete(message.toolCallId);
        this.finishedToolResults += 1;
        if (
          this.finishedToolResults === this.expectedToolResults &&
          this.activeTools.size === 0
        ) {
          this.awaitingToolResults = false;
        }
        return;
      case "voice.llm_finished":
        this.requireFinalTranscript();
        this.finishCompletion(message);
        return;
      case "voice.output_segment_started":
        this.requireFinalTranscript();
        if (this.activeSegment !== null || this.outputFinished) {
          throw protocolError(
            "INVALID_STATE",
            "Voice output segment cannot start now"
          );
        }
        if (message.segmentIndex !== this.nextSegmentIndex) {
          throw protocolError(
            "INVALID_SEQUENCE",
            "Voice output segment index is invalid"
          );
        }
        if (!hasIntegralFrameSamples(message.format)) {
          throw protocolError(
            "UNSUPPORTED_FORMAT",
            "Output segment format has a fractional frame size"
          );
        }
        if (this.toolMode === "enabled" && !this.finalLlmCompletion) {
          throw protocolError(
            "INVALID_STATE",
            "Tool-enabled speech requires a final no-tool completion"
          );
        }
        if (
          this.toolMode === "disabled" &&
          !this.finalLlmCompletion &&
          !this.activeCompletionHasText
        ) {
          throw protocolError(
            "INVALID_STATE",
            "Early speech requires Streaming LLM text"
          );
        }
        this.activeSegment = message.segmentIndex;
        this.activeOutputFormat = message.format;
        return;
      case "voice.output_segment_finished":
        if (this.activeSegment !== message.segmentIndex) {
          throw protocolError(
            "INVALID_STATE",
            "Voice output segment does not match the active segment"
          );
        }
        this.activeSegment = null;
        this.activeOutputFormat = null;
        this.completedSegments += 1;
        this.nextSegmentIndex += 1;
        return;
      case "voice.output_finished":
        if (
          !this.finalLlmCompletion ||
          this.activeSegment !== null ||
          this.outputFinished
        ) {
          throw protocolError(
            "INVALID_STATE",
            "Voice output cannot finish in the current state"
          );
        }
        if (
          message.segments !== this.completedSegments ||
          message.audioBytes !== this.outputBytes ||
          message.durationMs !== Math.round(this.outputDurationMs)
        ) {
          throw protocolError(
            "INVALID_MESSAGE",
            "Voice output totals do not match the streamed audio"
          );
        }
        this.outputFinished = true;
        return;
      case "voice.completed":
        if (
          !this.finalTranscript ||
          !this.finalLlmCompletion ||
          !this.outputFinished
        ) {
          throw protocolError(
            "INVALID_STATE",
            "Voice session completed before required stages"
          );
        }
        this.assertRun(message.runId);
        this.terminal = true;
        return;
      case "voice.cancelled":
      case "voice.failed":
        this.terminal = true;
        return;
      case "voice.ready":
      case "voice.rejected":
      case "voice.pressure":
        return;
    }
  }

  private requireFinalTranscript(): void {
    if (!this.finalTranscript) {
      throw protocolError(
        "INVALID_STATE",
        "Voice Agent events require a final transcript"
      );
    }
  }

  private beginCompletion(completionIndex: number): void {
    if (
      this.finalLlmCompletion ||
      this.awaitingToolResults ||
      this.llmCannotContinue
    ) {
      throw protocolError(
        "INVALID_STATE",
        "Streaming LLM event followed a completed LLM phase"
      );
    }
    if (this.activeCompletionIndex === null) {
      if (completionIndex !== this.nextCompletionIndex) {
        throw protocolError(
          "INVALID_SEQUENCE",
          "Streaming LLM completion index is invalid"
        );
      }
      this.activeCompletionIndex = completionIndex;
      this.activeCompletionHasText = false;
      this.activeCompletionToolCalls.clear();
      return;
    }
    if (completionIndex !== this.activeCompletionIndex) {
      throw protocolError(
        "INVALID_SEQUENCE",
        "Streaming LLM event belongs to another completion"
      );
    }
  }

  private finishCompletion(
    message: Extract<VoiceStreamServerMessage, { type: "voice.llm_finished" }>
  ): void {
    this.beginCompletion(message.completionIndex);
    const completedToolCalls = [...this.activeCompletionToolCalls.values()];
    const hasToolCalls = completedToolCalls.length > 0;
    const allToolCallsComplete = completedToolCalls.every(Boolean);
    if (message.finishReason === "stop") {
      if (hasToolCalls) {
        throw protocolError(
          "INVALID_STATE",
          "A stop completion cannot contain tool calls"
        );
      }
      this.finalLlmCompletion = true;
    } else if (message.finishReason === "tool_call") {
      if (!hasToolCalls || !allToolCallsComplete) {
        throw protocolError(
          "INVALID_STATE",
          "Tool completion requires complete tool-call deltas"
        );
      }
      this.awaitingToolResults = true;
      this.expectedToolResults = completedToolCalls.length;
      this.finishedToolResults = 0;
      this.activeTools.clear();
    } else {
      this.llmCannotContinue = true;
    }
    this.activeCompletionIndex = null;
    this.activeCompletionHasText = false;
    this.activeCompletionToolCalls.clear();
    this.nextCompletionIndex += 1;
  }

  private requireToolResults(completionIndex: number): void {
    if (
      !this.awaitingToolResults ||
      completionIndex !== this.nextCompletionIndex - 1
    ) {
      throw protocolError(
        "INVALID_STATE",
        "Tool execution is not expected for this completion"
      );
    }
  }

  private assertReady(
    message: Extract<VoiceStreamServerMessage, { type: "voice.ready" }>
  ): void {
    this.assertRun(message.runId);
    if (
      message.toolMode !== this.toolMode ||
      !sameInputFormat(message.inputFormat, this.inputFormat)
    ) {
      throw protocolError(
        "INVALID_MESSAGE",
        "Voice ready does not match the accepted start"
      );
    }
  }

  private assertSession(sessionId: string): void {
    if (sessionId !== this.sessionId) {
      throw protocolError(
        "INVALID_MESSAGE",
        "Voice control belongs to another session"
      );
    }
  }

  private assertRun(runId: string): void {
    if (runId !== this.runId) {
      throw protocolError(
        "INVALID_MESSAGE",
        "Voice control belongs to another run"
      );
    }
  }
}

function control<T extends string, P extends Record<string, TSchema>>(
  type: T,
  properties: P
) {
  return Type.Object(
    {
      version: Type.Literal(VOICE_STREAM_PROTOCOL_VERSION),
      type: Type.Literal(type),
      sessionId: UuidSchema,
      ...properties
    },
    strict
  );
}

function validateBinaryFrame(frame: VoiceStreamBinaryFrame): void {
  if (frame.version !== VOICE_STREAM_PROTOCOL_VERSION) {
    throw protocolError(
      "UNSUPPORTED_VERSION",
      "Voice frame version is unsupported"
    );
  }
  if (frame.direction !== "input" && frame.direction !== "output") {
    throw protocolError("INVALID_MESSAGE", "Voice frame direction is invalid");
  }
  if (
    !Number.isInteger(frame.sequence) ||
    frame.sequence < 1 ||
    frame.sequence > 0xffff_ffff
  ) {
    throw protocolError("INVALID_SEQUENCE", "Voice frame sequence is invalid");
  }
  if (
    frame.format.encoding !== "pcm16le" ||
    !Number.isInteger(frame.format.sampleRate) ||
    frame.format.sampleRate < 8_000 ||
    frame.format.sampleRate > 96_000 ||
    !Number.isInteger(frame.format.channels) ||
    frame.format.channels < 1 ||
    frame.format.channels > 2
  ) {
    throw protocolError(
      "UNSUPPORTED_FORMAT",
      "Voice frame format is unsupported"
    );
  }
  if (
    !Number.isInteger(frame.frameSamples) ||
    frame.frameSamples < 1 ||
    frame.frameSamples > 0xffff_ffff
  ) {
    throw protocolError(
      "INVALID_MESSAGE",
      "Voice frame sample count is invalid"
    );
  }
  const expectedBytes =
    frame.frameSamples * frame.format.channels * Int16Array.BYTES_PER_ELEMENT;
  if (frame.data.byteLength !== expectedBytes) {
    throw protocolError(
      "INVALID_MESSAGE",
      "Voice frame payload does not match its metadata"
    );
  }
  if (
    VOICE_STREAM_BINARY_HEADER_BYTES + frame.data.byteLength >
    VOICE_STREAM_LIMITS.maxBinaryMessageBytes
  ) {
    throw protocolError(
      "FRAME_TOO_LARGE",
      "Voice frame exceeds the size limit"
    );
  }
}

function toBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  return input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function matchesInputFormat(
  frame: VoiceStreamBinaryFrame,
  format: Static<typeof InputFormatSchema>
): boolean {
  return (
    frame.format.encoding === format.encoding &&
    frame.format.sampleRate === format.sampleRate &&
    frame.format.channels === format.channels &&
    frame.frameSamples === (format.sampleRate * format.frameDurationMs) / 1_000
  );
}

function matchesOutputFormat(
  frame: VoiceStreamBinaryFrame,
  format: VoiceStreamPcmFormat
): boolean {
  return (
    frame.format.encoding === format.encoding &&
    frame.format.sampleRate === format.sampleRate &&
    frame.format.channels === format.channels &&
    frame.frameSamples === (format.sampleRate * format.frameDurationMs) / 1_000
  );
}

function sameInputFormat(
  left: Static<typeof InputFormatSchema>,
  right: Static<typeof InputFormatSchema>
): boolean {
  return (
    left.encoding === right.encoding &&
    left.sampleRate === right.sampleRate &&
    left.channels === right.channels &&
    left.frameDurationMs === right.frameDurationMs
  );
}

function hasIntegralFrameSamples(format: VoiceStreamPcmFormat): boolean {
  return Number.isInteger((format.sampleRate * format.frameDurationMs) / 1_000);
}

function protocolError(
  code: VoiceStreamFailureCode,
  message: string
): VoiceStreamProtocolError {
  return new VoiceStreamProtocolError(code, message);
}
