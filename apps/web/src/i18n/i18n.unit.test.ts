import { describe, expect, it } from "vitest";

import { en } from "./en.js";
import { resolveInitialLocale } from "./i18n.js";
import { zhCN } from "./zh-CN.js";

describe("localization resources", () => {
  it("keeps Simplified Chinese translation coverage equal to English", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });

  it("uses saved, browser, and fallback locale precedence", () => {
    expect(resolveInitialLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveInitialLocale(null, ["zh-Hans-CN", "en"])).toBe("zh-CN");
    expect(resolveInitialLocale(null, ["fr-FR"])).toBe("en");
  });
});
