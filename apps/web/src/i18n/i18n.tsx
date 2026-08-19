import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { en, type TranslationKey } from "./en.js";
import { zhCN } from "./zh-CN.js";

export type Locale = "en" | "zh-CN";

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  formatTime: (value: string) => string;
}

const STORAGE_KEY = "voxmesh.locale";
const resources: Record<Locale, Record<TranslationKey, string>> = {
  en,
  "zh-CN": zhCN
};
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    resolveInitialLocale(
      readStoredLocale(),
      typeof navigator === "undefined" ? [] : navigator.languages
    )
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale: setLocaleState,
      t: (key, values) =>
        interpolate(resources[locale][key] ?? en[key], values),
      formatTime: (date) =>
        new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }).format(new Date(date))
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return value;
}

export function resolveInitialLocale(
  saved: string | null,
  languages: readonly string[]
): Locale {
  if (saved === "en" || saved === "zh-CN") {
    return saved;
  }
  return languages.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en";
}

function readStoredLocale(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return localStorage.getItem(STORAGE_KEY);
}

function interpolate(
  template: string,
  values: Record<string, string | number> | undefined
): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? `{${key}}`)
  );
}
