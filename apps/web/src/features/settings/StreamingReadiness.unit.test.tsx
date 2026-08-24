// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ModelDeploymentSummary,
  ProviderConnectionSummary,
  StreamingRuntimeAvailability
} from "@voxmesh/shared";

import { unknownReadiness } from "../../test/readiness.js";
import { renderWithProviders } from "../../test/render.js";
import { StreamingReadiness } from "./StreamingReadiness.js";

const model: ModelDeploymentSummary = {
  id: "model-chat",
  connectionId: "connection-chat",
  displayName: "Streaming Chat",
  modelName: "streaming-chat",
  apiVersion: "",
  providerOptions: {},
  declaredCapabilities: [
    "text-input",
    "text-output",
    "tool-calling",
    "non-streaming",
    "streaming"
  ],
  verifiedCapabilities: [
    "text-input",
    "text-output",
    "tool-calling",
    "non-streaming",
    "streaming"
  ],
  enabled: true
};

const connection: ProviderConnectionSummary = {
  id: "connection-chat",
  providerId: "mock",
  displayName: "Mock Chat",
  endpoint: "",
  apiKeyConfigured: false,
  enabled: true,
  readiness: unknownReadiness
};

afterEach(() => {
  localStorage.clear();
});

describe("StreamingReadiness", () => {
  it("reports every gate unavailable when the selected model is missing", () => {
    renderReadiness({ modelId: "missing", models: [], connections: [] });

    expect(screen.getByRole("status")).toHaveTextContent(
      "declared: unavailable; verified: unavailable; adapter: unavailable; server transport: unavailable; browser client: unavailable"
    );
  });

  it("reports declared, verified, adapter, transport, and browser availability", () => {
    renderReadiness({
      modelId: model.id,
      models: [model],
      connections: [connection],
      availability: availableRuntime()
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "declared: available; verified: available; adapter: available; server transport: available; browser client: available"
    );
  });

  it("keeps runtime gates independent", () => {
    renderReadiness({
      modelId: model.id,
      models: [{ ...model, verifiedCapabilities: [] }],
      connections: [connection],
      availability: {
        ...availableRuntime(),
        transportAvailable: false
      }
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "declared: available; verified: unavailable; adapter: available; server transport: unavailable; browser client: available"
    );
  });

  it("localizes the readiness contract", () => {
    localStorage.setItem("voxmesh.locale", "zh-CN");
    renderReadiness({
      modelId: model.id,
      models: [model],
      connections: [connection],
      availability: availableRuntime()
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "已声明：可用；已验证：可用；适配器：可用；服务端传输：可用；浏览器客户端：可用"
    );
  });
});

function renderReadiness(input: {
  modelId: string;
  models: ModelDeploymentSummary[];
  connections: ProviderConnectionSummary[];
  availability?: StreamingRuntimeAvailability;
}) {
  renderWithProviders(
    <StreamingReadiness
      streamingRole="chat"
      modelId={input.modelId}
      models={input.models}
      connections={input.connections}
      availability={input.availability}
    />
  );
}

function availableRuntime(): StreamingRuntimeAvailability {
  return {
    transportAvailable: true,
    browserClientAvailable: true,
    sttProviderIds: [],
    chatProviderIds: ["mock"],
    ttsProviderIds: []
  };
}
