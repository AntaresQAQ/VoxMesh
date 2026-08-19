import type { LlmMode } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

export interface LlmConfigurationFieldsProps {
  mode: LlmMode;
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  busy: boolean;
  describedBy?: string | undefined;
  onModeChange: (mode: LlmMode) => void;
  onEndpointChange: (value: string) => void;
  onDeploymentChange: (value: string) => void;
  onApiVersionChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onTestConnection: () => void;
}

export function LlmConfigurationFields(props: LlmConfigurationFieldsProps) {
  const { t } = useI18n();
  return (
    <>
      <label>
        {t("settings.provider")}
        <select
          aria-label={t("settings.provider")}
          aria-describedby={props.describedBy}
          value={props.mode}
          onChange={(event) =>
            props.onModeChange(event.target.value as LlmMode)
          }
        >
          <option value="mock">{t("common.mock")}</option>
          <option value="azure-openai">{t("common.azureOpenAI")}</option>
        </select>
      </label>
      <label>
        {t("settings.azureEndpoint")}
        <input
          aria-label={t("settings.azureEndpoint")}
          aria-describedby={props.describedBy}
          value={props.endpoint}
          onChange={(event) => props.onEndpointChange(event.target.value)}
          placeholder="https://resource.openai.azure.com"
          required={props.mode === "azure-openai"}
        />
      </label>
      <label>
        {t("settings.deployment")}
        <input
          aria-label={t("settings.deployment")}
          aria-describedby={props.describedBy}
          value={props.deployment}
          onChange={(event) => props.onDeploymentChange(event.target.value)}
          required={props.mode === "azure-openai"}
        />
      </label>
      <label>
        {t("settings.apiVersion")}
        <input
          aria-label={t("settings.apiVersion")}
          aria-describedby={props.describedBy}
          value={props.apiVersion}
          onChange={(event) => props.onApiVersionChange(event.target.value)}
          required={props.mode === "azure-openai"}
        />
      </label>
      <label>
        {t("settings.apiKey")}
        <input
          aria-label={t("settings.apiKey")}
          aria-describedby={props.describedBy}
          type="password"
          value={props.apiKey}
          onChange={(event) => props.onApiKeyChange(event.target.value)}
          placeholder={
            props.apiKeyConfigured
              ? t("settings.apiKeyConfigured")
              : t("settings.apiKeyMissing")
          }
          required={props.mode === "azure-openai" && !props.apiKeyConfigured}
        />
      </label>
      <div className="button-row">
        <button disabled={props.busy}>{t("settings.saveLlm")}</button>
        <button
          className="secondary"
          type="button"
          disabled={props.busy}
          onClick={props.onTestConnection}
        >
          {t("settings.testConnection")}
        </button>
      </div>
    </>
  );
}
