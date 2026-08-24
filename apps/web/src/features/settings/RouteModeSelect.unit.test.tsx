// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render.js";
import { RouteEditorActions, RouteModeSelect } from "./RouteModeSelect.js";

describe("RouteModeSelect", () => {
  it("reports the selected pipeline mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <RouteModeSelect value="composed" onChange={onChange} />
    );

    await user.selectOptions(
      screen.getByLabelText("Voice pipeline mode"),
      "native-multimodal"
    );
    expect(onChange).toHaveBeenCalledWith("native-multimodal");
  });

  it("exposes submit state and cancel behavior", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const view = renderWithProviders(
      <RouteEditorActions editing pending onCancel={onCancel} />
    );

    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();

    view.unmount();
    renderWithProviders(
      <RouteEditorActions editing={false} pending={false} onCancel={onCancel} />
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });
});
