import { Link } from "@tanstack/react-router";

import { useI18n } from "../../i18n/i18n.js";

export type SettingsSection = "general" | "providers" | "security";

const sections: SettingsSection[] = ["general", "providers", "security"];

export function SettingsSectionNav({
  activeSection
}: {
  activeSection: SettingsSection;
}) {
  const { t } = useI18n();
  return (
    <nav className="settings-section-nav" aria-label={t("settings.sections")}>
      {sections.map((section) => (
        <Link
          key={section}
          to="/settings"
          search={{ section }}
          aria-current={activeSection === section ? "page" : undefined}
          className={activeSection === section ? "active" : ""}
        >
          {t(`settings.section.${section}`)}
        </Link>
      ))}
    </nav>
  );
}
