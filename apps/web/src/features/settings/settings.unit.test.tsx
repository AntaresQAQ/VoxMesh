// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { LlmConfigurationFields } from "./LlmConfigurationFields.js";
import { LlmSettingsCard } from "./LlmSettingsCard.js";
import {
  AppearanceSettingsCard,
  LanguageSettingsCard
} from "./PreferenceCards.js";
import { SettingsPage } from "./SettingsPage.js";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(apiClient, "llmConfiguration").mockResolvedValue({
    mode: "mock",
    endpoint: "",
    deployment: "",
    apiVersion: "2024-10-21",
    apiKeyConfigured: false
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

  it("emits changes from LLM configuration fields", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const onEndpointChange = vi.fn();
    renderWithProviders(
      <form>
        <LlmConfigurationFields
          mode="mock"
          endpoint=""
          deployment=""
          apiVersion="2024-10-21"
          apiKey=""
          apiKeyConfigured={false}
          busy={false}
          onModeChange={onModeChange}
          onEndpointChange={onEndpointChange}
          onDeploymentChange={vi.fn()}
          onApiVersionChange={vi.fn()}
          onApiKeyChange={vi.fn()}
          onTestConnection={vi.fn()}
        />
      </form>
    );

    await user.selectOptions(screen.getByLabelText("Provider"), "azure-openai");
    await user.type(
      screen.getByLabelText("Azure endpoint"),
      "https://example.openai.azure.com"
    );

    expect(onModeChange).toHaveBeenCalledWith("azure-openai");
    expect(onEndpointChange).toHaveBeenCalled();
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
        apiKeyConfigured: false
      });
    vi.spyOn(apiClient, "testLlmConnection").mockResolvedValue({
      success: true,
      response: "Connection works"
    });
    renderWithProviders(<LlmSettingsCard />);

    await screen.findByRole("heading", { name: "LLM provider" });
    await user.click(screen.getByRole("button", { name: "Save LLM settings" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(screen.getByText("LLM configuration saved.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText("Connection test: Connection works")
    ).toBeVisible();
  });

  it("composes all settings sections", async () => {
    renderWithProviders(<SettingsPage onSessionEnded={vi.fn()} />);

    expect(
      await screen.findByRole("heading", { name: "Settings" })
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Administrator password" })
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "LLM provider" })).toBeVisible();
  });
});
