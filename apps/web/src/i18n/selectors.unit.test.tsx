// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render.js";
import { ThemeSelector } from "../theme/ThemeSelector.js";
import { LanguageSelector } from "./LanguageSelector.js";

describe("preference selectors", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("subscribes to system changes only in System mode", async () => {
    const user = userEvent.setup();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener,
      removeEventListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    });
    localStorage.setItem("voxmesh.theme", "dark");
    renderWithProviders(<ThemeSelector />);

    expect(addEventListener).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("Theme"), "system");
    expect(addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function)
    );
  });
});
