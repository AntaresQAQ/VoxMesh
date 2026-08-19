import { describe, expect, it, vi } from "vitest";

import { ProviderRegistry } from "./provider-registry.js";

describe("ProviderRegistry", () => {
  it("validates and creates a registered provider", () => {
    const validate = vi.fn();
    const registry = new ProviderRegistry<{ provider: string }, string>(
      (config) => config.provider
    ).register({
      id: "test",
      displayName: "Test",
      capabilities: ["llm"],
      validate,
      create: () => "provider"
    });

    expect(registry.create({ provider: "test" })).toBe("provider");
    expect(validate).toHaveBeenCalledOnce();
  });

  it("rejects unknown and duplicate providers", () => {
    const registry = new ProviderRegistry<{ provider: string }, string>(
      (config) => config.provider
    ).register({
      id: "test",
      displayName: "Test",
      capabilities: ["llm"],
      validate: () => undefined,
      create: () => "provider"
    });

    expect(() => registry.create({ provider: "missing" })).toThrow(
      "Unknown provider"
    );
    expect(() =>
      registry.register({
        id: "test",
        displayName: "Test",
        capabilities: ["llm"],
        validate: () => undefined,
        create: () => "other"
      })
    ).toThrow("already registered");
    expect(registry.descriptors()).toEqual([
      {
        id: "test",
        displayName: "Test",
        capabilities: ["llm"]
      }
    ]);
  });
});
