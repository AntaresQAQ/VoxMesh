import { useI18n } from "../../i18n/i18n.js";

export function OpenAiCompatibleFields(props: {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onTimeoutChange: (value: number) => void;
  onMaxOutputTokensChange: (value: number) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend>{t("settings.compatibleFields")}</legend>
      <p className="muted">{t("settings.compatibleDescription")}</p>
      <label>
        {t("settings.baseUrl")}
        <input
          aria-label={t("settings.baseUrl")}
          value={props.baseUrl}
          onChange={(event) => props.onBaseUrlChange(event.target.value)}
          placeholder="https://workspace.example.com/compatible-mode/v1"
          required
        />
      </label>
      <label>
        {t("settings.model")}
        <input
          aria-label={t("settings.model")}
          value={props.model}
          onChange={(event) => props.onModelChange(event.target.value)}
          placeholder="qwen-plus"
          required
        />
      </label>
      <label>
        {t("settings.timeoutMs")}
        <input
          aria-label={t("settings.timeoutMs")}
          type="number"
          min={1}
          value={props.timeoutMs}
          onChange={(event) =>
            props.onTimeoutChange(Number(event.target.value))
          }
          required
        />
      </label>
      <label>
        {t("settings.maxOutputTokens")}
        <input
          aria-label={t("settings.maxOutputTokens")}
          type="number"
          min={1}
          value={props.maxOutputTokens}
          onChange={(event) =>
            props.onMaxOutputTokensChange(Number(event.target.value))
          }
          required
        />
      </label>
    </fieldset>
  );
}
