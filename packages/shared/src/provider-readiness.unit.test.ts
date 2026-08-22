import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { providerReadinessErrorMessage } from "./provider-readiness.js";
import { ProviderReadinessSchema } from "./schemas.js";

describe("provider readiness contract", () => {
  beforeAll(() => {
    FormatRegistry.Set(
      "date-time",
      (value) => !Number.isNaN(Date.parse(value))
    );
  });

  afterAll(() => {
    FormatRegistry.Delete("date-time");
  });

  it("accepts only state-consistent readiness values", () => {
    expect(
      Value.Check(ProviderReadinessSchema, {
        state: "unknown",
        lastTestedAt: null,
        lastError: null
      })
    ).toBe(true);
    expect(
      Value.Check(ProviderReadinessSchema, {
        state: "testing",
        lastTestedAt: "2026-08-22T07:00:00.000Z",
        lastError: null
      })
    ).toBe(true);
    expect(
      Value.Check(ProviderReadinessSchema, {
        state: "ready",
        lastTestedAt: null,
        lastError: null
      })
    ).toBe(false);
    expect(
      Value.Check(ProviderReadinessSchema, {
        state: "ready",
        lastTestedAt: "2026-08-22T07:00:00.000Z",
        lastError: {
          category: "provider",
          message: "Provider connection test failed."
        }
      })
    ).toBe(false);
    expect(
      Value.Check(ProviderReadinessSchema, {
        state: "failed",
        lastTestedAt: "2026-08-22T07:00:00.000Z",
        lastError: null
      })
    ).toBe(false);
  });

  it("provides fixed safe messages for every error category", () => {
    expect(providerReadinessErrorMessage("authentication")).toBe(
      "Provider authentication failed."
    );
    expect(providerReadinessErrorMessage("provider")).toBe(
      "Provider connection test failed."
    );
  });
});
