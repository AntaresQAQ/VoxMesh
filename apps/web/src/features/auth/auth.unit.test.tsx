// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { PasswordChangeCard } from "./PasswordChangeCard.js";
import { PasswordScreen } from "./PasswordScreen.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authentication components", () => {
  it("submits a password screen through its callback", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    renderWithProviders(
      <PasswordScreen
        title="Test sign in"
        description="Test description"
        submitLabel="Continue"
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByLabelText("Password"), "long test password");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("long test password")
    );
  });

  it("validates confirmation and changes the password", async () => {
    const user = userEvent.setup();
    const changePassword = vi
      .spyOn(apiClient, "changePassword")
      .mockResolvedValue(undefined);
    const onSessionEnded = vi.fn();
    renderWithProviders(<PasswordChangeCard onSessionEnded={onSessionEnded} />);

    await user.type(
      screen.getByLabelText("Current password"),
      "current password"
    );
    await user.type(
      screen.getByLabelText("New password", { exact: true }),
      "replacement password"
    );
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "different password"
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      screen.getByText("New password confirmation does not match.")
    ).toBeVisible();
    expect(changePassword).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "replacement password"
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(onSessionEnded).toHaveBeenCalledOnce());
  });
});
