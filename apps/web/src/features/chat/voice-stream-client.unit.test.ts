// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  encodeVoiceStreamBinaryFrame,
  parseVoiceStreamControlMessage,
  type VoiceStreamClientMessage,
  type VoiceStreamServerMessage
} from "@voxmesh/shared";
import type { StreamingAudioChunk } from "@voxmesh/audio";

import type {
  StreamingAudioCapture,
  StreamingAudioPlayback
} from "./browser-streaming-audio.js";
import {
  DefaultBrowserVoiceStreamSession,
  type BrowserVoiceStreamCallbacks
} from "./voice-stream-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DefaultBrowserVoiceStreamSession", () => {
  it("streams capture, protocol state, playback, and final text", async () => {
    const socket = installFakeWebSocket();
    let onChunk: (chunk: StreamingAudioChunk) => void = () => undefined;
    const captureCancel = vi.fn();
    const playbackEnqueue = vi.fn(async () => undefined);
    const playbackFinish = vi.fn(async () => undefined);
    const capture: StreamingAudioCapture = {
      start: vi.fn(
        async (input: {
          onChunk: (chunk: StreamingAudioChunk) => void;
          onLevel: (level: number) => void;
        }) => {
          onChunk = input.onChunk;
          input.onLevel(35);
        }
      ),
      finish: vi.fn(async () => undefined),
      cancel: captureCancel
    };
    const playback: StreamingAudioPlayback = {
      enqueue: playbackEnqueue,
      finish: playbackFinish,
      cancel: vi.fn()
    };
    const callbacks = callbacksMock();
    const session = new DefaultBrowserVoiceStreamSession({
      allowTools: true,
      callbacks,
      createCapture: () => capture,
      createPlayback: () => playback,
      createSocket: () => socket,
      createId: idSequence(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      )
    });
    const started = session.start();
    socket.open();
    const start = parseStart(socket.sent[0]);
    socket.serverControl({
      version: 1,
      type: "voice.ready",
      sessionId: start.sessionId,
      sequence: 0,
      runId: start.runId,
      toolMode: "enabled",
      inputFormat: start.inputFormat,
      profile: { stt: "streaming", chat: "streaming", tts: "streaming" }
    });
    await started;
    expect(callbacks.onState).toHaveBeenLastCalledWith("capturing");
    expect(callbacks.onLevel).toHaveBeenCalledWith(35);

    onChunk({
      sequence: 1,
      format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
      data: new Uint8Array(640)
    });
    await session.finishInput();
    expect(
      socket.sent.filter((entry) => entry instanceof ArrayBuffer)
    ).toHaveLength(1);
    expect(parseClient(socket.sent.at(-1))).toMatchObject({
      type: "voice.input_finished",
      sequence: 1
    });

    socket.serverControl(
      server(start, 1, "voice.partial_transcript", {
        text: "Check"
      })
    );
    socket.serverControl(
      server(start, 2, "voice.final_transcript", {
        text: "Check the light status",
        language: "en"
      })
    );
    socket.serverControl(
      server(start, 3, "voice.llm_text_delta", {
        completionIndex: 0,
        delta: "The light "
      })
    );
    socket.serverControl(
      server(start, 4, "voice.llm_text_delta", {
        completionIndex: 0,
        delta: "is on."
      })
    );
    await socket.flush();
    expect(playbackEnqueue).not.toHaveBeenCalled();

    socket.serverControl(
      server(start, 5, "voice.llm_finished", {
        completionIndex: 0,
        finishReason: "stop",
        text: "The light is on.",
        usage: null
      })
    );
    socket.serverControl(
      server(start, 6, "voice.output_segment_started", {
        segmentIndex: 0,
        text: "The light is on.",
        format: {
          encoding: "pcm16le",
          sampleRate: 16_000,
          channels: 1,
          frameDurationMs: 20
        }
      })
    );
    socket.serverBinary(
      encodeVoiceStreamBinaryFrame({
        version: 1,
        direction: "output",
        sequence: 1,
        format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
        frameSamples: 320,
        data: new Uint8Array(640)
      })
    );
    socket.serverControl(
      server(start, 7, "voice.output_segment_finished", {
        segmentIndex: 0
      })
    );
    socket.serverControl(
      server(start, 8, "voice.output_finished", {
        segments: 1,
        audioBytes: 640,
        durationMs: 20
      })
    );
    socket.serverControl(
      server(start, 9, "voice.completed", {
        conversationId: "conversation-1",
        runId: start.runId
      })
    );
    socket.serverClose();
    await socket.flush();

    expect(callbacks.onPartialTranscript).toHaveBeenCalledWith("Check");
    expect(callbacks.onFinalTranscript).toHaveBeenCalledWith(
      "Check the light status"
    );
    expect(callbacks.onAssistantText).toHaveBeenLastCalledWith(
      "The light is on."
    );
    expect(playbackEnqueue).toHaveBeenCalledOnce();
    expect(playbackFinish).toHaveBeenCalledOnce();
    expect(callbacks.onState).toHaveBeenLastCalledWith("completed");
    expect(captureCancel).toHaveBeenCalled();
  });

  it("plays streaming speech before final LLM completion when tools are disabled", async () => {
    const socket = installFakeWebSocket();
    const playbackEnqueue = vi.fn(async () => undefined);
    const playbackFinish = vi.fn(async () => undefined);
    const capture: StreamingAudioCapture = {
      start: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      cancel: vi.fn()
    };
    const playback: StreamingAudioPlayback = {
      enqueue: playbackEnqueue,
      finish: playbackFinish,
      cancel: vi.fn()
    };
    const session = new DefaultBrowserVoiceStreamSession({
      allowTools: false,
      callbacks: callbacksMock(),
      createCapture: () => capture,
      createPlayback: () => playback,
      createSocket: () => socket,
      createId: idSequence(
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "ffffffff-ffff-4fff-8fff-ffffffffffff"
      )
    });
    const started = session.start();
    socket.open();
    const start = parseStart(socket.sent[0]);
    socket.serverControl({
      version: 1,
      type: "voice.ready",
      sessionId: start.sessionId,
      sequence: 0,
      runId: start.runId,
      toolMode: "disabled",
      inputFormat: start.inputFormat,
      profile: { stt: "streaming", chat: "streaming", tts: "streaming" }
    });
    await started;

    socket.serverControl(
      server(start, 1, "voice.final_transcript", {
        text: "Hello",
        language: "en"
      })
    );
    socket.serverControl(
      server(start, 2, "voice.llm_text_delta", {
        completionIndex: 0,
        delta: "Hi"
      })
    );
    socket.serverControl(
      server(start, 3, "voice.output_segment_started", {
        segmentIndex: 0,
        text: "Hi",
        format: {
          encoding: "pcm16le",
          sampleRate: 16_000,
          channels: 1,
          frameDurationMs: 20
        }
      })
    );
    socket.serverBinary(
      encodeVoiceStreamBinaryFrame({
        version: 1,
        direction: "output",
        sequence: 1,
        format: { encoding: "pcm16le", sampleRate: 16_000, channels: 1 },
        frameSamples: 320,
        data: new Uint8Array(640)
      })
    );
    await socket.flush();

    expect(playbackEnqueue).toHaveBeenCalledOnce();

    socket.serverControl(
      server(start, 4, "voice.llm_finished", {
        completionIndex: 0,
        finishReason: "stop",
        text: "Hi",
        usage: null
      })
    );
    socket.serverControl(
      server(start, 5, "voice.output_segment_finished", {
        segmentIndex: 0
      })
    );
    socket.serverControl(
      server(start, 6, "voice.output_finished", {
        segments: 1,
        audioBytes: 640,
        durationMs: 20
      })
    );
    socket.serverControl(
      server(start, 7, "voice.completed", {
        conversationId: "conversation-2",
        runId: start.runId
      })
    );
    await socket.flush();

    expect(playbackFinish).toHaveBeenCalledOnce();
  });

  it("cancels capture, playback, and socket", async () => {
    const socket = installFakeWebSocket();
    const captureCancel = vi.fn();
    const playbackCancel = vi.fn();
    const capture: StreamingAudioCapture = {
      start: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      cancel: captureCancel
    };
    const playback: StreamingAudioPlayback = {
      enqueue: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      cancel: playbackCancel
    };
    const callbacks = callbacksMock();
    const session = new DefaultBrowserVoiceStreamSession({
      allowTools: false,
      callbacks,
      createCapture: () => capture,
      createPlayback: () => playback,
      createSocket: () => socket,
      createId: idSequence(
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
      )
    });
    const started = session.start();
    socket.open();
    const start = parseStart(socket.sent[0]);
    socket.serverControl({
      version: 1,
      type: "voice.ready",
      sessionId: start.sessionId,
      sequence: 0,
      runId: start.runId,
      toolMode: "disabled",
      inputFormat: start.inputFormat,
      profile: { stt: "streaming", chat: "streaming", tts: "streaming" }
    });
    await started;

    session.cancel();

    expect(parseClient(socket.sent.at(-1))).toMatchObject({
      type: "voice.cancel",
      reason: "user"
    });
    expect(captureCancel).toHaveBeenCalled();
    expect(playbackCancel).toHaveBeenCalled();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(callbacks.onState).toHaveBeenLastCalledWith("cancelled");
  });
});

function callbacksMock(): BrowserVoiceStreamCallbacks {
  return {
    onState: vi.fn(),
    onLevel: vi.fn(),
    onPartialTranscript: vi.fn(),
    onFinalTranscript: vi.fn(),
    onAssistantText: vi.fn(),
    onTool: vi.fn(),
    onPressure: vi.fn(),
    onError: vi.fn()
  };
}

class FakeWebSocket extends EventTarget {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public readyState = FakeWebSocket.CONNECTING;
  public binaryType = "";
  public readonly sent: Array<string | ArrayBuffer> = [];
  private processing = Promise.resolve();

  public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data === "string") {
      this.sent.push(data);
    } else if (ArrayBuffer.isView(data)) {
      const copy = new Uint8Array(data.byteLength);
      copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      this.sent.push(copy.buffer);
    } else if (data instanceof ArrayBuffer) {
      this.sent.push(data);
    }
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  }

  public open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  public serverControl(message: VoiceStreamServerMessage): void {
    this.queue(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  public serverBinary(data: Uint8Array): void {
    this.queue(new MessageEvent("message", { data: data.buffer }));
  }

  public serverClose(): void {
    this.processing = this.processing.then(async () => {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
      await Promise.resolve();
    });
  }

  public flush(): Promise<void> {
    return this.processing;
  }

  private queue(event: MessageEvent): void {
    this.processing = this.processing.then(async () => {
      this.dispatchEvent(event);
      await Promise.resolve();
    });
  }
}

function installFakeWebSocket(): FakeWebSocket {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  return new FakeWebSocket();
}

function parseClient(value: string | ArrayBuffer | undefined) {
  if (typeof value !== "string") throw new Error("Expected client control");
  const parsed = parseVoiceStreamControlMessage(value);
  if (
    !parsed ||
    (parsed.type !== "voice.start" &&
      parsed.type !== "voice.input_finished" &&
      parsed.type !== "voice.cancel")
  ) {
    throw new Error("Expected valid client control");
  }

  return parsed;
}

function parseStart(
  value: string | ArrayBuffer | undefined
): Extract<VoiceStreamClientMessage, { type: "voice.start" }> {
  const parsed = parseClient(value);
  if (parsed.type !== "voice.start") throw new Error("Expected start control");
  return parsed;
}

function server<
  T extends VoiceStreamServerMessage["type"],
  M extends Extract<VoiceStreamServerMessage, { type: T }>
>(
  start: Extract<VoiceStreamClientMessage, { type: "voice.start" }>,
  sequence: number,
  type: T,
  payload: Omit<M, "version" | "sessionId" | "sequence" | "type">
): M {
  return {
    version: 1,
    sessionId: start.sessionId,
    sequence,
    type,
    ...payload
  } as M;
}

function idSequence(...ids: string[]): () => string {
  return () => {
    const next = ids.shift();
    if (!next) throw new Error("No test ID remains");
    return next;
  };
}
