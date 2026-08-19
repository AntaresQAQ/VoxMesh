import type { SpeechProviderMode } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { SpeechProviderSelect } from "./SpeechProviderSelect.js";

export function SpeechSttFields(props: {
  mode: SpeechProviderMode;
  endpoint: string;
  deployment: string;
  apiVersion: string;
  language: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  onModeChange: (value: SpeechProviderMode) => void;
  onEndpointChange: (value: string) => void;
  onDeploymentChange: (value: string) => void;
  onApiVersionChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend>{t("settings.sttTitle")}</legend>
      <SpeechProviderSelect
        capability="stt"
        label={t("settings.sttProvider")}
        value={props.mode}
        onChange={props.onModeChange}
      />
      {props.mode === "alibaba-model-studio" ? (
        <p className="muted">{t("settings.alibabaSpeechDescription")}</p>
      ) : null}
      {props.mode !== "mock" ? (
        <>
          <label>
            {props.mode === "azure-openai"
              ? t("settings.azureEndpoint")
              : props.mode === "alibaba-model-studio"
                ? t("settings.websocketEndpoint")
                : t("settings.baseUrl")}
            <input
              aria-label={t("settings.sttEndpoint")}
              value={props.endpoint}
              onChange={(event) => props.onEndpointChange(event.target.value)}
              placeholder={
                props.mode === "azure-openai"
                  ? "https://stt-resource.openai.azure.com"
                  : props.mode === "alibaba-model-studio"
                    ? "wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference"
                    : "https://provider.example.com/v1"
              }
              required
            />
          </label>
          <label>
            {t("settings.apiKey")}
            <input
              aria-label={t("settings.sttApiKey")}
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
          <label>
            {props.mode === "azure-openai"
              ? t("settings.deployment")
              : t("settings.model")}
            <input
              aria-label={t("settings.sttDeployment")}
              value={props.deployment}
              onChange={(event) => props.onDeploymentChange(event.target.value)}
              required
            />
          </label>
          {props.mode === "azure-openai" ? (
            <label>
              {t("settings.apiVersion")}
              <input
                aria-label={t("settings.sttApiVersion")}
                value={props.apiVersion}
                onChange={(event) =>
                  props.onApiVersionChange(event.target.value)
                }
                required
              />
            </label>
          ) : null}
          <label>
            {t("settings.languageCode")}
            <input
              aria-label={t("settings.sttLanguage")}
              value={props.language}
              onChange={(event) => props.onLanguageChange(event.target.value)}
              required
            />
          </label>
        </>
      ) : null}
    </fieldset>
  );
}
