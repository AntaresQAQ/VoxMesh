import { LanguageSelector } from "../../i18n/LanguageSelector.js";
import { useI18n } from "../../i18n/i18n.js";
import { ThemeSelector } from "../../theme/ThemeSelector.js";

export function LanguageSettingsCard() {
  const { t } = useI18n();
  return (
    <section className="settings-card">
      <h3>{t("settings.languageTitle")}</h3>
      <p className="muted">{t("settings.languageDescription")}</p>
      <LanguageSelector />
    </section>
  );
}

export function AppearanceSettingsCard() {
  const { t } = useI18n();
  return (
    <section className="settings-card">
      <h3>{t("settings.appearanceTitle")}</h3>
      <p className="muted">{t("settings.appearanceDescription")}</p>
      <ThemeSelector />
    </section>
  );
}
