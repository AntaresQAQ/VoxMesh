import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { LlmConfiguration, LlmMode } from "@voxmesh/shared";

import { apiClient } from "../../api.js";
import { useI18n } from "../../i18n/i18n.js";
import { llmConfigurationQueryOptions, queryKeys } from "../../query.js";
import { localizedError } from "../../utils/errors.js";

type LlmFormValues = {
  mode: LlmMode;
  endpoint: string;
  deployment: string;
  apiVersion: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  apiKey: string;
};

const defaults: LlmFormValues = {
  mode: "mock",
  endpoint: "",
  deployment: "",
  apiVersion: "2024-10-21",
  baseUrl: "",
  model: "qwen-plus",
  timeoutMs: 30_000,
  maxOutputTokens: 1_024,
  apiKey: ""
};

/** Owns provider-neutral LLM Query/Form state for Settings. */
export function useLlmSettings() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const configuration = useQuery(llmConfigurationQueryOptions());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saveConfiguration = useMutation({
    mutationFn: apiClient.updateLlmConfiguration,
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.llmConfiguration, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    }
  });
  const testConnection = useMutation({
    mutationFn: apiClient.testLlmConnection
  });
  const formDefaults = useRef(defaults);
  const form = useForm({
    defaultValues: formDefaults.current,
    onSubmit: async ({ value }) => {
      setError("");
      setMessage("");
      try {
        const { apiKey, ...configurationValue } = value;
        const updated = await saveConfiguration.mutateAsync({
          ...configurationValue,
          ...(apiKey ? { apiKey } : {})
        });
        const updatedValues = toFormValues(updated);
        formDefaults.current = updatedValues;
        form.reset(updatedValues);
        setMessage(t("settings.llmSaved"));
      } catch (caught) {
        setError(localizedError(caught, t, "settings.saveFailed"));
      }
    }
  });

  useEffect(() => {
    if (configuration.data && form.state.isPristine) {
      const configuredValues = toFormValues(configuration.data);
      formDefaults.current = configuredValues;
      form.reset(configuredValues);
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

  return {
    form,
    configuration: configuration.data,
    message,
    error,
    testing: testConnection.isPending,
    test
  };
}

function toFormValues(configuration: LlmConfiguration): LlmFormValues {
  return {
    mode: configuration.mode,
    endpoint: configuration.endpoint,
    deployment: configuration.deployment,
    apiVersion: configuration.apiVersion,
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    timeoutMs: configuration.timeoutMs,
    maxOutputTokens: configuration.maxOutputTokens,
    apiKey: ""
  };
}
