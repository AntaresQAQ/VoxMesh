// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RuntimeRoutingSummary } from "@voxmesh/shared";

import { unknownReadiness } from "../../test/readiness.js";
import { renderWithProviders } from "../../test/render.js";
import { DashboardRouteOverview } from "./DashboardRouteOverview.js";

describe("DashboardRouteOverview", () => {
  it("reports a missing active route", () => {
    renderWithProviders(
      <DashboardRouteOverview
        routing={{
          connections: [],
          models: [],
          routes: [],
          activeRouteId: "missing-route"
        }}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The active route could not be resolved."
    );
  });

  it("shows native assignments and incomplete verification", () => {
    const routing: RuntimeRoutingSummary = {
      connections: [
        {
          id: "connection-native",
          providerId: "mock-native",
          displayName: "Native Connection",
          endpoint: "",
          apiKeyConfigured: false,
          enabled: true,
          readiness: unknownReadiness
        }
      ],
      models: [
        {
          id: "model-native",
          connectionId: "connection-native",
          displayName: "Native Model",
          modelName: "native-model",
          apiVersion: "",
          providerOptions: {},
          declaredCapabilities: [
            "audio-input",
            "audio-output",
            "text-output",
            "tool-calling",
            "native-multimodal",
            "non-streaming"
          ],
          verifiedCapabilities: [
            "audio-input",
            "audio-output",
            "text-output",
            "tool-calling"
          ],
          enabled: true
        }
      ],
      routes: [
        {
          id: "route-native",
          displayName: "Native Route",
          mode: "native-multimodal",
          sttModelDeploymentId: null,
          chatModelDeploymentId: null,
          ttsModelDeploymentId: null,
          nativeModelDeploymentId: "model-native",
          fallbackRouteId: null,
          sttStreamingEnabled: false,
          chatStreamingEnabled: false,
          ttsStreamingEnabled: false,
          enabled: true,
          readiness: {
            state: "failed",
            lastTestedAt: "2026-08-22T07:00:00.000Z",
            lastError: {
              category: "authentication",
              message: "Provider authentication failed."
            }
          }
        }
      ],
      activeRouteId: "route-native"
    };

    renderWithProviders(<DashboardRouteOverview routing={routing} />);

    expect(screen.getByText("Native Route")).toBeVisible();
    expect(screen.getByText("Native Model")).toBeVisible();
    expect(screen.getByText(/Mock Native Multimodal/)).toBeVisible();
    expect(screen.getByText("4/5 required capabilities verified")).toHaveClass(
      "error"
    );
    expect(screen.getByText("Readiness: Failed")).toBeVisible();
    expect(screen.getByText("Readiness: Not tested")).toBeVisible();
    expect(screen.getByText("Last error: Authentication failed")).toBeVisible();
  });

  it("reports mixed Composed transport and Chat streaming verification", () => {
    const routing: RuntimeRoutingSummary = {
      connections: [
        connection("connection-stt"),
        connection("connection-chat"),
        connection("connection-tts")
      ],
      models: [
        model("model-stt", "connection-stt", [
          "audio-input",
          "text-output",
          "transcription",
          "non-streaming"
        ]),
        model("model-chat", "connection-chat", [
          "text-input",
          "text-output",
          "tool-calling",
          "non-streaming",
          "streaming"
        ]),
        model("model-tts", "connection-tts", [
          "text-input",
          "audio-output",
          "speech-synthesis",
          "non-streaming"
        ])
      ],
      routes: [
        {
          id: "route-composed",
          displayName: "Mixed Route",
          mode: "composed",
          sttModelDeploymentId: "model-stt",
          chatModelDeploymentId: "model-chat",
          ttsModelDeploymentId: "model-tts",
          nativeModelDeploymentId: null,
          fallbackRouteId: null,
          sttStreamingEnabled: false,
          chatStreamingEnabled: true,
          ttsStreamingEnabled: false,
          enabled: true,
          readiness: unknownReadiness
        }
      ],
      activeRouteId: "route-composed"
    };

    renderWithProviders(<DashboardRouteOverview routing={routing} />);

    expect(
      screen.getAllByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent?.includes("Transport") === true &&
          element.textContent.includes("Buffered")
      )
    ).toHaveLength(2);
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent?.includes("Transport") === true &&
          element.textContent.includes("Streaming")
      )
    ).toBeVisible();
    expect(screen.getAllByText("Required capabilities verified")).toHaveLength(
      3
    );
  });
});

function connection(id: string): RuntimeRoutingSummary["connections"][number] {
  return {
    id,
    providerId: "mock",
    displayName: id,
    endpoint: "",
    apiKeyConfigured: false,
    enabled: true,
    readiness: unknownReadiness
  };
}

function model(
  id: string,
  connectionId: string,
  capabilities: RuntimeRoutingSummary["models"][number]["declaredCapabilities"]
): RuntimeRoutingSummary["models"][number] {
  return {
    id,
    connectionId,
    displayName: id,
    modelName: id,
    apiVersion: "",
    providerOptions: {},
    declaredCapabilities: capabilities,
    verifiedCapabilities: capabilities,
    enabled: true
  };
}
