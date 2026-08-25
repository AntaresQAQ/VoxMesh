import { describe, expect, it, vi } from "vitest";

import {
  AgentRunCancelledError,
  MockLlmProvider,
  MockMcpServer,
  MockStreamingLlmProvider,
  type LlmProvider,
  type StreamingLlmProvider
} from "@voxmesh/agent-core";
import {
  MockSpeechToTextProvider,
  MockStreamingSpeechToTextProvider,
  MockStreamingTextToSpeechProvider,
  MockTextToSpeechProvider,
  type SpeechToTextProvider,
  type StreamingAudioChunk,
  type StreamingSpeechToTextProvider,
  type StreamingTextToSpeechProvider,
  type TextToSpeechProvider
} from "@voxmesh/audio";
import { VoxMeshStore } from "@voxmesh/storage";

import {
  StreamingVoiceCoordinator,
  type StreamingVoiceCoordinatorError,
  type StreamingVoiceCoordinatorEvent,
  type StreamingVoiceCoordinatorProviders,
  type StreamingVoiceCoordinatorResult
} from "./streaming-voice-coordinator.js";
import { prepareStreamingVoiceRun } from "./streaming-voice-providers.js";

const format = {
  encoding: "pcm16le",
  sampleRate: 16_000,
  channels: 1
} as const;

describe("StreamingVoiceCoordinator", () => {
  for (let mask = 0; mask < 8; mask += 1) {
    const sttStreaming = (mask & 4) !== 0;
    const chatStreaming = (mask & 2) !== 0;
    const ttsStreaming = (mask & 1) !== 0;
    it(`completes STT=${transport(sttStreaming)}, Chat=${transport(chatStreaming)}, TTS=${transport(ttsStreaming)}`, async () => {
      const store = new VoxMeshStore(":memory:");
      try {
        const calls = createTrackedProviders();
        const routeId = createRoute(store, {
          stt: sttStreaming,
          chat: chatStreaming,
          tts: ttsStreaming
        });
        const consumed = await consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: runId(mask),
            preparation: preparation(store, routeId, calls.providers),
            format,
            audio: audioFrames(),
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        );

        expect(consumed.result).toMatchObject({
          transcript: "Check the light status",
          response: "Mock tool reports living-room-light is on.",
          usedTools: ["mock.get_device_status"]
        });
        expect(consumed.result.audioBytes).toBeGreaterThan(0);
        expect(consumed.events.some((event) => event.type === "audio")).toBe(
          true
        );
        expect(
          consumed.events.some((event) => event.type === "transcript_partial")
        ).toBe(sttStreaming);
        expect(calls.bufferedStt).toHaveBeenCalledTimes(sttStreaming ? 0 : 1);
        expect(calls.streamingStt).toHaveBeenCalledTimes(sttStreaming ? 1 : 0);
        expect(calls.bufferedLlm).toHaveBeenCalledTimes(chatStreaming ? 0 : 2);
        expect(calls.streamingLlm).toHaveBeenCalledTimes(chatStreaming ? 2 : 0);
        expect(calls.bufferedTts).toHaveBeenCalledTimes(ttsStreaming ? 0 : 1);
        expect(calls.streamingTts).toHaveBeenCalledTimes(ttsStreaming ? 1 : 0);
        const audioSequences = consumed.events
          .filter((event) => event.type === "audio")
          .map((event) => event.chunk.sequence);
        expect(audioSequences).toEqual(
          audioSequences.map((_, index) => index + 1)
        );
        if (chatStreaming && ttsStreaming) {
          const finalCompletion = consumed.events.findIndex(
            (event) =>
              event.type === "agent" &&
              event.event.type === "completion_finished" &&
              event.event.finishReason === "stop"
          );
          expect(
            consumed.events.findIndex(
              (event) =>
                event.type === "stage" &&
                event.stage === "TTS" &&
                event.status === "started"
            )
          ).toBeLessThan(finalCompletion);
          expect(
            consumed.events.findIndex((event) => event.type === "audio")
          ).toBeGreaterThan(finalCompletion);
        }

        const detail = store.getConversation(consumed.result.conversationId);
        expect(
          detail?.messages.map(({ role, content }) => ({ role, content }))
        ).toEqual([
          { role: "user", content: "Check the light status" },
          {
            role: "assistant",
            content: "Mock tool reports living-room-light is on."
          }
        ]);
        expect(detail?.runs[0]).toMatchObject({
          id: runId(mask),
          kind: "voice-composed",
          status: "completed"
        });
        expect(
          detail?.events.filter(
            (event) => event.stage === "TTS" && event.status === "completed"
          )
        ).toHaveLength(1);
      } finally {
        store.close();
      }
    });
  }

  it("cancels a late buffered provider result without persisting messages", async () => {
    const store = new VoxMeshStore(":memory:");
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const providers = createTrackedProviders().providers;
    providers.bufferedStt = {
      transcribe: async () => {
        release?.();
        await pending;
        return { text: "Late transcript", language: "en" };
      }
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: false
      });
      const execution = consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "30303030-3030-4030-8030-303030303030",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "enabled",
          signal: controller.signal
        })
      );
      await started;
      controller.abort();
      finish?.();

      await expect(execution).rejects.toBeInstanceOf(AgentRunCancelledError);
      const run = store.getConversationRun(
        "30303030-3030-4030-8030-303030303030"
      );
      expect(run.status).toBe("cancelled");
      const detail = store.getConversation(run.conversationId);
      expect(detail?.messages).toEqual([]);
      expect(
        detail?.events.some(
          (event) => event.stage === "STT" && event.status === "cancelled"
        )
      ).toBe(true);
    } finally {
      store.close();
    }
  });

  it("cancels provider work when the event consumer closes early", async () => {
    const store = new VoxMeshStore(":memory:");
    try {
      const routeId = createRoute(store, {
        stt: true,
        chat: true,
        tts: true
      });
      const providers = createTrackedProviders().providers;
      providers.streamingStt = new MockStreamingSpeechToTextProvider({
        eventDelayMs: 50
      });
      const run = new StreamingVoiceCoordinator(store, new MockMcpServer()).run(
        {
          runId: "36363636-3636-4636-8636-363636363636",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "enabled",
          signal: new AbortController().signal
        }
      );

      expect((await run.next()).done).toBe(false);
      await run.return({} as StreamingVoiceCoordinatorResult);
      expect(
        store.getConversationRun("36363636-3636-4636-8636-363636363636")
      ).toMatchObject({
        status: "cancelled",
        errorCode: "RUN_CANCELLED"
      });
    } finally {
      store.close();
    }
  });

  it("keeps the captured route unchanged while configuration changes", async () => {
    const store = new VoxMeshStore(":memory:");
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const providers = createTrackedProviders().providers;
    providers.bufferedStt = {
      transcribe: async () => {
        release?.();
        await pending;
        return { text: "Check the light status", language: "en" };
      }
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: false
      });
      const execution = consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "34343434-3434-4434-8434-343434343434",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "enabled",
          signal: new AbortController().signal
        })
      );
      await started;
      const route = store.getRuntimeRoute(routeId);
      store.updateRuntimeRoute(routeId, {
        displayName: "Changed During Run",
        mode: route.mode,
        sttModelDeploymentId: route.sttModelDeploymentId,
        chatModelDeploymentId: route.chatModelDeploymentId,
        ttsModelDeploymentId: route.ttsModelDeploymentId,
        nativeModelDeploymentId: route.nativeModelDeploymentId,
        fallbackRouteId: route.fallbackRouteId,
        sttStreamingEnabled: route.sttStreamingEnabled,
        chatStreamingEnabled: route.chatStreamingEnabled,
        ttsStreamingEnabled: true,
        enabled: route.enabled
      });
      finish?.();
      const consumed = await execution;

      expect(
        store
          .getVoiceRunRouteSnapshot(consumed.result.runId)
          .assignments.find((entry) => entry.role === "tts")?.streamingEnabled
      ).toBe(false);
      expect(store.getRuntimeRoute(routeId).ttsStreamingEnabled).toBe(true);
    } finally {
      store.close();
    }
  });

  it("persists safe failure state without provider error text", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.bufferedStt = {
      transcribe: async () => {
        throw new Error("secret-token provider.example.test");
      }
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: false
      });
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "31313131-3131-4131-8131-313131313131",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({
        code: "STT_FAILED",
        message: "Streaming STT stage failed"
      } satisfies Partial<StreamingVoiceCoordinatorError>);
      const run = store.getConversationRun(
        "31313131-3131-4131-8131-313131313131"
      );
      expect(run).toMatchObject({
        status: "failed",
        errorCode: "STT_FAILED"
      });
      expect(
        JSON.stringify(store.getConversation(run.conversationId))
      ).not.toContain("secret-token");
      expect(
        JSON.stringify(store.getConversation(run.conversationId))
      ).not.toContain("provider.example.test");
    } finally {
      store.close();
    }
  });

  it("classifies streaming synthesis failures as TTS failures", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.streamingTts = new MockStreamingTextToSpeechProvider({
      failAtChunk: 1
    });
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: true
      });
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "33333333-3333-4333-8333-333333333333",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toBeDefined();
      expect(
        store.getConversationRun("33333333-3333-4333-8333-333333333333")
      ).toMatchObject({
        status: "failed",
        errorCode: "TTS_FAILED"
      });
    } finally {
      store.close();
    }
  });

  it("records early TTS cancellation when the streaming Agent fails", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.streamingLlm = {
      stream: async function* () {
        yield {
          type: "text_delta",
          content: "Early text that should be cancelled. "
        };
        throw new Error("Agent provider failed");
      }
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: true,
        tts: true
      });
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "38383838-3838-4838-8838-383838383838",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "disabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "AGENT_FAILED" });
      const run = store.getConversationRun(
        "38383838-3838-4838-8838-383838383838"
      );
      expect(
        store
          .getConversation(run.conversationId)
          ?.events.some(
            (event) => event.stage === "TTS" && event.status === "cancelled"
          )
      ).toBe(true);
    } finally {
      store.close();
    }
  });

  it("releases stable streaming speech before a tool-disabled completion ends", async () => {
    const store = new VoxMeshStore(":memory:");
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const providers = createTrackedProviders().providers;
    providers.streamingLlm = {
      stream: async function* () {
        yield {
          type: "text_delta",
          content: "This is an early spoken sentence. "
        };
        await pending;
        yield { type: "completed", finishReason: "stop" };
      }
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: true,
        tts: true
      });
      const run = new StreamingVoiceCoordinator(store, new MockMcpServer()).run(
        {
          runId: "37373737-3737-4737-8737-373737373737",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "disabled",
          signal: new AbortController().signal
        }
      );
      const events: StreamingVoiceCoordinatorEvent[] = [];
      while (!events.some((event) => event.type === "audio")) {
        const next = await Promise.race([
          run.next(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Early TTS audio was not emitted")),
              1_000
            )
          )
        ]);
        if (next.done) throw new Error("Coordinator completed before audio");
        events.push(next.value);
      }
      expect(
        events.some(
          (event) =>
            event.type === "stage" &&
            event.stage === "AGENT" &&
            event.status === "completed"
        )
      ).toBe(false);
      release?.();
      const result = await consumeRemaining(run, events);
      expect(result.response).toBe("This is an early spoken sentence. ");
    } finally {
      store.close();
    }
  });

  it("completes an in-process Mock full-chain session from route configuration", async () => {
    const store = new VoxMeshStore(":memory:");
    try {
      const routeId = createRoute(store, {
        stt: true,
        chat: true,
        tts: true
      });
      const consumed = await consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "32323232-3232-4232-8232-323232323232",
          preparation: prepareStreamingVoiceRun(store, routeId),
          format,
          audio: audioFrames(),
          toolMode: "enabled",
          signal: new AbortController().signal
        })
      );

      expect(consumed.result).toMatchObject({
        transcript: "Check the light status",
        response: "Mock tool reports living-room-light is on."
      });
      expect(
        store
          .getVoiceRunRouteSnapshot(consumed.result.runId)
          .assignments.map(({ role, streamingEnabled }) => ({
            role,
            streamingEnabled
          }))
      ).toEqual([
        { role: "stt", streamingEnabled: true },
        { role: "chat", streamingEnabled: true },
        { role: "tts", streamingEnabled: true }
      ]);
    } finally {
      store.close();
    }
  });
});

function createTrackedProviders(): {
  providers: StreamingVoiceCoordinatorProviders;
  bufferedStt: ReturnType<typeof vi.fn>;
  streamingStt: ReturnType<typeof vi.fn>;
  bufferedLlm: ReturnType<typeof vi.fn>;
  streamingLlm: ReturnType<typeof vi.fn>;
  bufferedTts: ReturnType<typeof vi.fn>;
  streamingTts: ReturnType<typeof vi.fn>;
} {
  const bufferedStt = vi.fn(
    new MockSpeechToTextProvider().transcribe.bind(
      new MockSpeechToTextProvider()
    )
  );
  const streamingStt = vi.fn(
    new MockStreamingSpeechToTextProvider().startSession.bind(
      new MockStreamingSpeechToTextProvider()
    )
  );
  const bufferedLlm = vi.fn(
    new MockLlmProvider().complete.bind(new MockLlmProvider())
  );
  const streamingLlm = vi.fn(
    new MockStreamingLlmProvider().stream.bind(new MockStreamingLlmProvider())
  );
  const bufferedTts = vi.fn(
    new MockTextToSpeechProvider().synthesize.bind(
      new MockTextToSpeechProvider()
    )
  );
  const streamingTts = vi.fn(
    new MockStreamingTextToSpeechProvider().startSynthesis.bind(
      new MockStreamingTextToSpeechProvider()
    )
  );
  return {
    providers: {
      bufferedStt: { transcribe: bufferedStt } satisfies SpeechToTextProvider,
      streamingStt: {
        startSession: streamingStt
      } satisfies StreamingSpeechToTextProvider,
      bufferedLlm: { complete: bufferedLlm } satisfies LlmProvider,
      streamingLlm: { stream: streamingLlm } satisfies StreamingLlmProvider,
      bufferedTts: { synthesize: bufferedTts } satisfies TextToSpeechProvider,
      streamingTts: {
        startSynthesis: streamingTts
      } satisfies StreamingTextToSpeechProvider
    },
    bufferedStt,
    streamingStt,
    bufferedLlm,
    streamingLlm,
    bufferedTts,
    streamingTts
  };
}

function preparation(
  store: VoxMeshStore,
  routeId: string,
  providers: StreamingVoiceCoordinatorProviders
) {
  return {
    route: store.captureRuntimeVoiceRouteSnapshot(routeId),
    providers
  };
}

function createRoute(
  store: VoxMeshStore,
  input: {
    stt: boolean;
    chat: boolean;
    tts: boolean;
  }
): string {
  let routing = store.createRuntimeConnection({
    providerId: "mock",
    displayName: `Coordinator Mock ${Number(input.stt)}${Number(input.chat)}${Number(input.tts)}`,
    endpoint: "",
    enabled: true
  });
  const connection = routing.connections.find((entry) =>
    entry.displayName.startsWith("Coordinator Mock")
  );
  routing = store.createRuntimeModel({
    connectionId: connection?.id ?? "",
    displayName: "Coordinator Multi-role Model",
    modelName: "coordinator-mock",
    apiVersion: "",
    providerOptions: {},
    declaredCapabilities: [
      "audio-input",
      "audio-output",
      "text-input",
      "text-output",
      "transcription",
      "speech-synthesis",
      "tool-calling",
      "non-streaming",
      "streaming"
    ],
    enabled: true
  });
  const model = routing.models.find(
    (entry) => entry.displayName === "Coordinator Multi-role Model"
  );
  routing = store.createRuntimeRoute({
    displayName: "Coordinator Route",
    mode: "composed",
    sttModelDeploymentId: model?.id ?? null,
    chatModelDeploymentId: model?.id ?? null,
    ttsModelDeploymentId: model?.id ?? null,
    nativeModelDeploymentId: null,
    fallbackRouteId: null,
    sttStreamingEnabled: input.stt,
    chatStreamingEnabled: input.chat,
    ttsStreamingEnabled: input.tts,
    enabled: true
  });
  return (
    routing.routes.find((entry) => entry.displayName === "Coordinator Route")
      ?.id ?? ""
  );
}

async function* audioFrames(): AsyncGenerator<StreamingAudioChunk> {
  for (let sequence = 1; sequence <= 2; sequence += 1) {
    yield {
      sequence,
      format,
      data: new Uint8Array(640)
    };
  }
}

async function consume(
  run: AsyncGenerator<
    StreamingVoiceCoordinatorEvent,
    StreamingVoiceCoordinatorResult
  >
): Promise<{
  events: StreamingVoiceCoordinatorEvent[];
  result: StreamingVoiceCoordinatorResult;
}> {
  const events: StreamingVoiceCoordinatorEvent[] = [];
  while (true) {
    const next = await run.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

async function consumeRemaining(
  run: AsyncGenerator<
    StreamingVoiceCoordinatorEvent,
    StreamingVoiceCoordinatorResult
  >,
  events: StreamingVoiceCoordinatorEvent[]
): Promise<StreamingVoiceCoordinatorResult> {
  while (true) {
    const next = await run.next();
    if (next.done) return next.value;
    events.push(next.value);
  }
}

function runId(mask: number): string {
  return `40404040-4040-4040-8040-${String(mask).padStart(12, "0")}`;
}

function transport(streaming: boolean): string {
  return streaming ? "streaming" : "buffered";
}
