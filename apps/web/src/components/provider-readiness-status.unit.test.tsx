// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../test/render.js";
import { ProviderReadinessStatus } from "./ProviderReadinessStatus.js";

describe("ProviderReadinessStatus", () => {
  it("renders an unknown state without a fabricated test time", () => {
    renderWithProviders(
      <ProviderReadinessStatus
        readiness={{
          state: "unknown",
          lastTestedAt: null,
          lastError: null
        }}
      />
    );

    expect(screen.getByText("Readiness: Not tested")).toBeVisible();
    expect(screen.getByText("No completed test")).toBeVisible();
    expect(document.querySelector("time")).not.toBeInTheDocument();
  });

  it("renders a localized safe failure category and completion time", () => {
    renderWithProviders(
      <ProviderReadinessStatus
        readiness={{
          state: "failed",
          lastTestedAt: "2026-08-22T07:00:00.000Z",
          lastError: {
            category: "authentication",
            message: "Provider authentication failed."
          }
        }}
      />
    );

    expect(screen.getByText("Readiness: Failed")).toBeVisible();
    expect(screen.getByText(/Last error: Authentication failed/)).toBeVisible();
    expect(document.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-22T07:00:00.000Z"
    );
    expect(
      screen.queryByText("Provider authentication failed.")
    ).not.toBeInTheDocument();
  });

  it("renders readiness semantics in Simplified Chinese", () => {
    localStorage.setItem("voxmesh.locale", "zh-CN");

    renderWithProviders(
      <ProviderReadinessStatus
        readiness={{
          state: "testing",
          lastTestedAt: null,
          lastError: null
        }}
      />
    );

    expect(screen.getByText("就绪状态: 正在测试")).toBeVisible();
    expect(screen.getByText("尚无已完成测试")).toBeVisible();
    localStorage.clear();
  });
});
