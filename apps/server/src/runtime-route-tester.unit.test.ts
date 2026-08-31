import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MockMcpServer,
  MockStreamingLlmProvider,
  type StreamingLlmProvider
} from "@voxmesh/agent-core";
import { VoxMeshStore } from "@voxmesh/storage";

import { createLlmProvider } from "./llm-providers.js";
import {
  RuntimeRouteTester,
  type StreamingProviderFactories
} from "./runtime-route-tester.js";
import {
  createStreamingSpeechToTextProvider,
  createStreamingTextToSpeechProvider,
  streamingRuntimeAvailability
} from "./streaming-voice-providers.js";

let store: VoxMeshStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

describe("RuntimeRouteTester streaming verification", () => {
  it("verifies and activates a full-chain Mock streaming route", async () => {
    store = new VoxMeshStore(":memory:", streamingRuntimeAvailability);
    const routeId = createStreamingRoute(store, {
      stt: true,
      chat: true,
      tts: true
    });
    const tester = createTester(store);

    const summary = await tester.test(routeId);

    expect(
      summary.routes.find((route) => route.id === routeId)?.readiness
    ).toMatchObject({
      state: "ready",
      lastError: null
    });
    for (const modelId of [
      "system-model-stt",
      "system-model-chat",
      "system-model-tts"
    ]) {
      expect(
        summary.models.find((model) => model.id === modelId)
          ?.verifiedCapabilities
      ).toContain("streaming");
    }
    expect(store.activateRuntimeRoute(routeId).activeRouteId).toBe(routeId);
    expect(
      store.captureRuntimeStreamingVoiceConfiguration().route
    ).toMatchObject({
      routeId,
      assignments: [
        expect.objectContaining({ role: "stt", streamingEnabled: true }),
        expect.objectContaining({ role: "chat", streamingEnabled: true }),
        expect.objectContaining({ role: "tts", streamingEnabled: true })
      ]
    });
  });

  it("verifies only the enabled streaming role", async () => {
    store = new VoxMeshStore(":memory:", streamingRuntimeAvailability);
    const routeId = createStreamingRoute(store, {
      stt: false,
      chat: true,
      tts: false
    });
    const createChat = vi.fn(() => new MockStreamingLlmProvider());
    const createStt = vi.fn(createStreamingSpeechToTextProvider);
    const createTts = vi.fn(createStreamingTextToSpeechProvider);
    const tester = createTester(store, { createChat, createStt, createTts });

    const summary = await tester.test(routeId);

    expect(createChat).toHaveBeenCalledOnce();
    expect(createStt).not.toHaveBeenCalled();
    expect(createTts).not.toHaveBeenCalled();
    expect(
      summary.models.find((model) => model.id === "system-model-chat")
        ?.verifiedCapabilities
    ).toContain("streaming");
    expect(
      summary.models.find((model) => model.id === "system-model-stt")
        ?.verifiedCapabilities
    ).not.toContain("streaming");
    expect(
      summary.models.find((model) => model.id === "system-model-tts")
        ?.verifiedCapabilities
    ).not.toContain("streaming");
  });

  it("keeps failed streaming verification unverified and inactive", async () => {
    store = new VoxMeshStore(":memory:", streamingRuntimeAvailability);
    const routeId = createStreamingRoute(store, {
      stt: false,
      chat: true,
      tts: false
    });
    const failedProvider: StreamingLlmProvider = {
      async *stream() {
        yield {
          type: "failure",
          code: "provider_failed",
          safeMessage: "Streaming verification failed"
        };
      }
    };
    const tester = createTester(store, {
      createChat: () => failedProvider,
      createStt: createStreamingSpeechToTextProvider,
      createTts: createStreamingTextToSpeechProvider
    });

    await expect(tester.test(routeId)).rejects.toThrow(
      "Provider connection test failed."
    );

    const summary = store.getRuntimeRoutingSummary();
    expect(
      summary.routes.find((route) => route.id === routeId)?.readiness
    ).toMatchObject({
      state: "failed",
      lastError: { category: "provider" }
    });
    expect(
      summary.models.find((model) => model.id === "system-model-chat")
        ?.verifiedCapabilities
    ).not.toContain("streaming");
    expect(() => store?.activateRuntimeRoute(routeId)).toThrow(
      "requires verified streaming capability"
    );
  });

  it("bounds a stalled streaming provider verification", async () => {
    store = new VoxMeshStore(":memory:", streamingRuntimeAvailability);
    const routeId = createStreamingRoute(store, {
      stt: false,
      chat: true,
      tts: false
    });
    const stalledProvider: StreamingLlmProvider = {
      async *stream() {
        await new Promise<void>(() => undefined);
        yield { type: "completed", finishReason: "stop" };
      }
    };
    const tester = createTester(
      store,
      {
        createChat: () => stalledProvider,
        createStt: createStreamingSpeechToTextProvider,
        createTts: createStreamingTextToSpeechProvider
      },
      10
    );

    await expect(tester.test(routeId)).rejects.toThrow();

    expect(
      store
        .getRuntimeRoutingSummary()
        .routes.find((route) => route.id === routeId)?.readiness.state
    ).toBe("failed");
  });
});

function createTester(
  targetStore: VoxMeshStore,
  factories?: StreamingProviderFactories,
  timeoutMs?: number
): RuntimeRouteTester {
  return new RuntimeRouteTester(
    targetStore,
    new MockMcpServer(),
    (routeId) =>
      createLlmProvider(targetStore.getRuntimeLlmConfiguration(routeId)),
    factories,
    timeoutMs
  );
}

function createStreamingRoute(
  targetStore: VoxMeshStore,
  streaming: { stt: boolean; chat: boolean; tts: boolean }
): string {
  const summary = targetStore.createRuntimeRoute({
    displayName: `Streaming ${JSON.stringify(streaming)}`,
    mode: "composed",
    sttModelDeploymentId: "system-model-stt",
    chatModelDeploymentId: "system-model-chat",
    ttsModelDeploymentId: "system-model-tts",
    nativeModelDeploymentId: null,
    fallbackRouteId: null,
    sttStreamingEnabled: streaming.stt,
    chatStreamingEnabled: streaming.chat,
    ttsStreamingEnabled: streaming.tts,
    enabled: true
  });
  const route = summary.routes.find(
    (candidate) =>
      candidate.displayName === `Streaming ${JSON.stringify(streaming)}`
  );
  if (!route) throw new Error("Expected the streaming route fixture");
  return route.id;
}
