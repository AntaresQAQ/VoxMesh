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
  encodePcm16Wav,
  MockSpeechToTextProvider,
  MockStreamingSpeechToTextProvider,
  MockStreamingTextToSpeechProvider,
  MockTextToSpeechProvider,
  type AudioData,
  type SpeechToTextProvider,
  type StreamingAudioChunk,
  type StreamingSpeechToTextProvider,
  type StreamingSpeechToTextSession,
  type StreamingTextToSpeechProvider,
  type StreamingTextToSpeechSession,
  type TextToSpeechProvider
} from "@voxmesh/audio";
import { VOICE_STREAM_LIMITS } from "@voxmesh/shared";
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
        const outputCompleted = consumed.events.find(
          (event) => event.type === "audio_completed"
        );
        const segmentStarted = consumed.events.filter(
          (event) => event.type === "segment_started"
        );
        const segmentFinished = consumed.events.filter(
          (event) => event.type === "segment_finished"
        );
        expect(segmentStarted).toHaveLength(outputCompleted?.segments ?? -1);
        expect(segmentFinished).toHaveLength(outputCompleted?.segments ?? -1);
        expect(
          segmentStarted.every((event) => event.format.frameDurationMs === 20)
        ).toBe(true);
        expect(
          segmentStarted.map((event) => ({
            segmentIndex: event.segmentIndex,
            text: event.text
          }))
        ).toEqual(
          segmentFinished.map((event) => ({
            segmentIndex: event.segmentIndex,
            text:
              segmentStarted.find(
                (started) => started.segmentIndex === event.segmentIndex
              )?.text ?? ""
          }))
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
        stt: false,
        chat: true,
        tts: true
      });
      const providers = createTrackedProviders().providers;
      providers.bufferedStt = {
        transcribe: async (_audio, options) =>
          new Promise((_, reject) => {
            const signal = options?.signal;
            if (signal?.aborted) {
              reject(new AgentRunCancelledError());
              return;
            }
            signal?.addEventListener(
              "abort",
              () => reject(new AgentRunCancelledError()),
              { once: true }
            );
          })
      };
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

  it("records output pressure and recovery against the originating stage", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.streamingTts = new MockStreamingTextToSpeechProvider({
      chunkCount: 240,
      chunkDurationMs: 20
    });
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: true
      });
      const run = new StreamingVoiceCoordinator(store, new MockMcpServer()).run(
        {
          runId: "57575757-5757-4757-8757-575757575757",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "enabled",
          signal: new AbortController().signal
        }
      );
      await waitForLog(store, "TTS output queue entered high pressure");
      await consumeRemaining(run, []);

      const messages = store
        .listLogs()
        .filter((entry) => entry.conversationId !== null)
        .map((entry) => entry.message);
      expect(messages).toContain("TTS output queue entered high pressure");
      expect(messages).toContain("TTS output queue pressure recovered");
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

  it("rejects empty, malformed, and unbounded streaming input", async () => {
    for (const audio of [
      emptyFrames(),
      malformedFrames(),
      oversizedSingleFrame(),
      oversizedFrames()
    ]) {
      const store = new VoxMeshStore(":memory:");
      try {
        const routeId = createRoute(store, {
          stt: true,
          chat: false,
          tts: false
        });
        await expect(
          consume(
            new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
              runId: crypto.randomUUID(),
              preparation: preparation(
                store,
                routeId,
                createTrackedProviders().providers
              ),
              format,
              audio,
              toolMode: "enabled",
              signal: new AbortController().signal
            })
          )
        ).rejects.toMatchObject({ code: "STT_FAILED" });
      } finally {
        store.close();
      }
    }
  });

  it("rejects duplicate Streaming STT final events", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.streamingStt = duplicateFinalSttProvider();
    try {
      const routeId = createRoute(store, {
        stt: true,
        chat: false,
        tts: false
      });
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "46464646-4646-4646-8646-464646464646",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "STT_FAILED" });
    } finally {
      store.close();
    }
  });

  it("stops waiting for input when the streaming STT iterator fails", async () => {
    const store = new VoxMeshStore(":memory:");
    let inputReturned = false;
    const providers = createTrackedProviders().providers;
    providers.streamingStt = {
      startSession: async () => ({
        write: async () => undefined,
        finishInput: async () => undefined,
        close: async () => undefined,
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            throw new Error("STT provider failed");
          }
        })
      })
    };
    try {
      const routeId = createRoute(store, {
        stt: true,
        chat: false,
        tts: false
      });
      await expect(
        Promise.race([
          consume(
            new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
              runId: "39393939-3939-4939-8939-393939393939",
              preparation: preparation(store, routeId, providers),
              format,
              audio: pendingFrames(() => {
                inputReturned = true;
              }),
              toolMode: "enabled",
              signal: new AbortController().signal
            })
          ),
          rejectAfter("STT failure did not interrupt input", 1_000)
        ])
      ).rejects.toMatchObject({ code: "STT_FAILED" });
      expect(inputReturned).toBe(true);
    } finally {
      store.close();
    }
  });

  it("aborts while waiting for another streaming input frame", async () => {
    const store = new VoxMeshStore(":memory:");
    const controller = new AbortController();
    let inputReturned = false;
    let inputWaiting: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      inputWaiting = resolve;
    });
    try {
      const routeId = createRoute(store, {
        stt: true,
        chat: false,
        tts: false
      });
      const execution = consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "41414141-4141-4141-8141-414141414141",
          preparation: preparation(
            store,
            routeId,
            createTrackedProviders().providers
          ),
          format,
          audio: pendingFrames(() => {
            inputReturned = true;
          }, inputWaiting),
          toolMode: "enabled",
          signal: controller.signal
        })
      );
      await waiting;
      controller.abort();
      await expect(
        Promise.race([
          execution,
          rejectAfter("Cancellation did not interrupt input", 1_000)
        ])
      ).rejects.toBeInstanceOf(AgentRunCancelledError);
      expect(inputReturned).toBe(true);
    } finally {
      store.close();
    }
  });

  it("aborts while waiting for another buffered input frame", async () => {
    const store = new VoxMeshStore(":memory:");
    const controller = new AbortController();
    let inputReturned = false;
    let inputWaiting: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      inputWaiting = resolve;
    });
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: false
      });
      const execution = consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "48484848-4848-4848-8848-484848484848",
          preparation: preparation(
            store,
            routeId,
            createTrackedProviders().providers
          ),
          format,
          audio: pendingFrames(() => {
            inputReturned = true;
          }, inputWaiting),
          toolMode: "enabled",
          signal: controller.signal
        })
      );
      await waiting;
      controller.abort();
      await expect(execution).rejects.toBeInstanceOf(AgentRunCancelledError);
      expect(inputReturned).toBe(true);
    } finally {
      store.close();
    }
  });

  it("rejects invalid final transcript and oversized buffered Chat output", async () => {
    const store = new VoxMeshStore(":memory:");
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: false
      });
      const invalidTranscript = createTrackedProviders().providers;
      invalidTranscript.bufferedStt = {
        transcribe: async () => ({ text: "", language: "" })
      };
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "42424242-4242-4242-8242-424242424242",
            preparation: preparation(store, routeId, invalidTranscript),
            format,
            audio: audioFrames(),
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "STT_FAILED" });

      const oversizedChat = createTrackedProviders();
      oversizedChat.providers.bufferedLlm = {
        complete: async () => ({
          type: "message",
          content: "x".repeat(VOICE_STREAM_LIMITS.maxAssistantCharacters + 1)
        })
      };
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "43434343-4343-4343-8343-434343434343",
            preparation: preparation(store, routeId, oversizedChat.providers),
            format,
            audio: audioFrames(),
            toolMode: "disabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "AGENT_FAILED" });
      expect(oversizedChat.bufferedTts).not.toHaveBeenCalled();

      const whitespaceChat = createTrackedProviders();
      whitespaceChat.providers.bufferedLlm = {
        complete: async () => ({ type: "message", content: "   " })
      };
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "54545454-5454-4454-8454-545454545454",
            preparation: preparation(store, routeId, whitespaceChat.providers),
            format,
            audio: audioFrames(),
            toolMode: "disabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "AGENT_FAILED" });
      expect(whitespaceChat.bufferedTts).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });

  it("splits long buffered response metadata within protocol segment limits", async () => {
    const store = new VoxMeshStore(":memory:");
    const tracked = createTrackedProviders();
    const providers = tracked.providers;
    const response = "😀".repeat(250);
    providers.bufferedLlm = {
      complete: async () => ({ type: "message", content: response })
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: false
      });
      const consumed = await consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "47474747-4747-4747-8747-474747474747",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "disabled",
          signal: new AbortController().signal
        })
      );
      const segments = consumed.events.filter(
        (event) => event.type === "segment_started"
      );
      expect(segments.map((segment) => segment.text).join("")).toBe(response);
      expect(
        segments.every(
          (segment) =>
            segment.text.length <= VOICE_STREAM_LIMITS.maxTtsSegmentCharacters
        )
      ).toBe(true);
      expect(
        consumed.events.find((event) => event.type === "audio_completed")
      ).toMatchObject({ segments: 3 });
      expect(tracked.bufferedTts).toHaveBeenCalledTimes(3);
    } finally {
      store.close();
    }
  });

  it("rejects inconsistent streaming TTS completion metadata", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.streamingTts = {
      startSynthesis: async () => scriptedInvalidTtsSession()
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: true
      });
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "44444444-4444-4444-8444-444444444444",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "TTS_FAILED" });
    } finally {
      store.close();
    }
  });

  it("copies provider-owned streaming audio buffers before queueing", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.streamingTts = {
      startSynthesis: async () => reusedBufferTtsSession()
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: true
      });
      const consumed = await consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "55555555-5555-4555-8555-555555555555",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "enabled",
          signal: new AbortController().signal
        })
      );
      const audio = consumed.events.filter((event) => event.type === "audio");
      expect(audio[0]?.chunk.data[0]).toBe(1);
      expect(audio[1]?.chunk.data[0]).toBe(2);
    } finally {
      store.close();
    }
  });

  it("rejects a fractional streaming TTS frame duration", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.streamingTts = {
      startSynthesis: async () => fractionalFrameTtsSession()
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: true
      });
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "49494949-4949-4949-8949-494949494949",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "TTS_FAILED" });
    } finally {
      store.close();
    }
  });

  it("selects an integral frame duration for buffered TTS output", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.bufferedTts = new MockTextToSpeechProviderAtRate(
      11_025,
      "Audio/WAV; charset=binary"
    );
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: false
      });
      const consumed = await consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "50505050-5050-4050-8050-505050505050",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "enabled",
          signal: new AbortController().signal
        })
      );
      expect(
        consumed.events.find((event) => event.type === "segment_started")
      ).toMatchObject({
        format: { sampleRate: 11_025, frameDurationMs: 40 }
      });
      expect(
        consumed.events
          .filter((event) => event.type === "audio")
          .every((event) => event.chunk.data.byteLength === 882)
      ).toBe(true);
    } finally {
      store.close();
    }
  });

  it("rejects buffered TTS sample rates outside protocol bounds", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.bufferedTts = new MockTextToSpeechProviderAtRate(192_000);
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: false
      });
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "52525252-5252-4252-8252-525252525252",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "TTS_FAILED" });
    } finally {
      store.close();
    }
  });

  it("rejects oversized buffered TTS bytes before WAV decoding", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.bufferedTts = {
      synthesize: async () => ({
        data: new Uint8Array(
          VOICE_STREAM_LIMITS.maxBufferedTtsBytes +
            VOICE_STREAM_LIMITS.maxBinaryMessageBytes +
            1
        ),
        mimeType: "audio/wav"
      })
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
            runId: "58585858-5858-4858-8858-585858585858",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "TTS_FAILED" });
    } finally {
      store.close();
    }
  });

  it("times out a buffered provider that never resolves", async () => {
    vi.useFakeTimers();
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.bufferedStt = {
      transcribe: () => new Promise(() => undefined)
    };
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: false,
        tts: false
      });
      const execution = consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "45454545-4545-4545-8545-454545454545",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "enabled",
          signal: new AbortController().signal
        })
      );
      const rejection = expect(execution).rejects.toMatchObject({
        code: "STT_FAILED"
      });
      await vi.advanceTimersByTimeAsync(
        VOICE_STREAM_LIMITS.providerStageTimeoutMs + 1
      );
      await rejection;
    } finally {
      vi.useRealTimers();
      store.close();
    }
  });

  it("closes a streaming STT session that resolves after start timeout", async () => {
    vi.useFakeTimers();
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    let resolveSession:
      ((session: StreamingSpeechToTextSession) => void) | undefined;
    const close = vi.fn(async () => undefined);
    providers.streamingStt = {
      startSession: () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        })
    };
    try {
      const routeId = createRoute(store, {
        stt: true,
        chat: false,
        tts: false
      });
      const execution = consume(
        new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
          runId: "53535353-5353-4353-8353-535353535353",
          preparation: preparation(store, routeId, providers),
          format,
          audio: audioFrames(),
          toolMode: "enabled",
          signal: new AbortController().signal
        })
      );
      const rejection = expect(execution).rejects.toMatchObject({
        code: "STT_FAILED"
      });
      await vi.advanceTimersByTimeAsync(
        VOICE_STREAM_LIMITS.providerStageTimeoutMs + 1
      );
      await rejection;
      resolveSession?.({
        write: async () => undefined,
        finishInput: async () => undefined,
        close,
        [Symbol.asyncIterator]: async function* () {}
      });
      vi.runAllTicks();
      await Promise.resolve();
      await Promise.resolve();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
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

  it("preserves TTS failure classification while the Agent is active", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.streamingLlm = {
      stream: async function* () {
        yield {
          type: "text_delta",
          content: "This sentence starts synthesis early. "
        };
        await new Promise(() => undefined);
      }
    };
    providers.streamingTts = new MockStreamingTextToSpeechProvider({
      failAtChunk: 1
    });
    try {
      const routeId = createRoute(store, {
        stt: false,
        chat: true,
        tts: true
      });
      await expect(
        consume(
          new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
            runId: "51515151-5151-4151-8151-515151515151",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "disabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "TTS_FAILED" });
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

  it("classifies an empty streaming completion as an Agent failure", async () => {
    const store = new VoxMeshStore(":memory:");
    const providers = createTrackedProviders().providers;
    providers.streamingLlm = {
      stream: async function* () {
        yield { type: "completed", finishReason: "stop" };
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
            runId: "56565656-5656-4656-8656-565656565656",
            preparation: preparation(store, routeId, providers),
            format,
            audio: audioFrames(),
            toolMode: "disabled",
            signal: new AbortController().signal
          })
        )
      ).rejects.toMatchObject({ code: "AGENT_FAILED" });
      const run = store.getConversationRun(
        "56565656-5656-4656-8656-565656565656"
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

async function* emptyFrames(): AsyncGenerator<StreamingAudioChunk> {}

async function* malformedFrames(): AsyncGenerator<StreamingAudioChunk> {
  yield { sequence: 2, format, data: new Uint8Array(640) };
}

async function* oversizedFrames(): AsyncGenerator<StreamingAudioChunk> {
  const frames = Math.floor(VOICE_STREAM_LIMITS.maxBufferedSttBytes / 640) + 2;
  for (let sequence = 1; sequence <= frames; sequence += 1) {
    yield { sequence, format, data: new Uint8Array(640) };
  }
}

async function* oversizedSingleFrame(): AsyncGenerator<StreamingAudioChunk> {
  yield {
    sequence: 1,
    format,
    data: new Uint8Array(VOICE_STREAM_LIMITS.maxBinaryMessageBytes)
  };
}

function pendingFrames(
  onReturn: () => void,
  onPending?: () => void
): AsyncIterable<StreamingAudioChunk> {
  let emitted = false;
  return {
    [Symbol.asyncIterator](): AsyncIterator<StreamingAudioChunk> {
      return {
        next: async () => {
          if (!emitted) {
            emitted = true;
            return {
              done: false,
              value: {
                sequence: 1,
                format,
                data: new Uint8Array(640)
              }
            };
          }
          onPending?.();
          return new Promise<IteratorResult<StreamingAudioChunk>>(
            () => undefined
          );
        },
        return: async () => {
          onReturn();
          return { done: true, value: undefined };
        }
      };
    }
  };
}

function scriptedInvalidTtsSession(): StreamingTextToSpeechSession {
  return {
    close: async () => undefined,
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: "audio" as const,
        chunk: {
          sequence: 1,
          format,
          data: new Uint8Array(640)
        }
      };
      yield {
        type: "completed" as const,
        sequence: 2,
        format,
        audioBytes: 1,
        durationMs: 20
      };
    }
  };
}

function fractionalFrameTtsSession(): StreamingTextToSpeechSession {
  const outputFormat = {
    encoding: "pcm16le",
    sampleRate: 22_050,
    channels: 1
  } as const;
  return {
    close: async () => undefined,
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: "audio" as const,
        chunk: {
          sequence: 1,
          format: outputFormat,
          data: new Uint8Array(880)
        }
      };
      yield {
        type: "completed" as const,
        sequence: 2,
        format: outputFormat,
        audioBytes: 880,
        durationMs: 20
      };
    }
  };
}

function reusedBufferTtsSession(): StreamingTextToSpeechSession {
  const data = new Uint8Array(640);
  return {
    close: async () => undefined,
    [Symbol.asyncIterator]: async function* () {
      data.fill(1);
      yield {
        type: "audio" as const,
        chunk: { sequence: 1, format, data }
      };
      data.fill(2);
      yield {
        type: "audio" as const,
        chunk: { sequence: 2, format, data }
      };
      yield {
        type: "completed" as const,
        sequence: 3,
        format,
        audioBytes: 1_280,
        durationMs: 40
      };
    }
  };
}

class MockTextToSpeechProviderAtRate implements TextToSpeechProvider {
  public constructor(
    private readonly sampleRate: number,
    private readonly mimeType = "audio/wav"
  ) {}

  public async synthesize(): Promise<AudioData> {
    const pcm = new Uint8Array(this.sampleRate * 2);
    return {
      data: encodePcm16Wav({
        channels: 1,
        sampleRate: this.sampleRate,
        pcm
      }),
      mimeType: this.mimeType,
      sampleRate: this.sampleRate,
      channels: 1
    };
  }
}

function duplicateFinalSttProvider(): StreamingSpeechToTextProvider {
  return {
    startSession: async () => {
      let release: (() => void) | undefined;
      const finished = new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        write: async () => undefined,
        finishInput: async () => {
          release?.();
        },
        close: async () => undefined,
        [Symbol.asyncIterator]: async function* () {
          await finished;
          yield {
            type: "final" as const,
            sequence: 1,
            result: { text: "First", language: "en" }
          };
          yield {
            type: "final" as const,
            sequence: 2,
            result: { text: "Second", language: "en" }
          };
        }
      };
    }
  };
}

function rejectAfter(message: string, milliseconds: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(message)), milliseconds)
  );
}

async function waitForLog(store: VoxMeshStore, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (store.listLogs().some((entry) => entry.message === message)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Expected log was not persisted: ${message}`);
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
