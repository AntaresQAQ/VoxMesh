// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { deviceStatusQueryOptions } from "../../query.js";
import { renderWithProviders } from "../../test/render.js";
import { DeviceStatusPanel } from "./DeviceStatusPanel.js";

describe("DeviceStatusPanel", () => {
  it("polls device status without background duplicate refreshes", () => {
    const options = deviceStatusQueryOptions();
    expect(options.refetchInterval).toBe(15_000);
    expect(options.refetchIntervalInBackground).toBe(false);
  });

  it("renders ready, unavailable, stale, degraded, and failed states", () => {
    const observedAt = "2026-08-21T00:00:00.000Z";
    renderWithProviders(
      <DeviceStatusPanel
        status={{
          device: {
            status: "degraded",
            displayName: "Mock edge device",
            detailCode: "thermal-throttling",
            observedAt
          },
          audio: {
            input: {
              status: "ready",
              displayName: "Mock microphone",
              detailCode: null,
              observedAt
            },
            output: {
              status: "failed",
              displayName: "Mock speaker",
              detailCode: "playback-unavailable",
              observedAt
            }
          },
          system: {
            cpuUsage: {
              status: "stale",
              value: 42.25,
              unit: "percent",
              detailCode: "stale-sample",
              observedAt
            },
            memoryUsage: {
              status: "ready",
              value: 134_217_728,
              unit: "bytes",
              detailCode: null,
              observedAt
            },
            temperature: {
              status: "unavailable",
              value: null,
              unit: "celsius",
              detailCode: "sensor-unavailable",
              observedAt: null
            }
          }
        }}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Device and physical audio" })
    ).toBeVisible();
    expect(screen.getByText("Mock edge device")).toBeVisible();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText("Stale")).toBeVisible();
    expect(screen.getByText("Degraded")).toBeVisible();
    expect(screen.getByText("Failed")).toBeVisible();
    expect(screen.getByText("42.3%")).toBeVisible();
    expect(screen.getByText("128 MiB")).toBeVisible();
    expect(screen.getByText("No observation available")).toBeVisible();
  });
});
