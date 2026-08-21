// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render.js";
import { PipelineTimeline } from "./PipelineTimeline.js";

describe("PipelineTimeline", () => {
  it("renders localized stages and status", () => {
    renderWithProviders(
      <PipelineTimeline
        events={[
          {
            id: "event-1",
            runId: null,
            correlationId: null,
            stage: "STT",
            status: "completed",
            durationMs: 100,
            message: "Audio transcribed",
            createdAt: "2026-08-19T00:00:00.000Z"
          },
          {
            id: "event-2",
            runId: null,
            correlationId: null,
            stage: "TTS",
            status: "failed",
            durationMs: null,
            message: "Synthesis failed",
            createdAt: "2026-08-19T00:00:01.000Z"
          }
        ]}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Processing pipeline" })
    ).toBeVisible();
    expect(screen.getByText("Speech to text")).toBeVisible();
    expect(screen.getByText("Text to speech")).toBeVisible();
    expect(screen.getByText("Failed")).toBeVisible();
  });
});
