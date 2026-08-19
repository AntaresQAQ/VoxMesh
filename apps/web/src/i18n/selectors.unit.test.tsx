// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../test/render.js";
import { ThemeSelector } from "../theme/ThemeSelector.js";
import { LanguageSelector } from "./LanguageSelector.js";

describe("preference selectors", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("switches and persists the language", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LanguageSelector />);

    await user.selectOptions(screen.getByLabelText("Language"), "zh-CN");

    expect(document.documentElement.lang).toBe("zh-CN");
    expect(localStorage.getItem("voxmesh.locale")).toBe("zh-CN");
    expect(screen.getByLabelText("语言")).toBeVisible();
  });

  it("switches and persists the theme", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeSelector />);

    await user.selectOptions(screen.getByLabelText("Theme"), "light");

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("voxmesh.theme")).toBe("light");
  });
});
