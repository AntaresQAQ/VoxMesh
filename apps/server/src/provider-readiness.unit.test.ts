import { describe, expect, it } from "vitest";

import { safeProviderReadinessError } from "./provider-readiness.js";

describe("safeProviderReadinessError", () => {
  it.each([
    ["HTTP 401 secret response", "authentication"],
    ["HTTP 429 quota exhausted for api-key=secret", "quota"],
    ["Provider request timed out", "timeout"],
    ["Provider returned malformed JSON", "invalid-response"],
    ["Azure OpenAI requires an endpoint", "configuration"],
    ["Socket closed unexpectedly", "provider"]
  ] as const)(
    "maps %s to %s without retaining raw details",
    (message, category) => {
      const result = safeProviderReadinessError(new Error(message));

      expect(result.category).toBe(category);
      expect(result.message).not.toContain(message);
      expect(result.message.length).toBeLessThanOrEqual(500);
    }
  );

  it("distinguishes caller cancellation from timeout", () => {
    expect(
      safeProviderReadinessError(new DOMException("secret", "AbortError"))
    ).toEqual({
      category: "cancelled",
      message: "Provider connection test was cancelled."
    });
    expect(
      safeProviderReadinessError(new DOMException("secret", "TimeoutError"))
    ).toEqual({
      category: "timeout",
      message: "Provider connection test timed out."
    });
  });

  it("never serializes unknown rejection values", () => {
    expect(
      safeProviderReadinessError({
        apiKey: "secret",
        endpoint: "https://workspace.example.test"
      })
    ).toEqual({
      category: "provider",
      message: "Provider connection test failed."
    });
  });
});
