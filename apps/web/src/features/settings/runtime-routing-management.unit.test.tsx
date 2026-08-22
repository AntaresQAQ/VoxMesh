// @vitest-environment jsdom

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeRoutingSummary } from "@voxmesh/shared";

import { apiClient } from "../../api.js";
import { runtimeRoutingQueryOptions } from "../../query.js";
import { unknownReadiness } from "../../test/readiness.js";
import { renderWithProviders } from "../../test/render.js";
import { ConnectionManagement } from "./ConnectionManagement.js";
import { ModelManagement } from "./ModelManagement.js";
import { RouteManagement } from "./RouteManagement.js";
import {
  type RuntimeRoutingOperation,
  useRuntimeRoutingMutations
} from "./useRuntimeRoutingMutations.js";

const routing: RuntimeRoutingSummary = {
  connections: [
    {
      id: "connection-mock",
      providerId: "mock",
      displayName: "Mock connection",
      endpoint: "",
      apiKeyConfigured: false,
      enabled: true,
      readiness: unknownReadiness
    }
  ],
  models: [
    model("model-stt", "Mock STT", [
      "audio-input",
      "text-output",
      "transcription",
      "streaming"
    ]),
    model("model-chat", "Mock Chat", [
      "text-input",
      "text-output",
      "tool-calling"
    ]),
    model("model-tts", "Mock TTS", [
      "text-input",
      "audio-output",
      "speech-synthesis"
    ])
  ],
  routes: [],
  activeRouteId: ""
};
const routingWithRoute: RuntimeRoutingSummary = {
  ...routing,
  models: [
    ...routing.models,
    model("model-native", "Mock Native", [
      "audio-input",
      "audio-output",
      "text-output",
      "tool-calling",
      "native-multimodal"
    ])
  ],
  routes: [
    {
      id: "route-a",
      displayName: "Route A",
      mode: "composed",
      sttModelDeploymentId: "model-stt",
      chatModelDeploymentId: "model-chat",
      ttsModelDeploymentId: "model-tts",
      nativeModelDeploymentId: null,
      fallbackRouteId: null,
      sttStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true,
      readiness: unknownReadiness
    }
  ],
  activeRouteId: "route-a"
};
const routingWithUnusedConnection: RuntimeRoutingSummary = {
  ...routing,
  connections: [
    ...routing.connections,
    {
      id: "connection-unused",
      providerId: "mock",
      displayName: "Unused connection",
      endpoint: "",
      apiKeyConfigured: false,
      enabled: true,
      readiness: unknownReadiness
    }
  ]
};
const routingWithFallback: RuntimeRoutingSummary = {
  ...routingWithRoute,
  routes: [
    ...routingWithRoute.routes,
    {
      id: "route-native",
      displayName: "Native Route",
      mode: "native-multimodal",
      sttModelDeploymentId: null,
      chatModelDeploymentId: null,
      ttsModelDeploymentId: null,
      nativeModelDeploymentId: "model-chat",
      fallbackRouteId: "route-a",
      sttStreamingEnabled: false,
      ttsStreamingEnabled: false,
      enabled: true,
      readiness: unknownReadiness
    }
  ],
  activeRouteId: "route-native"
};

describe("runtime routing management", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a write-only provider connection", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ConnectionManagement
        routing={routing}
        pending={false}
        execute={execute}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add connection" }));
    await user.type(screen.getByLabelText("Display name"), "Provider A");
    await user.type(
      screen.getByLabelText("Endpoint or base URL"),
      "https://provider.example.com/v1"
    );
    await user.type(screen.getByLabelText("API key"), "secret");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(execute).toHaveBeenCalledWith({
      type: "create-connection",
      input: {
        providerId: "openai-compatible",
        displayName: "Provider A",
        endpoint: "https://provider.example.com/v1",
        apiKey: "secret",
        clearApiKey: false,
        enabled: true
      }
    });
  });

  it("omits an API key that was entered and then cleared", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ConnectionManagement
        routing={routing}
        pending={false}
        execute={execute}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add connection" }));
    await user.type(screen.getByLabelText("Display name"), "Provider A");
    await user.type(
      screen.getByLabelText("Endpoint or base URL"),
      "https://provider.example.com/v1"
    );
    await user.type(screen.getByLabelText("API key"), "temporary-secret");
    await user.clear(screen.getByLabelText("API key"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    const operation = execute.mock.calls[0]?.[0];
    expect(operation?.type).toBe("create-connection");
    if (operation?.type !== "create-connection") {
      throw new Error("Expected a create-connection operation");
    }
    expect(operation.input).not.toHaveProperty("apiKey");
  });

  it("omits a replacement API key when clearing the saved key", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ConnectionManagement
        routing={routing}
        pending={false}
        execute={execute}
      />
    );
    const item = screen.getByText("Mock connection").closest("li");
    if (!item) throw new Error("Expected the connection list item");
    await user.click(within(item).getByRole("button", { name: "Edit" }));
    await user.type(within(item).getByLabelText("API key"), "replacement");
    await user.click(within(item).getByLabelText("Clear saved API key"));
    await user.click(
      within(item).getByRole("button", { name: "Save changes" })
    );

    const operation = execute.mock.calls[0]?.[0];
    expect(operation?.type).toBe("update-connection");
    if (operation?.type !== "update-connection") {
      throw new Error("Expected an update-connection operation");
    }
    expect(operation.input.clearApiKey).toBe(true);
    expect(operation.input).not.toHaveProperty("apiKey");
  });

  it("creates a model deployment from capabilities and JSON options", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ModelManagement routing={routing} pending={false} execute={execute} />
    );

    await user.click(screen.getByRole("button", { name: "Add model" }));
    await user.selectOptions(
      screen.getByLabelText("Connection"),
      "connection-mock"
    );
    await user.type(screen.getByLabelText("Display name"), "Streaming STT");
    await user.type(screen.getByLabelText("Model name"), "mock-stt");
    const capabilityPicker = screen.getByLabelText("Declared");
    await user.click(capabilityPicker);
    await user.click(screen.getByRole("checkbox", { name: "Audio input" }));
    await user.click(screen.getByRole("checkbox", { name: "Text output" }));
    await user.click(screen.getByRole("checkbox", { name: "Transcription" }));
    await user.click(screen.getByRole("checkbox", { name: "Streaming" }));
    expect(screen.getByLabelText("Declared")).toHaveTextContent(
      "4 capabilities selected"
    );
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("checkbox", { name: "Audio input" })
    ).not.toBeVisible();
    expect(capabilityPicker).toHaveFocus();
    await user.clear(screen.getByLabelText("Provider options (JSON)"));
    await user.click(screen.getByLabelText("Provider options (JSON)"));
    await user.paste('{"language":"en"}');
    await user.click(screen.getByRole("button", { name: "Create" }));

    const operation = execute.mock.calls[0]?.[0];
    expect(operation?.type).toBe("create-model");
    if (operation?.type !== "create-model") {
      throw new Error("Expected a create-model operation");
    }
    expect(operation.input.connectionId).toBe("connection-mock");
    expect(operation.input.providerOptions).toEqual({ language: "en" });
    expect(operation.input.declaredCapabilities).toEqual(
      expect.arrayContaining([
        "audio-input",
        "text-output",
        "transcription",
        "streaming"
      ])
    );
  });

  it("keeps STT and TTS streaming switches independent", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    const view = renderWithProviders(
      <RouteManagement routing={routing} pending={false} execute={execute} />
    );
    const form = view.container;

    await user.click(within(form).getByRole("button", { name: "Add route" }));
    await user.type(within(form).getByLabelText("Display name"), "Route A");
    await user.selectOptions(
      within(form).getByLabelText("Speech to text"),
      "model-stt"
    );
    await user.selectOptions(within(form).getByLabelText("LLM"), "model-chat");
    await user.selectOptions(
      within(form).getByLabelText("Text to speech"),
      "model-tts"
    );
    expect(
      within(form).getByLabelText("Enable STT streaming")
    ).not.toBeChecked();
    expect(
      within(form).getByLabelText("Enable TTS streaming")
    ).not.toBeChecked();
    await user.click(within(form).getByLabelText("Enable STT streaming"));
    await user.click(within(form).getByRole("button", { name: "Create" }));

    const operation = execute.mock.calls[0]?.[0];
    expect(operation?.type).toBe("create-route");
    if (operation?.type !== "create-route") {
      throw new Error("Expected a create-route operation");
    }
    expect(operation.input.sttStreamingEnabled).toBe(true);
    expect(operation.input.ttsStreamingEnabled).toBe(false);
  });

  it("requires confirmation before deleting a custom connection", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ConnectionManagement
        routing={routingWithUnusedConnection}
        pending={false}
        execute={execute}
      />
    );
    const item = screen.getByText("Unused connection").closest("li");
    if (!item) throw new Error("Expected the unused connection list item");

    await user.click(within(item).getByRole("button", { name: "Delete" }));
    expect(execute).not.toHaveBeenCalled();
    await user.click(
      within(item).getByRole("button", { name: "Confirm delete" })
    );
    expect(execute).toHaveBeenCalledWith({
      type: "delete-connection",
      id: "connection-unused"
    });
  });

  it("disables deleting a connection that models depend on", () => {
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ConnectionManagement
        routing={routing}
        pending={false}
        execute={execute}
      />
    );
    const item = screen.getByText("Mock connection").closest("li");
    if (!item) throw new Error("Expected the connection list item");

    expect(within(item).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(item).toHaveTextContent(
      "Used by models: Mock STT, Mock Chat, Mock TTS."
    );
  });

  it("disables deleting a model that routes depend on", () => {
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ModelManagement
        routing={routingWithRoute}
        pending={false}
        execute={execute}
      />
    );
    const item = screen.getByText("Mock STT").closest("li");
    if (!item) throw new Error("Expected the model list item");

    expect(within(item).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(item).toHaveTextContent("Used by routes: Route A.");
  });

  it("disables deleting active and fallback target routes", () => {
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <RouteManagement
        routing={routingWithFallback}
        pending={false}
        execute={execute}
      />
    );
    const fallbackItem = screen.getByText("Route A").closest("li");
    const activeItem = screen.getByText("Native Route").closest("li");
    if (!fallbackItem || !activeItem) {
      throw new Error("Expected route list items");
    }

    expect(
      within(fallbackItem).getByRole("button", { name: "Delete" })
    ).toBeDisabled();
    expect(fallbackItem).toHaveTextContent(
      "Used as a fallback by routes: Native Route."
    );
    expect(
      within(activeItem).getByRole("button", { name: "Delete" })
    ).toBeDisabled();
    expect(activeItem).toHaveTextContent("Activate another route");
  });

  it("opens a connection editor inside the selected list item", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ConnectionManagement
        routing={routing}
        pending={false}
        execute={execute}
      />
    );
    const item = screen.getByText("Mock connection").closest("li");
    if (!item) throw new Error("Expected the connection list item");

    await user.click(within(item).getByRole("button", { name: "Edit" }));

    expect(within(item).getByLabelText("Display name")).toHaveValue(
      "Mock connection"
    );
    expect(within(item).getByRole("button", { name: "Edit" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("opens a model editor inside the selected list item", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ModelManagement routing={routing} pending={false} execute={execute} />
    );
    const item = screen.getByText("Mock STT").closest("li");
    if (!item) throw new Error("Expected the model list item");

    await user.click(within(item).getByRole("button", { name: "Edit" }));

    expect(within(item).getByLabelText("Display name")).toHaveValue("Mock STT");
  });

  it("opens a route editor inside the selected list item", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <RouteManagement
        routing={routingWithRoute}
        pending={false}
        execute={execute}
      />
    );
    const item = screen.getByText("Route A").closest("li");
    if (!item) throw new Error("Expected the route list item");

    await user.click(within(item).getByRole("button", { name: "Edit" }));

    expect(within(item).getByLabelText("Display name")).toHaveValue("Route A");
  });

  it("clears composed assignments when switching a route to native mode", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <RouteManagement
        routing={routingWithRoute}
        pending={false}
        execute={execute}
      />
    );
    const item = screen.getByText("Route A").closest("li");
    if (!item) throw new Error("Expected the route list item");
    await user.click(within(item).getByRole("button", { name: "Edit" }));
    await user.selectOptions(
      within(item).getByLabelText("Voice pipeline mode"),
      "native-multimodal"
    );
    await user.selectOptions(
      within(item).getByLabelText("Native multimodal provider"),
      "model-native"
    );
    await user.click(
      within(item).getByRole("button", { name: "Save changes" })
    );

    const operation = execute.mock.calls[0]?.[0];
    expect(operation?.type).toBe("update-route");
    if (operation?.type !== "update-route") {
      throw new Error("Expected an update-route operation");
    }
    expect(operation.id).toBe("route-a");
    expect(operation.input).toMatchObject({
      mode: "native-multimodal",
      sttModelDeploymentId: null,
      chatModelDeploymentId: null,
      ttsModelDeploymentId: null,
      nativeModelDeploymentId: "model-native",
      sttStreamingEnabled: false,
      ttsStreamingEnabled: false
    });
  });

  it("disables editor-changing actions while a routing mutation is pending", () => {
    const execute = vi.fn(
      async (_operation: RuntimeRoutingOperation): Promise<unknown> => undefined
    );
    renderWithProviders(
      <ConnectionManagement routing={routing} pending execute={execute} />
    );

    expect(
      screen.getByRole("button", { name: "Add connection" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("tests an inactive route before activating it", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.spyOn(apiClient, "testRuntimeRoute").mockImplementation(async () => {
      calls.push("test");
      return routing;
    });
    vi.spyOn(apiClient, "activateRuntimeRoute").mockImplementation(async () => {
      calls.push("activate");
      return routing;
    });
    renderWithProviders(<TestAndActivateProbe />);

    await user.click(
      screen.getByRole("button", { name: "Run test and activate" })
    );
    await waitFor(() => expect(calls).toEqual(["test", "activate"]));
  });

  it("does not activate a route when its test fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "testRuntimeRoute").mockRejectedValue(
      new Error("Provider configuration is invalid")
    );
    const activate = vi
      .spyOn(apiClient, "activateRuntimeRoute")
      .mockResolvedValue(routing);
    renderWithProviders(<TestAndActivateProbe />);

    await user.click(
      screen.getByRole("button", { name: "Run test and activate" })
    );
    await waitFor(() => {
      expect(apiClient.testRuntimeRoute).toHaveBeenCalledWith("route-a");
    });
    expect(activate).not.toHaveBeenCalled();
  });

  it("refetches routing when testing succeeds but activation fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "runtimeRouting").mockResolvedValue(routing);
    vi.spyOn(apiClient, "testRuntimeRoute").mockResolvedValue(routing);
    vi.spyOn(apiClient, "activateRuntimeRoute").mockRejectedValue(
      new Error("Streaming routes cannot be activated")
    );
    renderWithProviders(<TestAndActivateWithRoutingProbe />);
    await waitFor(() =>
      expect(apiClient.runtimeRouting).toHaveBeenCalledOnce()
    );

    await user.click(
      screen.getByRole("button", { name: "Run test and activate" })
    );

    await waitFor(() =>
      expect(apiClient.runtimeRouting).toHaveBeenCalledTimes(2)
    );
  });

  it("refetches readiness when an active route test fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "runtimeRouting").mockResolvedValue(routing);
    vi.spyOn(apiClient, "testRuntimeRoute").mockRejectedValue(
      new Error("Provider connection test failed")
    );
    renderWithProviders(<TestRouteWithRoutingProbe />);
    await waitFor(() =>
      expect(apiClient.runtimeRouting).toHaveBeenCalledOnce()
    );

    await user.click(screen.getByRole("button", { name: "Run route test" }));

    await waitFor(() =>
      expect(apiClient.runtimeRouting).toHaveBeenCalledTimes(2)
    );
  });
});

function TestAndActivateProbe() {
  const { execute } = useRuntimeRoutingMutations();
  return (
    <button
      type="button"
      onClick={() => {
        void execute({
          type: "test-and-activate-route",
          id: "route-a"
        }).catch(() => undefined);
      }}
    >
      Run test and activate
    </button>
  );
}

function TestAndActivateWithRoutingProbe() {
  useQuery(runtimeRoutingQueryOptions());
  return <TestAndActivateProbe />;
}

function TestRouteWithRoutingProbe() {
  useQuery(runtimeRoutingQueryOptions());
  const { execute } = useRuntimeRoutingMutations();
  return (
    <button
      type="button"
      onClick={() => {
        void execute({ type: "test-route", id: "route-a" }).catch(
          () => undefined
        );
      }}
    >
      Run route test
    </button>
  );
}

function model(
  id: string,
  displayName: string,
  capabilities: RuntimeRoutingSummary["models"][number]["declaredCapabilities"]
): RuntimeRoutingSummary["models"][number] {
  return {
    id,
    connectionId: "connection-mock",
    displayName,
    modelName: id,
    apiVersion: "",
    providerOptions: {},
    declaredCapabilities: capabilities,
    verifiedCapabilities: capabilities,
    enabled: true
  };
}
