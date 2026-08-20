import { afterEach, describe, expect, it } from "vitest";

import { VoxMeshStore } from "./store.js";

let store: VoxMeshStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

describe("VoxMeshStore", () => {
  it("creates an administrator only once", () => {
    store = new VoxMeshStore(":memory:");

    expect(store.hasAdmin()).toBe(false);
    expect(store.createAdmin("hash")).toBe(true);
    expect(store.createAdmin("other")).toBe(false);
    expect(store.getAdminPasswordHash()).toBe("hash");
  });

  it("stores conversations, messages, and logs", () => {
    store = new VoxMeshStore(":memory:");

    const id = store.createConversation("Check the light");
    store.addMessage(id, "tool", '{"state":"on"}');
    store.addMessage(id, "assistant", "The light is on.");
    store.addLog({
      category: "AGENT",
      level: "INFO",
      message: "Completed",
      conversationId: id
    });
    store.addPipelineEvent({
      conversationId: id,
      stage: "AGENT",
      status: "completed",
      message: "Agent completed"
    });

    expect(store.listConversations()).toHaveLength(1);
    expect(store.getConversation(id)?.messages).toHaveLength(3);
    expect(store.getConversation(id)?.events).toHaveLength(1);
    expect(store.listLogs()[0]?.conversationId).toBe(id);
  });

  it("stores write-only LLM configuration values", () => {
    store = new VoxMeshStore(":memory:");

    const updated = store.updateLlmConfiguration({
      mode: "azure-openai",
      endpoint: "https://example.openai.azure.com",
      deployment: "gpt",
      apiVersion: "2025-01-01",
      baseUrl: "",
      model: "",
      timeoutMs: 30_000,
      maxOutputTokens: 1_024,
      apiKey: "secret"
    });

    expect(updated.apiKey).toBe("secret");
    expect(store.getLlmConfiguration().mode).toBe("azure-openai");
    expect(
      store.updateLlmConfiguration({
        mode: updated.mode,
        endpoint: updated.endpoint,
        deployment: updated.deployment,
        apiVersion: updated.apiVersion,
        baseUrl: updated.baseUrl,
        model: updated.model,
        timeoutMs: updated.timeoutMs,
        maxOutputTokens: updated.maxOutputTokens,
        clearApiKey: true
      }).apiKey
    ).toBeNull();
  });

  it("stores Azure OpenAI speech configuration", () => {
    store = new VoxMeshStore(":memory:");

    const updated = store.updateSpeechConfiguration({
      sttMode: "azure-openai",
      ttsMode: "azure-openai",
      sttEndpoint: "https://stt.openai.azure.com",
      sttDeployment: "gpt-4o-mini-transcribe",
      sttApiVersion: "2025-04-01-preview",
      sttLanguage: "zh",
      sttApiKey: "stt-secret",
      ttsEndpoint: "https://tts.openai.azure.com",
      ttsDeployment: "gpt-4o-mini-tts",
      ttsApiVersion: "2025-03-01-preview",
      ttsVoice: "coral",
      ttsInstructions: "Speak warmly.",
      ttsApiKey: "tts-secret"
    });

    expect(updated.sttMode).toBe("azure-openai");
    expect(updated.ttsMode).toBe("azure-openai");
    expect(updated.sttApiKey).toBe("stt-secret");
    expect(updated.ttsApiKey).toBe("tts-secret");
  });

  it("migrates the obsolete Plus voice default without changing other settings", () => {
    store = new VoxMeshStore(":memory:");

    const updated = store.updateSpeechConfiguration({
      sttMode: "alibaba-model-studio",
      ttsMode: "alibaba-model-studio",
      sttEndpoint:
        "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      sttDeployment: "fun-asr-realtime",
      sttApiVersion: "",
      sttLanguage: "zh",
      sttApiKey: "stt-secret",
      ttsEndpoint:
        "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      ttsDeployment: "qwen-audio-3.0-tts-plus",
      ttsApiVersion: "",
      ttsVoice: "longanlingxi",
      ttsInstructions: "Speak naturally.",
      ttsApiKey: "tts-secret"
    });

    expect(updated.sttMode).toBe("alibaba-model-studio");
    expect(updated.ttsMode).toBe("alibaba-model-studio");
    expect(updated.ttsVoice).toBe("longanlingxin");
  });

  it("stores the selected voice pipeline mode", () => {
    store = new VoxMeshStore(":memory:");

    expect(store.getVoicePipelineConfiguration()).toEqual({
      mode: "composed",
      nativeProviderId: "mock-native"
    });
    expect(
      store.updateVoicePipelineConfiguration({
        mode: "native-multimodal",
        nativeProviderId: "mock-native"
      })
    ).toEqual({
      mode: "native-multimodal",
      nativeProviderId: "mock-native"
    });
  });

  it("migrates legacy settings into idempotent runtime routing records", () => {
    store = new VoxMeshStore(":memory:");

    const initial = store.getRuntimeRoutingSummary();
    expect(initial.connections).toHaveLength(4);
    expect(initial.models).toHaveLength(4);
    expect(initial.routes).toHaveLength(2);
    expect(initial.activeRouteId).toBe("system-route-composed");
    expect(
      initial.models.find((model) => model.id === "system-model-chat")
        ?.verifiedCapabilities
    ).toEqual(["text-input", "text-output", "tool-calling"]);

    store.updateLlmConfiguration({
      mode: "azure-openai",
      endpoint: "https://example.openai.azure.com",
      deployment: "model-router",
      apiVersion: "2025-01-01",
      baseUrl: "",
      model: "",
      timeoutMs: 30_000,
      maxOutputTokens: 1_024,
      apiKey: "secret"
    });
    const updated = store.getRuntimeRoutingSummary();
    expect(updated.connections).toHaveLength(4);
    expect(
      updated.connections.find(
        (connection) => connection.id === "system-connection-chat"
      )
    ).toMatchObject({
      providerId: "azure-openai",
      endpoint: "https://example.openai.azure.com",
      apiKeyConfigured: true
    });
    expect(
      updated.models.find((model) => model.id === "system-model-chat")
        ?.verifiedCapabilities
    ).toEqual([]);

    store.markRuntimeRoleVerified("chat");
    expect(
      store
        .getRuntimeRoutingSummary()
        .models.find((model) => model.id === "system-model-chat")
        ?.verifiedCapabilities
    ).toEqual(["text-input", "text-output", "tool-calling"]);

    store.updateVoicePipelineConfiguration({
      mode: "native-multimodal",
      nativeProviderId: "mock-native"
    });
    expect(store.getRuntimeRoutingSummary().activeRouteId).toBe(
      "system-route-native"
    );
    expect(store.getRuntimeVoicePipelineConfiguration()).toEqual({
      mode: "native-multimodal",
      nativeProviderId: "mock-native"
    });
  });
});
