// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RuntimeRoutingSummary } from "@voxmesh/shared";

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
          enabled: true
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
            "native-multimodal"
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
          ttsStreamingEnabled: false,
          enabled: true
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
  });
});
