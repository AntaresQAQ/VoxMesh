// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeRoutingSummary } from "@voxmesh/shared";

import { apiClient } from "../../api.js";
import { unknownReadiness } from "../../test/readiness.js";
import { renderWithProviders } from "../../test/render.js";
import { RuntimeRoutingSummaryCard } from "./RuntimeRoutingSummaryCard.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RuntimeRoutingSummaryCard", () => {
  it("renders connections, active route, and capability verification", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "runtimeRouting").mockResolvedValue(routingSummary());

    renderWithProviders(<RuntimeRoutingSummaryCard />);

    expect(
      await screen.findByRole("heading", { name: "Runtime routing" })
    ).toBeVisible();
    expect(
      (await screen.findAllByText("Default Composed Voice"))[0]
    ).toBeVisible();
    expect(screen.getByText("Connections: 2")).toBeVisible();
    expect(screen.getByText("Models: 1")).toBeVisible();
    await user.click(screen.getByText("Connections (2)"));
    expect(screen.getAllByText("Chat · OpenAI-compatible")[0]).toBeVisible();
    expect(screen.getByText("API key configured")).toBeVisible();
    expect(screen.getByText("Readiness: Failed")).toBeVisible();
    expect(screen.getByText("Last error: Authentication failed")).toBeVisible();
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
    await user.click(screen.getByText("Models (1)"));
    expect(screen.getByText("Verified: Text input, Text output")).toBeVisible();
    expect(
      screen.getByText("Declared: Text input, Text output, Tool calling")
    ).toBeVisible();
    await user.click(screen.getByText("Routes (1)"));
    expect(screen.getByText("Readiness: Ready")).toBeVisible();
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

  it("announces route test progress and success beside the route", async () => {
    const user = userEvent.setup();
    const summary = routingSummary();
    vi.spyOn(apiClient, "runtimeRouting").mockResolvedValue(summary);
    vi.spyOn(apiClient, "testRuntimeRoute").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return summary;
    });

    renderWithProviders(<RuntimeRoutingSummaryCard />);

    await user.click(await screen.findByText("Routes (1)"));
    await user.click(screen.getByRole("button", { name: "Test route" }));
    expect(screen.getByRole("status")).toHaveTextContent("Testing route...");
    expect(
      await screen.findByText(
        "Route test succeeded. Assigned model capabilities are verified."
      )
    ).toBeVisible();
  });
});

function routingSummary(): RuntimeRoutingSummary {
  return {
    connections: [
      {
        id: "connection-chat",
        providerId: "openai-compatible",
        displayName: "Chat · OpenAI-compatible",
        endpoint: "https://provider.example.com/v1",
        apiKeyConfigured: true,
        enabled: true,
        readiness: {
          state: "failed",
          lastTestedAt: "2026-08-22T07:00:00.000Z",
          lastError: {
            category: "authentication",
            message: "Provider authentication failed."
          }
        }
      },
      {
        id: "connection-native",
        providerId: "mock-native",
        displayName: "Native · Mock Native Multimodal",
        endpoint: "",
        apiKeyConfigured: false,
        enabled: true,
        readiness: unknownReadiness
      }
    ],
    models: [
      {
        id: "model-chat",
        connectionId: "connection-chat",
        displayName: "Chat · qwen-plus",
        modelName: "qwen-plus",
        apiVersion: "",
        providerOptions: {},
        declaredCapabilities: ["text-input", "text-output", "tool-calling"],
        verifiedCapabilities: ["text-input", "text-output"],
        enabled: true
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
        fallbackRouteId: null,
        sttStreamingEnabled: false,
        chatStreamingEnabled: false,
        ttsStreamingEnabled: false,
        enabled: true,
        readiness: {
          state: "ready",
          lastTestedAt: "2026-08-22T07:01:00.000Z",
          lastError: null
        }
      }
    ],
    activeRouteId: "route-composed"
  };
}
