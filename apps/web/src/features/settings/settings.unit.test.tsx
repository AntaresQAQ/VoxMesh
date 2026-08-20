// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { AzureLlmFields } from "./AzureLlmFields.js";
import { LlmProviderFields } from "./LlmProviderFields.js";
import { LlmSettingsCard } from "./LlmSettingsCard.js";
import { OpenAiCompatibleFields } from "./OpenAiCompatibleFields.js";
import {
  AppearanceSettingsCard,
  LanguageSettingsCard
} from "./PreferenceCards.js";
import { SettingsPage } from "./SettingsPage.js";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: {
    children: ReactNode;
    search: { section: string };
    className?: string;
  }) => (
    <a
      href={`/settings?section=${props.search.section}`}
      className={props.className}
    >
      {props.children}
    </a>
  )
}));

beforeEach(() => {
  localStorage.clear();
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settings components", () => {
  it("renders language and appearance preference cards", () => {
    renderWithProviders(
      <>
        <LanguageSettingsCard />
        <AppearanceSettingsCard />
      </>
    );

    expect(
      screen.getByRole("heading", { name: "Display language" })
    ).toBeVisible();
    expect(screen.getByLabelText("Language")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible();
    expect(screen.getByLabelText("Theme")).toBeVisible();
  });

  it("renders provider-specific LLM fields", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    renderWithProviders(
      <form>
        <LlmProviderFields
          mode="mock"
          apiKey=""
          apiKeyConfigured={false}
          onModeChange={onModeChange}
          onApiKeyChange={vi.fn()}
        />
        <AzureLlmFields
          endpoint=""
          deployment=""
          apiVersion="2024-10-21"
          onEndpointChange={vi.fn()}
          onDeploymentChange={vi.fn()}
          onApiVersionChange={vi.fn()}
        />
        <OpenAiCompatibleFields
          baseUrl=""
          model="qwen-plus"
          timeoutMs={30_000}
          maxOutputTokens={1_024}
          onBaseUrlChange={vi.fn()}
          onModelChange={vi.fn()}
          onTimeoutChange={vi.fn()}
          onMaxOutputTokensChange={vi.fn()}
        />
      </form>
    );

    await screen.findByRole("option", { name: "OpenAI-compatible" });
    await user.selectOptions(
      screen.getByLabelText("Provider"),
      "openai-compatible"
    );

    expect(onModeChange).toHaveBeenCalledWith("openai-compatible");
    expect(screen.getByLabelText("Base URL")).toBeVisible();
    expect(screen.getByLabelText("Model name")).toHaveValue("qwen-plus");
  });

  it("saves and tests LLM settings", async () => {
    const user = userEvent.setup();
    const update = vi
      .spyOn(apiClient, "updateLlmConfiguration")
      .mockResolvedValue({
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
    vi.spyOn(apiClient, "testLlmConnection").mockResolvedValue({
      success: true,
      response: "Connection works"
    });
    renderWithProviders(
      <StrictMode>
        <LlmSettingsCard />
      </StrictMode>
    );

    await screen.findByRole("heading", { name: "LLM provider" });
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    await screen.findByRole("option", { name: "OpenAI-compatible" });
    await user.selectOptions(
      screen.getByLabelText("Provider"),
      "openai-compatible"
    );
    expect(screen.getByLabelText("API key")).toBeVisible();
    await user.type(
      screen.getByLabelText("Base URL"),
      "https://workspace.example.com/compatible-mode/v1"
    );
    await user.type(screen.getByLabelText("API key"), "compatible-secret");
    await user.click(screen.getByRole("button", { name: "Save LLM settings" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      mode: "openai-compatible",
      baseUrl: "https://workspace.example.com/compatible-mode/v1",
      model: "qwen-plus",
      apiKey: "compatible-secret"
    });
    expect(screen.getByText("LLM configuration saved.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText("Connection test: Connection works")
    ).toBeVisible();
  });

  it("preserves unsaved LLM fields after a successful connection test", async () => {
    const user = userEvent.setup();
    let resolveConfiguration:
      | ((
          value: Awaited<ReturnType<typeof apiClient.llmConfiguration>>
        ) => void)
      | undefined;
    vi.mocked(apiClient.llmConfiguration).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConfiguration = resolve;
      })
    );
    vi.spyOn(apiClient, "testLlmConnection").mockResolvedValue({
      success: true,
      response: "Connection works"
    });
    renderWithProviders(
      <StrictMode>
        <LlmSettingsCard />
      </StrictMode>
    );

    await screen.findByRole("option", { name: "OpenAI-compatible" });
    await user.selectOptions(
      screen.getByLabelText("Provider"),
      "openai-compatible"
    );
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(
      screen.getByLabelText("Base URL"),
      "https://unsaved.example.com/v1"
    );
    await user.clear(screen.getByLabelText("Model name"));
    await user.type(screen.getByLabelText("Model name"), "unsaved-model");

    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await act(async () => {
      resolveConfiguration?.({
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
      await Promise.resolve();
    });

    expect(
      await screen.findByText("Connection test: Connection works")
    ).toBeVisible();
    expect(screen.getByLabelText("Provider")).toHaveValue("openai-compatible");
    expect(screen.getByLabelText("Base URL")).toHaveValue(
      "https://unsaved.example.com/v1"
    );
    expect(screen.getByLabelText("Model name")).toHaveValue("unsaved-model");
  });

  it("preserves unsaved LLM fields after a failed connection test", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "testLlmConnection").mockRejectedValue(
      new Error("Provider unavailable")
    );
    renderWithProviders(
      <StrictMode>
        <LlmSettingsCard />
      </StrictMode>
    );

    await screen.findByRole("option", { name: "Azure OpenAI" });
    await user.selectOptions(screen.getByLabelText("Provider"), "azure-openai");
    await user.type(
      screen.getByLabelText("Azure endpoint"),
      "https://unsaved.openai.azure.com"
    );

    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider unavailable"
    );
    expect(screen.getByLabelText("Provider")).toHaveValue("azure-openai");
    expect(screen.getByLabelText("Azure endpoint")).toHaveValue(
      "https://unsaved.openai.azure.com"
    );
  });

  it("preserves a saved non-Mock LLM provider after a connection test", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.llmConfiguration).mockResolvedValueOnce({
      mode: "openai-compatible",
      endpoint: "",
      deployment: "",
      apiVersion: "2024-10-21",
      baseUrl: "https://saved.example.com/v1",
      model: "saved-model",
      timeoutMs: 30_000,
      maxOutputTokens: 1_024,
      apiKeyConfigured: true
    });
    vi.spyOn(apiClient, "testLlmConnection").mockResolvedValue({
      success: true,
      response: "Connection works"
    });
    renderWithProviders(
      <StrictMode>
        <LlmSettingsCard />
      </StrictMode>
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Provider")).toHaveValue("openai-compatible")
    );
    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(
      await screen.findByText("Connection test: Connection works")
    ).toBeVisible();
    expect(screen.getByLabelText("Provider")).toHaveValue("openai-compatible");
    expect(screen.getByLabelText("Base URL")).toHaveValue(
      "https://saved.example.com/v1"
    );
    expect(screen.getByLabelText("Model name")).toHaveValue("saved-model");
  });

  it("composes all settings sections", async () => {
    const view = renderWithProviders(
      <SettingsPage section="general" onSessionEnded={vi.fn()} />
    );

    expect(
      await screen.findByRole("heading", { name: "Settings" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "AI Providers" })).toHaveAttribute(
      "href",
      "/settings?section=providers"
    );
    expect(
      screen.getByRole("heading", { name: "Display language" })
    ).toBeVisible();

    view.unmount();
    const providerView = renderWithProviders(
      <SettingsPage section="providers" onSessionEnded={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "LLM provider" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Speech providers" })
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Voice pipeline" })
    ).toBeVisible();

    providerView.unmount();
    renderWithProviders(
      <SettingsPage section="security" onSessionEnded={vi.fn()} />
    );
    expect(
      screen.getByRole("heading", { name: "Administrator password" })
    ).toBeVisible();
  });
});
