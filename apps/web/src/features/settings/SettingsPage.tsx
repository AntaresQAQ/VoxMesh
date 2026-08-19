import { PageHeader } from "../../components/layout/PageHeader.js";
import { PasswordChangeCard } from "../auth/PasswordChangeCard.js";
import { useI18n } from "../../i18n/i18n.js";
import { LlmSettingsCard } from "./LlmSettingsCard.js";
import {
  AppearanceSettingsCard,
  LanguageSettingsCard
} from "./PreferenceCards.js";

export function SettingsPage({
  onSessionEnded
}: {
  onSessionEnded: () => void;
}) {
  const { t } = useI18n();
  return (
    <PageHeader
      title={t("nav.settings")}
      description={t("settings.description")}
    >
      <div className="settings-grid">
        <LanguageSettingsCard />
        <AppearanceSettingsCard />
        <LlmSettingsCard />
        <PasswordChangeCard onSessionEnded={onSessionEnded} />
      </div>
    </PageHeader>
  );
}
