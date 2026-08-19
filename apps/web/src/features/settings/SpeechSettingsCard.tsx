import type { FormEvent } from "react";

import { useI18n } from "../../i18n/i18n.js";
import { SpeechSttFields } from "./SpeechSttFields.js";
import { SpeechTtsFields } from "./SpeechTtsFields.js";
import { useSpeechSettings } from "./useSpeechSettings.js";

export function SpeechSettingsCard() {
  const { t } = useI18n();
  const {
    form,
    configuration,
    message,
    error,
    testing,
    test,
    selectSttMode,
    selectTtsMode
  } = useSpeechSettings();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <section className="settings-card settings-card-wide">
      <h3>{t("settings.speechTitle")}</h3>
      <p className="muted">{t("settings.speechDescription")}</p>
      <form onSubmit={submit}>
        <form.Subscribe
          selector={(state) => [state.values, state.isSubmitting] as const}
        >
          {([values, isSubmitting]) => (
            <>
              <div className="speech-provider-grid">
                <SpeechSttFields
                  mode={values.sttMode}
                  endpoint={values.sttEndpoint}
                  deployment={values.sttDeployment}
                  apiVersion={values.sttApiVersion}
                  language={values.sttLanguage}
                  apiKey={values.sttApiKey}
                  apiKeyConfigured={configuration?.sttApiKeyConfigured ?? false}
                  onModeChange={selectSttMode}
                  onEndpointChange={(value) =>
                    form.setFieldValue("sttEndpoint", value)
                  }
                  onDeploymentChange={(value) =>
                    form.setFieldValue("sttDeployment", value)
                  }
                  onApiVersionChange={(value) =>
                    form.setFieldValue("sttApiVersion", value)
                  }
                  onLanguageChange={(value) =>
                    form.setFieldValue("sttLanguage", value)
                  }
                  onApiKeyChange={(value) =>
                    form.setFieldValue("sttApiKey", value)
                  }
                />
                <SpeechTtsFields
                  mode={values.ttsMode}
                  endpoint={values.ttsEndpoint}
                  deployment={values.ttsDeployment}
                  apiVersion={values.ttsApiVersion}
                  voice={values.ttsVoice}
                  instructions={values.ttsInstructions}
                  apiKey={values.ttsApiKey}
                  apiKeyConfigured={configuration?.ttsApiKeyConfigured ?? false}
                  onModeChange={selectTtsMode}
                  onEndpointChange={(value) =>
                    form.setFieldValue("ttsEndpoint", value)
                  }
                  onDeploymentChange={(value) =>
                    form.setFieldValue("ttsDeployment", value)
                  }
                  onApiVersionChange={(value) =>
                    form.setFieldValue("ttsApiVersion", value)
                  }
                  onVoiceChange={(value) =>
                    form.setFieldValue("ttsVoice", value)
                  }
                  onInstructionsChange={(value) =>
                    form.setFieldValue("ttsInstructions", value)
                  }
                  onApiKeyChange={(value) =>
                    form.setFieldValue("ttsApiKey", value)
                  }
                />
              </div>
              <div className="button-row">
                <button disabled={isSubmitting || testing}>
                  {t("settings.saveSpeech")}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={isSubmitting || testing}
                  onClick={() => void test()}
                >
                  {t("settings.testSpeech")}
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
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
