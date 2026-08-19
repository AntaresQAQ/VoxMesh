// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render.js";
import { CenteredCard } from "./CenteredCard.js";
import { Metric } from "./Metric.js";
import { PageHeader } from "./PageHeader.js";

describe("layout components", () => {
  it("renders a centered card with language control", () => {
    renderWithProviders(
      <CenteredCard title="Test title">Test content</CenteredCard>
    );

    expect(screen.getByRole("heading", { name: "Test title" })).toBeVisible();
    expect(screen.getByText("Test content")).toBeVisible();
    expect(screen.getByLabelText("Language")).toBeVisible();
  });

  it("renders a page header and metric", () => {
    renderWithProviders(
      <PageHeader title="Page title" description="Page description">
        <Metric label="Metric label" value="Metric value" />
      </PageHeader>
    );

    expect(screen.getByRole("heading", { name: "Page title" })).toBeVisible();
    expect(screen.getByText("Page description")).toBeVisible();
    expect(screen.getByText("Metric label")).toBeVisible();
    expect(screen.getByText("Metric value")).toBeVisible();
  });
});
