import type { FormEvent } from "react";

import { useI18n } from "../../i18n/i18n.js";
import { AzureLlmFields } from "./AzureLlmFields.js";
import { LlmProviderFields } from "./LlmProviderFields.js";
import { OpenAiCompatibleFields } from "./OpenAiCompatibleFields.js";
import { useLlmSettings } from "./useLlmSettings.js";

export function LlmSettingsCard() {
  const { t } = useI18n();
  const { form, configuration, message, error, testing, test } =
    useLlmSettings();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <section className="settings-card">
      <h3>{t("settings.llmTitle")}</h3>
      <p className="muted">{t("settings.llmDescription")}</p>
      <form onSubmit={submit}>
        <form.Subscribe
          selector={(state) => [state.values, state.isSubmitting] as const}
        >
          {([values, isSubmitting]) => (
            <>
              <LlmProviderFields
                mode={values.mode}
                apiKey={values.apiKey}
                apiKeyConfigured={configuration?.apiKeyConfigured ?? false}
                onModeChange={(value) => form.setFieldValue("mode", value)}
                onApiKeyChange={(value) => form.setFieldValue("apiKey", value)}
              />
              {values.mode === "azure-openai" ? (
                <AzureLlmFields
                  endpoint={values.endpoint}
                  deployment={values.deployment}
                  apiVersion={values.apiVersion}
                  onEndpointChange={(value) =>
                    form.setFieldValue("endpoint", value)
                  }
                  onDeploymentChange={(value) =>
                    form.setFieldValue("deployment", value)
                  }
                  onApiVersionChange={(value) =>
                    form.setFieldValue("apiVersion", value)
                  }
                />
              ) : null}
              {values.mode === "openai-compatible" ? (
                <OpenAiCompatibleFields
                  baseUrl={values.baseUrl}
                  model={values.model}
                  timeoutMs={values.timeoutMs}
                  maxOutputTokens={values.maxOutputTokens}
                  onBaseUrlChange={(value) =>
                    form.setFieldValue("baseUrl", value)
                  }
                  onModelChange={(value) => form.setFieldValue("model", value)}
                  onTimeoutChange={(value) =>
                    form.setFieldValue("timeoutMs", value)
                  }
                  onMaxOutputTokensChange={(value) =>
                    form.setFieldValue("maxOutputTokens", value)
                  }
                />
              ) : null}
              <div className="button-row">
                <button disabled={isSubmitting || testing}>
                  {t("settings.saveLlm")}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={isSubmitting || testing}
                  onClick={() => void test()}
                >
                  {t("settings.testConnection")}
                </button>
              </div>
            </>
          )}
        </form.Subscribe>
      </form>
      {message ? (
        <p className="success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p id="llm-settings-error" className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
