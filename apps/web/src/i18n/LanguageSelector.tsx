import { useI18n, type Locale } from "./i18n.js";

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <label
      className={compact ? "language-selector compact" : "language-selector"}
    >
      {compact ? null : t("common.language")}
      <select
        aria-label={t("common.language")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="en">{t("common.english")}</option>
        <option value="zh-CN">{t("common.chinese")}</option>
      </select>
    </label>
  );
}
