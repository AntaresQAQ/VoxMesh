import type { ProviderReadinessErrorCategory } from "./schemas.js";

const readinessErrorMessages: Record<ProviderReadinessErrorCategory, string> = {
  authentication: "Provider authentication failed.",
  quota: "Provider quota or rate limit was exceeded.",
  timeout: "Provider connection test timed out.",
  "invalid-response": "Provider returned an invalid response.",
  configuration: "Provider configuration is invalid.",
  cancelled: "Provider connection test was cancelled.",
  provider: "Provider connection test failed."
};

/**
 * Returns the only diagnostic message that may be persisted for a readiness
 * category. Callers must never substitute raw provider error text.
 */
export function providerReadinessErrorMessage(
  category: ProviderReadinessErrorCategory
): string {
  return readinessErrorMessages[category];
}
