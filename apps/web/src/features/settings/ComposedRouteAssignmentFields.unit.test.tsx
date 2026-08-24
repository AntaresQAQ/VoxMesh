// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ModelDeploymentSummary,
  RuntimeRouteInput
} from "@voxmesh/shared";

import { renderWithProviders } from "../../test/render.js";
import { ComposedRouteAssignmentFields } from "./ComposedRouteAssignmentFields.js";

afterEach(() => {
  localStorage.clear();
});

describe("ComposedRouteAssignmentFields", () => {
  it("disables unsupported profile and role switches", () => {
    const callbacks = createCallbacks();
    renderWithProviders(
      <ComposedRouteAssignmentFields
        {...baseProps(callbacks)}
        models={models(false)}
      />
    );

    expect(screen.getByLabelText("Enable full-chain streaming")).toBeDisabled();
    expect(screen.getByLabelText("Enable STT streaming")).toBeEnabled();
    expect(screen.getByLabelText("Enable Chat streaming")).toBeDisabled();
    expect(screen.getByLabelText("Enable TTS streaming")).toBeEnabled();
  });

  it("applies the profile and independent role callbacks", async () => {
    const user = userEvent.setup();
    const callbacks = createCallbacks();
    renderWithProviders(
      <ComposedRouteAssignmentFields
        {...baseProps(callbacks)}
        models={models(true)}
      />
    );

    await user.click(screen.getByLabelText("Enable full-chain streaming"));
    await user.click(screen.getByLabelText("Enable Chat streaming"));
    expect(callbacks.onFullChainStreamingChange).toHaveBeenCalledWith(true);
    expect(callbacks.onChatStreamingChange).toHaveBeenCalledWith(true);
  });

  it("renders localized profile controls", () => {
    localStorage.setItem("voxmesh.locale", "zh-CN");
    renderWithProviders(
      <ComposedRouteAssignmentFields
        {...baseProps(createCallbacks())}
        models={models(true)}
      />
    );

    expect(screen.getByLabelText("启用全链路流式模式")).toBeVisible();
    expect(screen.getByText(/分别对 STT、Chat 和 TTS/)).toBeVisible();
  });
});

function baseProps(callbacks: ReturnType<typeof createCallbacks>) {
  return {
    values: routeValues(),
    connections: [],
    streamingAvailability: undefined,
    ...callbacks
  };
}

function createCallbacks() {
  return {
    onSttModelChange: vi.fn(),
    onChatModelChange: vi.fn(),
    onTtsModelChange: vi.fn(),
    onSttStreamingChange: vi.fn(),
    onChatStreamingChange: vi.fn(),
    onTtsStreamingChange: vi.fn(),
    onFullChainStreamingChange: vi.fn()
  };
}

function routeValues(): RuntimeRouteInput {
  return {
    displayName: "Route",
    mode: "composed",
    sttModelDeploymentId: "stt",
    chatModelDeploymentId: "chat",
    ttsModelDeploymentId: "tts",
    nativeModelDeploymentId: null,
    fallbackRouteId: null,
    sttStreamingEnabled: false,
    chatStreamingEnabled: false,
    ttsStreamingEnabled: false,
    enabled: true
  };
}

function models(chatStreaming: boolean): ModelDeploymentSummary[] {
  return [
    model("stt", [
      "audio-input",
      "text-output",
      "transcription",
      "non-streaming",
      "streaming"
    ]),
    model("chat", [
      "text-input",
      "text-output",
      "tool-calling",
      "non-streaming",
      ...(chatStreaming ? (["streaming"] as const) : [])
    ]),
    model("tts", [
      "text-input",
      "audio-output",
      "speech-synthesis",
      "non-streaming",
      "streaming"
    ])
  ];
}

function model(
  id: string,
  capabilities: ModelDeploymentSummary["declaredCapabilities"]
): ModelDeploymentSummary {
  return {
    id,
    connectionId: `${id}-connection`,
    displayName: id,
    modelName: id,
    apiVersion: "",
    providerOptions: {},
    declaredCapabilities: capabilities,
    verifiedCapabilities: [],
    enabled: true
  };
}
