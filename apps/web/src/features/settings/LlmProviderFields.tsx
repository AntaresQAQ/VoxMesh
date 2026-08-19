import type { LlmMode } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { ProviderSelect } from "./ProviderSelect.js";

export function LlmProviderFields(props: {
  mode: LlmMode;
  apiKey: string;
  apiKeyConfigured: boolean;
  onModeChange: (value: LlmMode) => void;
  onApiKeyChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <ProviderSelect
        capability="llm"
        label={t("settings.provider")}
        value={props.mode}
        onChange={(value) => props.onModeChange(value as LlmMode)}
      />
      {props.mode !== "mock" ? (
        <label>
          {t("settings.apiKey")}
          <input
            aria-label={t("settings.apiKey")}
            type="password"
            value={props.apiKey}
            onChange={(event) => props.onApiKeyChange(event.target.value)}
            placeholder={
              props.apiKeyConfigured
                ? t("settings.apiKeyConfigured")
                : t("settings.apiKeyMissing")
            }
            required={!props.apiKeyConfigured}
          />
        </label>
      ) : null}
    </>
  );
}
