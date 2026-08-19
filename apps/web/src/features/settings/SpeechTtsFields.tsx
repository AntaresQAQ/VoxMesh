import type { SpeechProviderMode } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { SpeechProviderSelect } from "./SpeechProviderSelect.js";

export function SpeechTtsFields(props: {
  mode: SpeechProviderMode;
  endpoint: string;
  deployment: string;
  apiVersion: string;
  voice: string;
  instructions: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  onModeChange: (value: SpeechProviderMode) => void;
  onEndpointChange: (value: string) => void;
  onDeploymentChange: (value: string) => void;
  onApiVersionChange: (value: string) => void;
  onVoiceChange: (value: string) => void;
  onInstructionsChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend>{t("settings.ttsTitle")}</legend>
      <SpeechProviderSelect
        capability="tts"
        label={t("settings.ttsProvider")}
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
              aria-label={t("settings.ttsEndpoint")}
              value={props.endpoint}
              onChange={(event) => props.onEndpointChange(event.target.value)}
              placeholder={
                props.mode === "azure-openai"
                  ? "https://tts-resource.openai.azure.com"
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
              aria-label={t("settings.ttsApiKey")}
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
              aria-label={t("settings.ttsDeployment")}
              value={props.deployment}
              onChange={(event) => props.onDeploymentChange(event.target.value)}
              required
            />
          </label>
          {props.mode === "azure-openai" ? (
            <label>
              {t("settings.apiVersion")}
              <input
                aria-label={t("settings.ttsApiVersion")}
                value={props.apiVersion}
                onChange={(event) =>
                  props.onApiVersionChange(event.target.value)
                }
                required
              />
            </label>
          ) : null}
          <label>
            {t("settings.ttsVoice")}
            <input
              aria-label={t("settings.ttsVoice")}
              value={props.voice}
              onChange={(event) => props.onVoiceChange(event.target.value)}
              required
            />
          </label>
          <label>
            {t("settings.ttsInstructions")}
            <textarea
              aria-label={t("settings.ttsInstructions")}
              value={props.instructions}
              onChange={(event) =>
                props.onInstructionsChange(event.target.value)
              }
            />
          </label>
        </>
      ) : null}
    </fieldset>
  );
}
