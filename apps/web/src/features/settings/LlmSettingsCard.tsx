import { useEffect, useState, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { LlmMode } from "@voxmesh/shared";

import { apiClient } from "../../api.js";
import { useI18n } from "../../i18n/i18n.js";
import { llmConfigurationQueryOptions, queryKeys } from "../../query.js";
import { localizedError } from "../../utils/errors.js";
import { LlmConfigurationFields } from "./LlmConfigurationFields.js";

const defaultValues: {
  mode: LlmMode;
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
} = {
  mode: "mock",
  endpoint: "",
  deployment: "",
  apiVersion: "2024-10-21",
  apiKey: ""
};

export function LlmSettingsCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const configuration = useQuery(llmConfigurationQueryOptions());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saveConfiguration = useMutation({
    mutationFn: apiClient.updateLlmConfiguration,
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.llmConfiguration, updated);
    }
  });
  const testConnection = useMutation({
    mutationFn: apiClient.testLlmConnection
  });
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setError("");
      setMessage("");
      try {
        await saveConfiguration.mutateAsync({
          mode: value.mode,
          endpoint: value.endpoint,
          deployment: value.deployment,
          apiVersion: value.apiVersion,
          ...(value.apiKey ? { apiKey: value.apiKey } : {})
        });
        form.setFieldValue("apiKey", "");
        setMessage(t("settings.llmSaved"));
      } catch (caught) {
        setError(localizedError(caught, t, "settings.saveFailed"));
      }
    }
  });

  useEffect(() => {
    if (configuration.data) {
      form.reset({
        mode: configuration.data.mode,
        endpoint: configuration.data.endpoint,
        deployment: configuration.data.deployment,
        apiVersion: configuration.data.apiVersion,
        apiKey: ""
      });
    }
  }, [configuration.data, form]);

  const test = async () => {
    setError("");
    setMessage("");
    try {
      const result = await testConnection.mutateAsync();
      setMessage(t("settings.connectionResult", { response: result.response }));
    } catch (caught) {
      setError(localizedError(caught, t, "settings.connectionFailed"));
    }
  };

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
            <LlmConfigurationFields
              mode={values.mode}
              endpoint={values.endpoint}
              deployment={values.deployment}
              apiVersion={values.apiVersion}
              apiKey={values.apiKey}
              apiKeyConfigured={configuration.data?.apiKeyConfigured ?? false}
              busy={isSubmitting || testConnection.isPending}
              describedBy={error ? "llm-settings-error" : undefined}
              onModeChange={(value) => form.setFieldValue("mode", value)}
              onEndpointChange={(value) =>
                form.setFieldValue("endpoint", value)
              }
              onDeploymentChange={(value) =>
                form.setFieldValue("deployment", value)
              }
              onApiVersionChange={(value) =>
                form.setFieldValue("apiVersion", value)
              }
              onApiKeyChange={(value) => form.setFieldValue("apiKey", value)}
              onTestConnection={() => void test()}
            />
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
