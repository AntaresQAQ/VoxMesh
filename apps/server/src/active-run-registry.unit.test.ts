import { describe, expect, it } from "vitest";

import { ActiveRunRegistry } from "./active-run-registry.js";

describe("ActiveRunRegistry", () => {
  it("starts, cancels, and removes only the matching controller", () => {
    const registry = new ActiveRunRegistry();
    const controller = registry.start("run-1");

    expect(registry.cancel("run-1")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    registry.finish("run-1", new AbortController());
    expect(() => registry.start("run-1")).toThrow("already active");
    registry.finish("run-1", controller);
    expect(() => registry.start("run-1")).not.toThrow();
  });
});
