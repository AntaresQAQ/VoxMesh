import { PageHeader } from "../../components/layout/PageHeader.js";
import { PasswordChangeCard } from "../auth/PasswordChangeCard.js";
import { useI18n } from "../../i18n/i18n.js";
import { AiProvidersSettings } from "./AiProvidersSettings.js";
import {
  AppearanceSettingsCard,
  LanguageSettingsCard
} from "./PreferenceCards.js";
import {
  SettingsSectionNav,
  type SettingsSection
} from "./SettingsSectionNav.js";

export function SettingsPage(props: {
  section: SettingsSection;
  onSessionEnded: () => void;
}) {
  const { t } = useI18n();
  return (
    <PageHeader
      title={t("nav.settings")}
      description={t("settings.description")}
    >
      <SettingsSectionNav activeSection={props.section} />
      {props.section === "general" ? (
        <div className="settings-grid">
          <LanguageSettingsCard />
          <AppearanceSettingsCard />
        </div>
      ) : null}
      {props.section === "providers" ? <AiProvidersSettings /> : null}
      {props.section === "security" ? (
        <div className="settings-grid">
          <PasswordChangeCard onSessionEnded={props.onSessionEnded} />
        </div>
      ) : null}
    </PageHeader>
  );
}
