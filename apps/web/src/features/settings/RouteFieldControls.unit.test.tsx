// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ModelDeploymentSummary } from "@voxmesh/shared";

import { renderWithProviders } from "../../test/render.js";
import { Checkbox, StreamingModelSelect } from "./RouteFieldControls.js";

describe("RouteFieldControls", () => {
  it("filters incompatible models and clears streaming for a buffered selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onStreamingChange = vi.fn();
    renderWithProviders(
      <StreamingModelSelect
        label="Chat model"
        value="streaming"
        capability="tool-calling"
        models={[
          model("missing-buffered", [
            "text-input",
            "text-output",
            "tool-calling",
            "streaming"
          ]),
          model("buffered", [
            "text-input",
            "text-output",
            "tool-calling",
            "non-streaming"
          ]),
          model("streaming", [
            "text-input",
            "text-output",
            "tool-calling",
            "non-streaming",
            "streaming"
          ])
        ]}
        onChange={onChange}
        onStreamingChange={onStreamingChange}
      />
    );

    expect(
      screen.queryByRole("option", { name: "missing-buffered" })
    ).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Chat model"), "buffered");
    expect(onChange).toHaveBeenCalledWith("buffered");
    expect(onStreamingChange).toHaveBeenCalledWith(false);

    onChange.mockClear();
    onStreamingChange.mockClear();
    await user.selectOptions(screen.getByLabelText("Chat model"), "streaming");
    expect(onChange).toHaveBeenCalledWith("streaming");
    expect(onStreamingChange).not.toHaveBeenCalled();
  });

  it("exposes checked, disabled, and change behavior for route checkboxes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = renderWithProviders(
      <Checkbox
        label="Enable streaming"
        checked={false}
        describedBy="streaming-help"
        onChange={onChange}
      />
    );

    expect(screen.getByLabelText("Enable streaming")).toHaveAttribute(
      "aria-describedby",
      "streaming-help"
    );
    await user.click(screen.getByLabelText("Enable streaming"));
    expect(onChange).toHaveBeenCalledWith(true);

    view.unmount();
    renderWithProviders(
      <Checkbox label="Enable streaming" checked disabled onChange={onChange} />
    );
    expect(screen.getByLabelText("Enable streaming")).toBeChecked();
    expect(screen.getByLabelText("Enable streaming")).toBeDisabled();
  });
});

function model(
  id: string,
  capabilities: ModelDeploymentSummary["declaredCapabilities"]
): ModelDeploymentSummary {
  return {
    id,
    connectionId: "connection",
    displayName: id,
    modelName: id,
    apiVersion: "",
    providerOptions: {},
    declaredCapabilities: capabilities,
    verifiedCapabilities: [],
    enabled: true
  };
}
