// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import { apiClient } from "./api.js";
import { renderWithProviders } from "./test/render.js";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App", () => {
  it("completes first-run setup and shows login", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "setupStatus").mockResolvedValue({
      setupRequired: true
    });
    vi.spyOn(apiClient, "setup").mockResolvedValue({ setupRequired: false });
    vi.spyOn(apiClient, "session").mockRejectedValue(
      new Error("Not authenticated")
    );
    window.history.replaceState({}, "", "/setup");
    renderWithProviders(<App />);

    await user.type(
      await screen.findByLabelText("Password"),
      "administrator password"
    );
    await user.click(screen.getByRole("button", { name: "Complete setup" }));

    expect(
      await screen.findByRole("heading", { name: "Administrator sign in" })
    ).toBeVisible();
  });
});

describe("authenticated routing", () => {
  it("navigates with links and signs out", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "setupStatus").mockResolvedValue({
      setupRequired: false
    });
    vi.spyOn(apiClient, "session").mockResolvedValue({
      authenticated: true,
      expiresAt: "2026-08-20T00:00:00.000Z"
    });
    vi.spyOn(apiClient, "dashboard").mockResolvedValue({
      status: "online",
      mode: "mock",
      uptimeSeconds: 1,
      conversationCount: 0,
      mcp: {
        name: "Mock MCP",
        status: "connected",
        enabledTools: []
      },
      providers: { llm: "mock", stt: "mock", tts: "mock" }
    });
    vi.spyOn(apiClient, "llmConfiguration").mockResolvedValue({
      mode: "mock",
      endpoint: "",
      deployment: "",
      apiVersion: "2024-10-21",
      baseUrl: "",
      model: "qwen-plus",
      timeoutMs: 30_000,
      maxOutputTokens: 1_024,
      apiKeyConfigured: false
    });
    vi.spyOn(apiClient, "providerCatalog").mockResolvedValue({
      providers: [
        {
          id: "mock",
          displayName: "Mock",
          capabilities: ["llm", "stt", "tts"]
        },
        {
          id: "azure-openai",
          displayName: "Azure OpenAI",
          capabilities: ["llm", "stt", "tts"]
        },
        {
          id: "openai-compatible",
          displayName: "OpenAI-compatible",
          capabilities: ["llm", "stt", "tts"]
        },
        {
          id: "alibaba-model-studio",
          displayName: "Alibaba Cloud Model Studio",
          capabilities: ["stt", "tts"]
        },
        {
          id: "mock-native",
          displayName: "Mock Native Multimodal",
          capabilities: [
            "native-multimodal",
            "audio-input",
            "audio-output",
            "tool-calling"
          ]
        }
      ]
    });
    vi.spyOn(apiClient, "speechConfiguration").mockResolvedValue({
      sttMode: "mock",
      ttsMode: "mock",
      sttEndpoint: "",
      sttDeployment: "",
      sttApiVersion: "2025-04-01-preview",
      sttLanguage: "zh",
      sttApiKeyConfigured: false,
      ttsEndpoint: "",
      ttsDeployment: "",
      ttsApiVersion: "2025-03-01-preview",
      ttsVoice: "coral",
      ttsInstructions: "Speak clearly and naturally.",
      ttsApiKeyConfigured: false
    });
    vi.spyOn(apiClient, "voicePipelineConfiguration").mockResolvedValue({
      mode: "composed",
      nativeProviderId: "mock-native"
    });
    vi.spyOn(apiClient, "runtimeRouting").mockResolvedValue({
      connections: [],
      models: [],
      routes: [
        {
          id: "system-route-composed",
          displayName: "Default Composed Voice",
          mode: "composed",
          sttModelDeploymentId: null,
          chatModelDeploymentId: null,
          ttsModelDeploymentId: null,
          nativeModelDeploymentId: null,
          fallbackRouteId: null
        }
      ],
      activeRouteId: "system-route-composed"
    });
    const onLogout = vi.fn(async () => undefined);
    vi.spyOn(apiClient, "logout").mockImplementation(onLogout);
    window.history.replaceState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(
      await screen.findByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Chat" }));
    expect(screen.getByRole("heading", { name: "Chat" })).toBeVisible();
    expect(window.location.pathname).toBe("/chat");
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(onLogout).toHaveBeenCalledOnce());
  });
});
