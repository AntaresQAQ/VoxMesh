// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeRouteSummary } from "@voxmesh/shared";

import { unknownReadiness } from "../../test/readiness.js";
import { renderWithProviders } from "../../test/render.js";
import { RouteList } from "./RouteList.js";

describe("RouteList", () => {
  it("renders buffered, mixed, and full-chain transport profiles", () => {
    renderWithProviders(
      <RouteList
        routes={[
          route("Buffered", false, false, false),
          route("Mixed", true, false, true),
          route("Full", true, true, true)
        ]}
        activeRouteId="buffered"
        pending={false}
        editingId={undefined}
        renderEditor={() => null}
        onEdit={vi.fn()}
        onTest={vi.fn()}
        onTestAndActivate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(
      screen.getByText("STT: Buffered · Chat: Buffered · TTS: Buffered")
    ).toBeVisible();
    expect(
      screen.getByText("STT: Streaming · Chat: Buffered · TTS: Streaming")
    ).toBeVisible();
    expect(
      screen.getByText("STT: Streaming · Chat: Streaming · TTS: Streaming")
    ).toBeVisible();
  });
});

function route(
  displayName: string,
  sttStreamingEnabled: boolean,
  chatStreamingEnabled: boolean,
  ttsStreamingEnabled: boolean
): RuntimeRouteSummary {
  return {
    id: displayName.toLowerCase(),
    displayName,
    mode: "composed",
    sttModelDeploymentId: "stt",
    chatModelDeploymentId: "chat",
    ttsModelDeploymentId: "tts",
    nativeModelDeploymentId: null,
    fallbackRouteId: null,
    sttStreamingEnabled,
    chatStreamingEnabled,
    ttsStreamingEnabled,
    enabled: true,
    readiness: unknownReadiness
  };
}
