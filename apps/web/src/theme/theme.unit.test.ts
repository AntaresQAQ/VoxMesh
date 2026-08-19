import { describe, expect, it } from "vitest";

import { resolveInitialTheme, resolveTheme } from "./theme.js";

describe("theme resolution", () => {
  it("uses System when no valid preference is saved", () => {
    expect(resolveInitialTheme(null)).toBe("system");
    expect(resolveInitialTheme("unknown")).toBe("system");
    expect(resolveInitialTheme("dark")).toBe("dark");
  });

  it("resolves explicit and system themes", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
