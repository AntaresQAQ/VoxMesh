import { useI18n } from "../../i18n/i18n.js";

export function AzureLlmFields(props: {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  onEndpointChange: (value: string) => void;
  onDeploymentChange: (value: string) => void;
  onApiVersionChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend>{t("settings.azureOpenAiFields")}</legend>
      <label>
        {t("settings.azureEndpoint")}
        <input
          aria-label={t("settings.azureEndpoint")}
          value={props.endpoint}
          onChange={(event) => props.onEndpointChange(event.target.value)}
          placeholder="https://resource.openai.azure.com"
          required
        />
      </label>
      <label>
        {t("settings.deployment")}
        <input
          aria-label={t("settings.deployment")}
          value={props.deployment}
          onChange={(event) => props.onDeploymentChange(event.target.value)}
          required
        />
      </label>
      <label>
        {t("settings.apiVersion")}
        <input
          aria-label={t("settings.apiVersion")}
          value={props.apiVersion}
          onChange={(event) => props.onApiVersionChange(event.target.value)}
          required
        />
      </label>
    </fieldset>
  );
}
