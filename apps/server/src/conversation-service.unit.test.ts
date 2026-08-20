import { afterEach, describe, expect, it } from "vitest";

import {
  MockLlmProvider,
  MockMcpServer,
  MockNativeVoiceProvider
} from "@voxmesh/agent-core";
import {
  MockSpeechToTextProvider,
  MockTextToSpeechProvider
} from "@voxmesh/audio";
import { VoxMeshStore } from "@voxmesh/storage";

import { ConversationService } from "./conversation-service.js";

let store: VoxMeshStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

describe("ConversationService", () => {
  it("persists an STT failure without storing raw audio as a message", async () => {
    store = new VoxMeshStore(":memory:");
    const service = new ConversationService(
      store,
      new MockMcpServer(),
      () => new MockLlmProvider(),
      () => ({
        transcribe: async () => {
          throw new Error("STT provider unavailable");
        }
      }),
      () => new MockTextToSpeechProvider(),
      () => new MockNativeVoiceProvider()
    );

    await expect(
      service.runVoice({
        data: new Uint8Array([1, 2, 3]),
        mimeType: "audio/wav"
      })
    ).rejects.toThrow("STT provider unavailable");

    const [conversation] = store.listConversations();
    expect(conversation).toMatchObject({
      title: "Voice request",
      messageCount: 0
    });
    expect(store.getConversation(conversation?.id ?? "")?.events).toEqual([
      expect.objectContaining({
        stage: "STT",
        status: "failed",
        message: "STT provider unavailable"
      })
    ]);
    expect(store.listLogs()[0]).toMatchObject({
      category: "ERROR",
      level: "ERROR",
      message: "STT provider unavailable",
      conversationId: conversation?.id
    });
  });

  it("uses only an explicitly configured Composed fallback", async () => {
    store = new VoxMeshStore(":memory:");
    const routing = store.createRuntimeRoute({
      displayName: "Native with fallback",
      mode: "native-multimodal",
      sttModelDeploymentId: null,
      chatModelDeploymentId: null,
      ttsModelDeploymentId: null,
      nativeModelDeploymentId: "system-model-native",
      fallbackRouteId: "system-route-composed",
      sttStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true
    });
    const routeId = routing.routes.find(
      (route) => route.displayName === "Native with fallback"
    )?.id;
    store.activateRuntimeRoute(routeId ?? "");
    const service = new ConversationService(
      store,
      new MockMcpServer(),
      () => new MockLlmProvider(),
      () => new MockSpeechToTextProvider(),
      () => new MockTextToSpeechProvider(),
      () => {
        throw new Error("Native provider unavailable");
      }
    );

    const result = await service.runVoice({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "audio/wav"
    });

    expect(result.transcript).toBe("Check the light status");
    expect(
      store
        .getConversation(result.conversationId)
        ?.events.some((event) => event.message.includes("Fallback activated"))
    ).toBe(true);
  });
});
