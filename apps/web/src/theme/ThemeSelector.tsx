import { useI18n } from "../i18n/i18n.js";
import { useTheme, type ThemeMode } from "./theme.js";

export function ThemeSelector() {
  const { t } = useI18n();
  const { mode, setMode } = useTheme();

  return (
    <label className="theme-selector">
      {t("settings.theme")}
      <select
        aria-label={t("settings.theme")}
        value={mode}
        onChange={(event) => setMode(event.target.value as ThemeMode)}
      >
        <option value="system">{t("settings.themeSystem")}</option>
        <option value="light">{t("settings.themeLight")}</option>
        <option value="dark">{t("settings.themeDark")}</option>
      </select>
    </label>
  );
}
