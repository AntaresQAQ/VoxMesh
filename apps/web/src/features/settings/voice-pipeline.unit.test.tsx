// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { AiProvidersSettings } from "./AiProvidersSettings.js";
import { VoicePipelineSettingsCard } from "./VoicePipelineSettingsCard.js";

beforeEach(() => {
  vi.spyOn(apiClient, "providerCatalog").mockResolvedValue({
    providers: [
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

describe("VoicePipelineSettingsCard", () => {
  it("switches to Native Multimodal and selects a capable provider", async () => {
    const user = userEvent.setup();
    const update = vi
      .spyOn(apiClient, "updateVoicePipelineConfiguration")
      .mockResolvedValue({
        mode: "native-multimodal",
        nativeProviderId: "mock-native"
      });
    renderWithProviders(<VoicePipelineSettingsCard />);

    await user.selectOptions(
      await screen.findByLabelText("Voice pipeline mode"),
      "native-multimodal"
    );

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        {
          mode: "native-multimodal",
          nativeProviderId: "mock-native"
        },
        expect.anything()
      )
    );
    expect(
      await screen.findByLabelText("Native multimodal provider")
    ).toBeVisible();
  });
});

describe("AiProvidersSettings", () => {
  it("hides composed provider forms in Native Multimodal mode", async () => {
    vi.mocked(apiClient.voicePipelineConfiguration).mockResolvedValue({
      mode: "native-multimodal",
      nativeProviderId: "mock-native"
    });
    renderWithProviders(<AiProvidersSettings />);

    expect(
      await screen.findByRole("heading", { name: "Voice pipeline" })
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "LLM provider" })
      ).not.toBeInTheDocument()
    );
    expect(
      screen.queryByRole("heading", { name: "Speech providers" })
    ).not.toBeInTheDocument();
  });
});
