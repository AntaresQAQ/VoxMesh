// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { ProviderSelect } from "./ProviderSelect.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProviderSelect", () => {
  it("filters the shared catalog by capability", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "providerCatalog").mockResolvedValue({
      providers: [
        {
          id: "mock",
          displayName: "Mock",
          capabilities: ["llm", "stt", "tts"]
        },
        {
          id: "openai-compatible",
          displayName: "OpenAI-compatible",
          capabilities: ["llm"]
        }
      ]
    });
    const onChange = vi.fn();
    renderWithProviders(
      <ProviderSelect
        capability="llm"
        label="Provider"
        value="mock"
        onChange={onChange}
      />
    );

    await screen.findByRole("option", { name: "OpenAI-compatible" });
    await user.selectOptions(
      screen.getByLabelText("Provider"),
      "openai-compatible"
    );

    expect(onChange).toHaveBeenCalledWith("openai-compatible");
    expect(
      screen.getByRole("option", { name: "OpenAI-compatible" })
    ).toBeVisible();
  });
});
