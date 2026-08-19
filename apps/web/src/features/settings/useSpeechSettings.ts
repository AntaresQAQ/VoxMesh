import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SpeechConfiguration, SpeechProviderMode } from "@voxmesh/shared";

import { apiClient } from "../../api.js";
import { useI18n } from "../../i18n/i18n.js";
import { queryKeys, speechConfigurationQueryOptions } from "../../query.js";
import { localizedError } from "../../utils/errors.js";

type SpeechFormValues = {
  sttMode: SpeechProviderMode;
  ttsMode: SpeechProviderMode;
  sttEndpoint: string;
  sttDeployment: string;
  sttApiVersion: string;
  sttLanguage: string;
  sttApiKey: string;
  ttsEndpoint: string;
  ttsDeployment: string;
  ttsApiVersion: string;
  ttsVoice: string;
  ttsInstructions: string;
  ttsApiKey: string;
};

const defaults: SpeechFormValues = {
  sttMode: "mock",
  ttsMode: "mock",
  sttEndpoint: "",
  sttDeployment: "",
  sttApiVersion: "2025-04-01-preview",
  sttLanguage: "zh",
  sttApiKey: "",
  ttsEndpoint: "",
  ttsDeployment: "",
  ttsApiVersion: "2025-03-01-preview",
  ttsVoice: "coral",
  ttsInstructions: "Speak clearly and naturally.",
  ttsApiKey: ""
};

/** Owns TanStack Query/Form state for the speech configuration card. */
export function useSpeechSettings() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const configuration = useQuery(speechConfigurationQueryOptions());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saveConfiguration = useMutation({
    mutationFn: apiClient.updateSpeechConfiguration,
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.speechConfiguration, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    }
  });
  const testConnection = useMutation({
    mutationFn: apiClient.testSpeechConnection
  });
  const formDefaults = useRef(defaults);
  const form = useForm({
    defaultValues: formDefaults.current,
    onSubmit: async ({ value }) => {
      setError("");
      setMessage("");
      try {
        const { sttApiKey, ttsApiKey, ...configurationValue } = value;
        const updated = await saveConfiguration.mutateAsync({
          ...configurationValue,
          ...(sttApiKey ? { sttApiKey } : {}),
          ...(ttsApiKey ? { ttsApiKey } : {})
        });
        const updatedValues = toFormValues(updated);
        formDefaults.current = updatedValues;
        form.reset(updatedValues);
        setMessage(t("settings.speechSaved"));
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
      setMessage(
        t("settings.speechConnectionResult", {
          transcript: result.transcript,
          mimeType: result.audioMimeType
        })
      );
    } catch (caught) {
      setError(localizedError(caught, t, "settings.connectionFailed"));
    }
  };

  const selectSttMode = (mode: SpeechProviderMode) => {
    form.setFieldValue("sttMode", mode);
    if (mode !== "alibaba-model-studio") return;
    const endpoint = toAlibabaWebSocketEndpoint(form.state.values.sttEndpoint);
    if (endpoint !== form.state.values.sttEndpoint) {
      form.setFieldValue("sttEndpoint", endpoint);
    }
    if (
      !form.state.values.sttDeployment ||
      form.state.values.sttDeployment.includes("filetrans")
    ) {
      form.setFieldValue("sttDeployment", "fun-asr-realtime");
    }
  };

  const selectTtsMode = (mode: SpeechProviderMode) => {
    form.setFieldValue("ttsMode", mode);
    if (mode !== "alibaba-model-studio") return;
    const endpoint = toAlibabaWebSocketEndpoint(form.state.values.ttsEndpoint);
    if (endpoint !== form.state.values.ttsEndpoint) {
      form.setFieldValue("ttsEndpoint", endpoint);
    }
    if (!form.state.values.ttsDeployment) {
      form.setFieldValue("ttsDeployment", "qwen-audio-3.0-tts-plus");
    }
    if (!form.state.values.ttsVoice || form.state.values.ttsVoice === "coral") {
      form.setFieldValue("ttsVoice", "longanlingxin");
    }
  };

  return {
    form,
    configuration: configuration.data,
    message,
    error,
    testing: testConnection.isPending,
    test,
    selectSttMode,
    selectTtsMode
  };
}

function toFormValues(configuration: SpeechConfiguration): SpeechFormValues {
  return {
    sttMode: configuration.sttMode,
    ttsMode: configuration.ttsMode,
    sttEndpoint: configuration.sttEndpoint,
    sttDeployment: configuration.sttDeployment,
    sttApiVersion: configuration.sttApiVersion,
    sttLanguage: configuration.sttLanguage,
    sttApiKey: "",
    ttsEndpoint: configuration.ttsEndpoint,
    ttsDeployment: configuration.ttsDeployment,
    ttsApiVersion: configuration.ttsApiVersion,
    ttsVoice: configuration.ttsVoice,
    ttsInstructions: configuration.ttsInstructions,
    ttsApiKey: ""
  };
}

function toAlibabaWebSocketEndpoint(value: string): string {
  try {
    const endpoint = new URL(value);
    const isAlibabaHost =
      endpoint.hostname.endsWith(".cn-beijing.maas.aliyuncs.com") ||
      endpoint.hostname.endsWith(".ap-southeast-1.maas.aliyuncs.com");
    if (!isAlibabaHost) return value;
    endpoint.protocol = "wss:";
    endpoint.pathname = "/api-ws/v1/inference";
    endpoint.search = "";
    endpoint.hash = "";
    return endpoint.toString();
  } catch {
    return value;
  }
}
