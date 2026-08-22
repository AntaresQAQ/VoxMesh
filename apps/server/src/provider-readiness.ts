import type { ProviderReadinessErrorCategory } from "@voxmesh/shared";

export interface SafeProviderReadinessError {
  category: ProviderReadinessErrorCategory;
  message: string;
}

/**
 * Converts provider failures into stable diagnostics without retaining raw
 * response bodies, endpoints, account identifiers, stack traces, or secrets.
 */
export function safeProviderReadinessError(
  error: unknown
): SafeProviderReadinessError {
  const message = error instanceof Error ? error.message : "";
  const statusCode =
    error instanceof Error &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : undefined;

  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return error.name === "AbortError"
      ? safeError("cancelled", "Provider connection test was cancelled.")
      : safeError("timeout", "Provider connection test timed out.");
  }
  if (
    /\b401\b|\b403\b|\bauthentication\b|\bunauthorized\b|\bforbidden\b|\bapi[-_ ]?key\b|\bcredential/iu.test(
      message
    )
  ) {
    return safeError("authentication", "Provider authentication failed.");
  }
  if (/\b429\b|\bquota\b|\brate limit\b|\bthrottl/iu.test(message)) {
    return safeError("quota", "Provider quota or rate limit was exceeded.");
  }
  if (/\btimeout\b|\btimed out\b/iu.test(message)) {
    return safeError("timeout", "Provider connection test timed out.");
  }
  if (
    /\bmalformed\b|\binvalid (?:response|json)\b|\bempty (?:response|audio|text)\b/iu.test(
      message
    )
  ) {
    return safeError(
      "invalid-response",
      "Provider returned an invalid response."
    );
  }
  if (
    statusCode === 400 ||
    /\brequires\b|\bmissing\b|\bunsupported\b|\bnot configured\b/iu.test(
      message
    )
  ) {
    return safeError("configuration", "Provider configuration is invalid.");
  }
  return safeError("provider", "Provider connection test failed.");
}

function safeError(
  category: ProviderReadinessErrorCategory,
  message: string
): SafeProviderReadinessError {
  return { category, message };
}
