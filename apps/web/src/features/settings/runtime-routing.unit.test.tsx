// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { RuntimeRoutingSummaryCard } from "./RuntimeRoutingSummaryCard.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RuntimeRoutingSummaryCard", () => {
  it("renders connections, active route, and capability verification", async () => {
    vi.spyOn(apiClient, "runtimeRouting").mockResolvedValue({
      connections: [
        {
          id: "connection-chat",
          providerId: "openai-compatible",
          displayName: "Chat · OpenAI-compatible",
          endpoint: "https://provider.example.com/v1",
          apiKeyConfigured: true
        }
      ],
      models: [
        {
          id: "model-chat",
          connectionId: "connection-chat",
          displayName: "Chat · qwen-plus",
          modelName: "qwen-plus",
          apiVersion: "",
          declaredCapabilities: ["text-input", "text-output", "tool-calling"],
          verifiedCapabilities: ["text-input", "text-output"]
        }
      ],
      routes: [
        {
          id: "route-composed",
          displayName: "Default Composed Voice",
          mode: "composed",
          sttModelDeploymentId: null,
          chatModelDeploymentId: "model-chat",
          ttsModelDeploymentId: null,
          nativeModelDeploymentId: null,
          fallbackRouteId: null
        }
      ],
      activeRouteId: "route-composed"
    });

    renderWithProviders(<RuntimeRoutingSummaryCard />);

    expect(
      await screen.findByRole("heading", { name: "Runtime routing" })
    ).toBeVisible();
    expect(await screen.findByText("Default Composed Voice")).toBeVisible();
    expect(screen.getByText("Chat · OpenAI-compatible")).toBeVisible();
    expect(screen.getByText("API key configured")).toBeVisible();
    expect(screen.getByText("Verified: Text input, Text output")).toBeVisible();
    expect(
      screen.getByText("Declared: Text input, Text output, Tool calling")
    ).toBeVisible();
  });

  it("announces routing load failures", async () => {
    vi.spyOn(apiClient, "runtimeRouting").mockRejectedValue(
      new Error("Routing unavailable")
    );

    renderWithProviders(<RuntimeRoutingSummaryCard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Routing unavailable"
    );
  });
});
