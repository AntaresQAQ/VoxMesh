import { describe, expect, it } from "vitest";

import {
  VOICE_STREAM_BINARY_HEADER_BYTES,
  VOICE_STREAM_LIMITS,
  VoiceStreamClientProtocolState,
  VoiceStreamProtocolError,
  VoiceStreamServerProtocolState,
  decodeVoiceStreamBinaryFrame,
  encodeVoiceStreamBinaryFrame,
  parseVoiceStreamControlMessage,
  type VoiceStreamBinaryFrame,
  type VoiceStreamClientMessage,
  type VoiceStreamServerMessage
} from "./voice-stream.js";

const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

describe("voice stream control parsing", () => {
  it("accepts strict client and server control messages", () => {
    expect(parseVoiceStreamControlMessage(JSON.stringify(start()))).toEqual(
      start()
    );
    expect(parseVoiceStreamControlMessage(JSON.stringify(ready()))).toEqual(
      ready()
    );
    expect(
      parseVoiceStreamControlMessage(
        JSON.stringify({
          version: 1,
          type: "voice.failed",
          sessionId,
          sequence: 1,
          stage: "stt",
          code: "PROVIDER_FAILED",
          message: "Speech provider failed"
        })
      )
    ).toMatchObject({ type: "voice.failed", stage: "stt" });
  });

  it("rejects malformed, unknown, oversized, and extra-property messages", () => {
    expect(parseVoiceStreamControlMessage("{")).toBeNull();
    expect(
      parseVoiceStreamControlMessage(
        JSON.stringify({ ...start(), unexpected: true })
      )
    ).toBeNull();
    expect(
      parseVoiceStreamControlMessage(
        JSON.stringify({ ...start(), sessionId: "not-a-uuid" })
      )
    ).toBeNull();
    expect(
      parseVoiceStreamControlMessage(
        JSON.stringify({
          ...start(),
          inputFormat: { ...start().inputFormat, sampleRate: 48_000 }
        })
      )
    ).toBeNull();
    expect(
      parseVoiceStreamControlMessage(
        `"${"x".repeat(VOICE_STREAM_LIMITS.maxControlMessageBytes)}"`
      )
    ).toBeNull();
  });
});

describe("voice stream binary frames", () => {
  it("round-trips input and output PCM frames", () => {
    for (const direction of ["input", "output"] as const) {
      const frame = pcmFrame(direction, 1);
      const encoded = encodeVoiceStreamBinaryFrame(frame);

      expect(encoded).toHaveLength(
        VOICE_STREAM_BINARY_HEADER_BYTES + frame.data.byteLength
      );
      expect(decodeVoiceStreamBinaryFrame(encoded)).toEqual(frame);
    }
  });

  it.each([
    {
      name: "unsupported version",
      mutate: (bytes: Uint8Array) => {
        bytes[0] = 2;
      },
      code: "UNSUPPORTED_VERSION"
    },
    {
      name: "invalid direction",
      mutate: (bytes: Uint8Array) => {
        bytes[1] = 9;
      },
      code: "INVALID_MESSAGE"
    },
    {
      name: "unsupported encoding",
      mutate: (bytes: Uint8Array) => {
        bytes[2] = 9;
      },
      code: "UNSUPPORTED_FORMAT"
    }
  ])("rejects $name", ({ mutate, code }) => {
    const encoded = encodeVoiceStreamBinaryFrame(pcmFrame("input", 1));
    mutate(encoded);

    expectProtocolError(() => decodeVoiceStreamBinaryFrame(encoded), code);
  });

  it("rejects incomplete, mismatched, and oversized frames", () => {
    expectProtocolError(
      () =>
        decodeVoiceStreamBinaryFrame(
          new Uint8Array(VOICE_STREAM_BINARY_HEADER_BYTES - 1)
        ),
      "INVALID_MESSAGE"
    );
    const truncated = encodeVoiceStreamBinaryFrame(pcmFrame("input", 1)).slice(
      0,
      -2
    );
    expectProtocolError(
      () => decodeVoiceStreamBinaryFrame(truncated),
      "INVALID_MESSAGE"
    );
    expectProtocolError(
      () =>
        encodeVoiceStreamBinaryFrame({
          ...pcmFrame("input", 1),
          frameSamples: 32_768,
          data: new Uint8Array(32_768 * 2)
        }),
      "FRAME_TOO_LARGE"
    );
  });
});

describe("voice stream protocol state", () => {
  it("accepts ordered client controls and input frames", () => {
    const state = new VoiceStreamClientProtocolState();
    state.acceptControl(start());
    state.acceptAudio(pcmFrame("input", 1));
    state.acceptControl({
      version: 1,
      type: "voice.input_finished",
      sessionId,
      sequence: 1
    });
    expectProtocolError(
      () => state.acceptAudio(pcmFrame("input", 2)),
      "INVALID_STATE"
    );
    state.acceptControl({
      version: 1,
      type: "voice.cancel",
      sessionId,
      sequence: 2,
      reason: "user"
    });
    expectProtocolError(
      () =>
        state.acceptControl({
          version: 1,
          type: "voice.cancel",
          sessionId,
          sequence: 3,
          reason: "user"
        }),
      "INVALID_STATE"
    );
  });

  it("rejects client messages and audio from invalid states or sequences", () => {
    const state = new VoiceStreamClientProtocolState();
    expectProtocolError(
      () =>
        state.acceptControl({
          version: 1,
          type: "voice.input_finished",
          sessionId,
          sequence: 0
        }),
      "INVALID_STATE"
    );
    state.acceptControl(start());
    expectProtocolError(
      () => state.acceptAudio(pcmFrame("output", 1)),
      "INVALID_MESSAGE"
    );
    expectProtocolError(
      () => state.acceptAudio(pcmFrame("input", 2)),
      "INVALID_SEQUENCE"
    );
    expectProtocolError(
      () =>
        state.acceptAudio({
          ...pcmFrame("input", 1),
          format: {
            encoding: "pcm16le",
            sampleRate: 48_000,
            channels: 2
          },
          frameSamples: 960,
          data: new Uint8Array(960 * 2 * 2)
        }),
      "UNSUPPORTED_FORMAT"
    );
  });

  it("accepts early speech for a tool-disabled completed session", () => {
    const state = new VoiceStreamServerProtocolState(start("disabled"));
    state.acceptControl(ready("disabled"));
    state.acceptControl(finalTranscript(1));
    state.acceptControl(llmTextDelta(2, "The light is on."));
    state.acceptControl(outputSegmentStarted(3, 0));
    state.acceptAudio(pcmFrame("output", 1));
    state.acceptControl(outputSegmentFinished(4, 0));
    state.acceptControl(llmFinished(5));
    state.acceptControl(outputFinished(6));
    state.acceptControl(completed(7));
  });

  it("requires a final no-tool completion before tool-enabled speech", () => {
    const state = new VoiceStreamServerProtocolState(start());
    state.acceptControl(ready("enabled"));
    state.acceptControl(finalTranscript(1));
    state.acceptControl(llmTextDelta(2, "Maybe"));
    expectProtocolError(
      () => state.acceptControl(outputSegmentStarted(3, 0)),
      "INVALID_STATE"
    );
  });

  it("rejects partials after final transcripts and incomplete completion", () => {
    const state = new VoiceStreamServerProtocolState(start());
    state.acceptControl(ready());
    state.acceptControl(finalTranscript(1));
    expectProtocolError(
      () =>
        state.acceptControl({
          version: 1,
          type: "voice.partial_transcript",
          sessionId,
          sequence: 2,
          text: "late"
        }),
      "INVALID_STATE"
    );

    const incomplete = new VoiceStreamServerProtocolState(start());
    incomplete.acceptControl(ready());
    expectProtocolError(
      () => incomplete.acceptControl(completed(1)),
      "INVALID_STATE"
    );
  });

  it("rejects handshake and terminal identifiers that do not match start", () => {
    const mismatchedReady = new VoiceStreamServerProtocolState(start());
    expectProtocolError(
      () =>
        mismatchedReady.acceptControl({
          ...ready(),
          runId: "33333333-3333-4333-8333-333333333333"
        }),
      "INVALID_MESSAGE"
    );

    const mismatchedCompleted = new VoiceStreamServerProtocolState(start());
    mismatchedCompleted.acceptControl(ready());
    mismatchedCompleted.acceptControl(finalTranscript(1));
    mismatchedCompleted.acceptControl(llmFinished(2));
    mismatchedCompleted.acceptControl(outputFinished(3, 0, 0, 0));
    expectProtocolError(
      () =>
        mismatchedCompleted.acceptControl({
          ...completed(4),
          runId: "33333333-3333-4333-8333-333333333333"
        }),
      "INVALID_MESSAGE"
    );
  });

  it("supports a sequence-zero handshake rejection", () => {
    const state = new VoiceStreamServerProtocolState(start());
    state.acceptControl({
      version: 1,
      type: "voice.rejected",
      sessionId,
      sequence: 0,
      runId,
      stage: "session",
      code: "SESSION_LIMIT",
      message: "Too many active sessions"
    });
    expectProtocolError(() => state.acceptControl(ready()), "INVALID_STATE");
  });

  it("rejects tool deltas after a final stop completion", () => {
    const state = new VoiceStreamServerProtocolState(start());
    state.acceptControl(ready());
    state.acceptControl(finalTranscript(1));
    state.acceptControl(llmFinished(2));
    expectProtocolError(
      () =>
        state.acceptControl({
          version: 1,
          type: "voice.llm_tool_delta",
          sessionId,
          sequence: 3,
          completionIndex: 0,
          toolCallIndex: 0,
          toolName: "mock.get_device_status",
          argumentsBytes: 0,
          complete: false
        }),
      "INVALID_STATE"
    );
  });

  it("validates output format, segment ordering, and aggregate totals", () => {
    const state = new VoiceStreamServerProtocolState(start("disabled"));
    state.acceptControl(ready("disabled"));
    state.acceptControl(finalTranscript(1));
    state.acceptControl(llmTextDelta(2, "The light is on."));
    state.acceptControl(outputSegmentStarted(3, 0));
    expectProtocolError(
      () =>
        state.acceptAudio({
          ...pcmFrame("output", 1),
          format: {
            encoding: "pcm16le",
            sampleRate: 8_000,
            channels: 1
          },
          frameSamples: 160,
          data: new Uint8Array(320)
        }),
      "UNSUPPORTED_FORMAT"
    );
    state.acceptAudio(pcmFrame("output", 1));
    state.acceptControl(outputSegmentFinished(4, 0));
    state.acceptControl(llmFinished(5));
    expectProtocolError(
      () => state.acceptControl(outputFinished(6, 2, 640, 20)),
      "INVALID_MESSAGE"
    );
    state.acceptControl(outputFinished(6));
  });

  it("rejects output formats with fractional frame sample counts", () => {
    const state = new VoiceStreamServerProtocolState(start("disabled"));
    state.acceptControl(ready("disabled"));
    state.acceptControl(finalTranscript(1));
    state.acceptControl(llmTextDelta(2, "The light is on."));
    expectProtocolError(
      () =>
        state.acceptControl({
          ...outputSegmentStarted(3, 0),
          format: {
            encoding: "pcm16le",
            sampleRate: 44_100,
            channels: 1,
            frameDurationMs: 5
          }
        }),
      "UNSUPPORTED_FORMAT"
    );
  });
});

function start(
  toolMode: "enabled" | "disabled" = "enabled"
): VoiceStreamClientMessage & {
  type: "voice.start";
} {
  return {
    version: 1,
    type: "voice.start",
    sessionId,
    sequence: 0,
    runId,
    toolMode,
    inputFormat: {
      encoding: "pcm16le",
      sampleRate: 16_000,
      channels: 1,
      frameDurationMs: 20
    }
  };
}

function ready(
  toolMode: "enabled" | "disabled" = "enabled"
): VoiceStreamServerMessage & { type: "voice.ready" } {
  return {
    version: 1,
    type: "voice.ready",
    sessionId,
    sequence: 0,
    runId,
    toolMode,
    inputFormat: start().inputFormat,
    profile: {
      stt: "streaming",
      chat: "streaming",
      tts: "streaming"
    }
  };
}

function finalTranscript(
  sequence: number
): VoiceStreamServerMessage & { type: "voice.final_transcript" } {
  return {
    version: 1,
    type: "voice.final_transcript",
    sessionId,
    sequence,
    text: "Check the light status",
    language: "en"
  };
}

function llmTextDelta(
  sequence: number,
  delta: string
): VoiceStreamServerMessage & { type: "voice.llm_text_delta" } {
  return {
    version: 1,
    type: "voice.llm_text_delta",
    sessionId,
    sequence,
    completionIndex: 0,
    delta
  };
}

function llmFinished(
  sequence: number
): VoiceStreamServerMessage & { type: "voice.llm_finished" } {
  return {
    version: 1,
    type: "voice.llm_finished",
    sessionId,
    sequence,
    completionIndex: 0,
    finishReason: "stop",
    text: "The light is on.",
    usage: null
  };
}

function outputSegmentStarted(
  sequence: number,
  segmentIndex: number
): VoiceStreamServerMessage & { type: "voice.output_segment_started" } {
  return {
    version: 1,
    type: "voice.output_segment_started",
    sessionId,
    sequence,
    segmentIndex,
    text: "The light is on.",
    format: {
      encoding: "pcm16le",
      sampleRate: 16_000,
      channels: 1,
      frameDurationMs: 20
    }
  };
}

function outputSegmentFinished(
  sequence: number,
  segmentIndex: number
): VoiceStreamServerMessage & { type: "voice.output_segment_finished" } {
  return {
    version: 1,
    type: "voice.output_segment_finished",
    sessionId,
    sequence,
    segmentIndex
  };
}

function outputFinished(
  sequence: number,
  segments = 1,
  audioBytes = 640,
  durationMs = 20
): VoiceStreamServerMessage & { type: "voice.output_finished" } {
  return {
    version: 1,
    type: "voice.output_finished",
    sessionId,
    sequence,
    segments,
    audioBytes,
    durationMs
  };
}

function completed(
  sequence: number
): VoiceStreamServerMessage & { type: "voice.completed" } {
  return {
    version: 1,
    type: "voice.completed",
    sessionId,
    sequence,
    conversationId: "conversation-1",
    runId
  };
}

function pcmFrame(
  direction: "input" | "output",
  sequence: number
): VoiceStreamBinaryFrame {
  return {
    version: 1,
    direction,
    sequence,
    format: {
      encoding: "pcm16le",
      sampleRate: 16_000,
      channels: 1
    },
    frameSamples: 320,
    data: new Uint8Array(640)
  };
}

function expectProtocolError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected a VoiceStreamProtocolError");
  } catch (error) {
    expect(error).toBeInstanceOf(VoiceStreamProtocolError);
    expect(error).toMatchObject({ code });
  }
}
