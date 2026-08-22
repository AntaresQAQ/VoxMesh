import {
  providerReadinessErrorMessage,
  type ProviderReadinessErrorCategory
} from "@voxmesh/shared";

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
      ? safeError("cancelled")
      : safeError("timeout");
  }
  if (/\b429\b|\bquota\b|\brate limit\b|\bthrottl/iu.test(message)) {
    return safeError("quota");
  }
  if (
    /\b401\b|\b403\b|\bauthentication\b|\bunauthorized\b|\bforbidden\b|\bapi[-_ ]?key\b|\bcredential/iu.test(
      message
    )
  ) {
    return safeError("authentication");
  }
  if (/\btimeout\b|\btimed out\b/iu.test(message)) {
    return safeError("timeout");
  }
  if (
    /\bmalformed\b|\binvalid (?:response|json)\b|\bempty (?:response|audio|text)\b/iu.test(
      message
    )
  ) {
    return safeError("invalid-response");
  }
  if (
    statusCode === 400 ||
    /\brequires\b|\bmissing\b|\bunsupported\b|\bnot configured\b/iu.test(
      message
    )
  ) {
    return safeError("configuration");
  }
  return safeError("provider");
}

function safeError(
  category: ProviderReadinessErrorCategory
): SafeProviderReadinessError {
  return { category, message: providerReadinessErrorMessage(category) };
}
