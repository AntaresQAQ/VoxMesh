// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { SpeechSttFields } from "./SpeechSttFields.js";
import { SpeechSettingsCard } from "./SpeechSettingsCard.js";
import { SpeechTtsFields } from "./SpeechTtsFields.js";

beforeEach(() => {
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("speech settings components", () => {
  it("renders independently configurable connection, STT, and TTS fields", () => {
    renderWithProviders(
      <form>
        <SpeechSttFields
          mode="azure-openai"
          endpoint=""
          deployment=""
          apiVersion="2025-04-01-preview"
          language="zh"
          apiKey=""
          apiKeyConfigured={false}
          onModeChange={vi.fn()}
          onEndpointChange={vi.fn()}
          onDeploymentChange={vi.fn()}
          onApiVersionChange={vi.fn()}
          onLanguageChange={vi.fn()}
          onApiKeyChange={vi.fn()}
        />
        <SpeechTtsFields
          mode="azure-openai"
          endpoint=""
          deployment=""
          apiVersion="2025-03-01-preview"
          voice="coral"
          instructions="Speak clearly."
          apiKey=""
          apiKeyConfigured={false}
          onModeChange={vi.fn()}
          onEndpointChange={vi.fn()}
          onDeploymentChange={vi.fn()}
          onApiVersionChange={vi.fn()}
          onVoiceChange={vi.fn()}
          onInstructionsChange={vi.fn()}
          onApiKeyChange={vi.fn()}
        />
      </form>
    );

    expect(screen.getByRole("group", { name: "Speech to text" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Text to speech" })).toBeVisible();
    expect(screen.getByLabelText("STT endpoint")).toBeVisible();
    expect(screen.getByLabelText("TTS endpoint")).toBeVisible();
  });

  it("saves and tests speech provider configuration", async () => {
    const user = userEvent.setup();
    const update = vi
      .spyOn(apiClient, "updateSpeechConfiguration")
      .mockResolvedValue({
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
    vi.spyOn(apiClient, "testSpeechConnection").mockResolvedValue({
      success: true,
      transcript: "Check the light status",
      audioMimeType: "audio/wav"
    });
    renderWithProviders(
      <StrictMode>
        <SpeechSettingsCard />
      </StrictMode>
    );

    await screen.findByRole("heading", { name: "Speech providers" });
    expect(screen.queryByLabelText("STT endpoint")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("TTS endpoint")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("STT deployment")).not.toBeInTheDocument();
    await screen.findAllByRole("option", { name: "Azure OpenAI" });
    await user.selectOptions(
      screen.getByLabelText("STT provider"),
      "azure-openai"
    );
    expect(screen.getByLabelText("STT deployment")).toBeVisible();
    expect(screen.getByLabelText("STT endpoint")).toBeVisible();
    expect(screen.queryByLabelText("TTS endpoint")).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("STT provider"),
      "openai-compatible"
    );
    expect(screen.getByText("Base URL")).toBeVisible();
    expect(screen.queryByLabelText("STT API version")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("STT provider"), "mock");

    await user.click(
      screen.getByRole("button", { name: "Save speech settings" })
    );
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(screen.getByText("Speech configuration saved.")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Test speech connection" })
    );
    expect(await screen.findByText(/Speech test: transcript/)).toBeVisible();
  });

  it("preserves unsaved speech fields after a successful connection test", async () => {
    const user = userEvent.setup();
    let resolveConfiguration:
      | ((
          value: Awaited<ReturnType<typeof apiClient.speechConfiguration>>
        ) => void)
      | undefined;
    vi.mocked(apiClient.speechConfiguration).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConfiguration = resolve;
      })
    );
    vi.spyOn(apiClient, "testSpeechConnection").mockResolvedValue({
      success: true,
      transcript: "Check the light status",
      audioMimeType: "audio/wav"
    });
    renderWithProviders(
      <StrictMode>
        <SpeechSettingsCard />
      </StrictMode>
    );

    await screen.findAllByRole("option", { name: "OpenAI-compatible" });
    await user.selectOptions(
      screen.getByLabelText("STT provider"),
      "openai-compatible"
    );
    await user.selectOptions(
      screen.getByLabelText("TTS provider"),
      "azure-openai"
    );
    await user.type(
      screen.getByLabelText("STT endpoint"),
      "https://unsaved-stt.example.com/v1"
    );
    await user.type(
      screen.getByLabelText("TTS endpoint"),
      "https://unsaved-tts.openai.azure.com"
    );

    await user.click(
      screen.getByRole("button", { name: "Test speech connection" })
    );
    await act(async () => {
      resolveConfiguration?.({
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
      await Promise.resolve();
    });

    expect(await screen.findByText(/Speech test: transcript/)).toBeVisible();
    expect(screen.getByLabelText("STT provider")).toHaveValue(
      "openai-compatible"
    );
    expect(screen.getByLabelText("TTS provider")).toHaveValue("azure-openai");
    expect(screen.getByLabelText("STT endpoint")).toHaveValue(
      "https://unsaved-stt.example.com/v1"
    );
    expect(screen.getByLabelText("TTS endpoint")).toHaveValue(
      "https://unsaved-tts.openai.azure.com"
    );
  });

  it("preserves unsaved speech fields after a failed connection test", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "testSpeechConnection").mockRejectedValue(
      new Error("Provider unavailable")
    );
    renderWithProviders(
      <StrictMode>
        <SpeechSettingsCard />
      </StrictMode>
    );

    await screen.findAllByRole("option", { name: "Azure OpenAI" });
    await user.selectOptions(
      screen.getByLabelText("STT provider"),
      "azure-openai"
    );
    await user.type(
      screen.getByLabelText("STT endpoint"),
      "https://unsaved-stt.openai.azure.com"
    );

    await user.click(
      screen.getByRole("button", { name: "Test speech connection" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider unavailable"
    );
    expect(screen.getByLabelText("STT provider")).toHaveValue("azure-openai");
    expect(screen.getByLabelText("STT endpoint")).toHaveValue(
      "https://unsaved-stt.openai.azure.com"
    );
  });

  it("preserves saved non-Mock speech providers after a connection test", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.speechConfiguration).mockResolvedValueOnce({
      sttMode: "openai-compatible",
      ttsMode: "azure-openai",
      sttEndpoint: "https://saved-stt.example.com/v1",
      sttDeployment: "saved-stt-model",
      sttApiVersion: "2025-04-01-preview",
      sttLanguage: "zh",
      sttApiKeyConfigured: true,
      ttsEndpoint: "https://saved-tts.openai.azure.com",
      ttsDeployment: "saved-tts-model",
      ttsApiVersion: "2025-03-01-preview",
      ttsVoice: "coral",
      ttsInstructions: "Speak clearly and naturally.",
      ttsApiKeyConfigured: true
    });
    vi.spyOn(apiClient, "testSpeechConnection").mockResolvedValue({
      success: true,
      transcript: "Check the light status",
      audioMimeType: "audio/wav"
    });
    renderWithProviders(
      <StrictMode>
        <SpeechSettingsCard />
      </StrictMode>
    );

    await waitFor(() =>
      expect(screen.getByLabelText("STT provider")).toHaveValue(
        "openai-compatible"
      )
    );
    await user.click(
      screen.getByRole("button", { name: "Test speech connection" })
    );

    expect(await screen.findByText(/Speech test: transcript/)).toBeVisible();
    expect(screen.getByLabelText("STT provider")).toHaveValue(
      "openai-compatible"
    );
    expect(screen.getByLabelText("TTS provider")).toHaveValue("azure-openai");
    expect(screen.getByLabelText("STT endpoint")).toHaveValue(
      "https://saved-stt.example.com/v1"
    );
    expect(screen.getByLabelText("TTS endpoint")).toHaveValue(
      "https://saved-tts.openai.azure.com"
    );
  });

  it("converts known Model Studio compatible settings to WebSocket defaults", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StrictMode>
        <SpeechSettingsCard />
      </StrictMode>
    );

    await screen.findAllByRole("option", {
      name: "Alibaba Cloud Model Studio"
    });
    await user.selectOptions(
      screen.getByLabelText("STT provider"),
      "openai-compatible"
    );
    await user.type(
      screen.getByLabelText("STT endpoint"),
      "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    );
    await user.type(
      screen.getByLabelText("STT deployment"),
      "qwen-audio-3.0-asr-flash-filetrans"
    );
    await user.selectOptions(
      screen.getByLabelText("STT provider"),
      "alibaba-model-studio"
    );
    await user.selectOptions(
      screen.getByLabelText("TTS provider"),
      "alibaba-model-studio"
    );

    expect(screen.getAllByText("WebSocket endpoint")).toHaveLength(2);
    expect(screen.getByLabelText("STT endpoint")).toHaveValue(
      "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference"
    );
    expect(screen.getByLabelText("STT deployment")).toHaveValue(
      "fun-asr-realtime"
    );
    expect(screen.getByLabelText("TTS deployment")).toHaveValue(
      "qwen-audio-3.0-tts-plus"
    );
    expect(screen.getByLabelText("TTS voice")).toHaveValue("longanlingxin");
    expect(
      screen.getAllByText(/dedicated Model Studio WebSocket protocol/)
    ).toHaveLength(2);
  });
});
