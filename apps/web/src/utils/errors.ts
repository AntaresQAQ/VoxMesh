import { ApiClientError } from "../api.js";
import type { TranslationKey } from "../i18n/en.js";

export type Translator = (
  key: TranslationKey,
  values?: Record<string, string | number>
) => string;

export function localizedError(
  caught: unknown,
  t: Translator,
  fallback: TranslationKey
): string {
  if (caught instanceof ApiClientError) {
    switch (caught.code) {
      case "AUTHENTICATION_REQUIRED":
        return t("errors.AUTHENTICATION_REQUIRED");
      case "INVALID_CREDENTIALS":
        return t("errors.INVALID_CREDENTIALS");
      case "LOGIN_RATE_LIMITED":
        return t("errors.LOGIN_RATE_LIMITED");
      case "PASSWORD_UNCHANGED":
        return t("errors.PASSWORD_UNCHANGED");
      case "REQUEST_ERROR":
        return caught.message;
      case "INTERNAL_ERROR":
        return t("errors.INTERNAL_ERROR");
      default:
        return caught.message;
    }
  }
  return caught instanceof Error ? caught.message : t(fallback);
}
