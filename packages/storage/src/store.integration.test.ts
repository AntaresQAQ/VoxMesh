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
        clearApiKey: true
      }).apiKey
    ).toBeNull();
  });
});
