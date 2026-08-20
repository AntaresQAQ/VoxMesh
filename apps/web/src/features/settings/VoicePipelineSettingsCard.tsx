import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { VoicePipelineMode } from "@voxmesh/shared";

import { apiClient } from "../../api.js";
import { useI18n } from "../../i18n/i18n.js";
import { queryKeys, voicePipelineQueryOptions } from "../../query.js";
import { localizedError } from "../../utils/errors.js";
import { ProviderSelect } from "./ProviderSelect.js";

export function VoicePipelineSettingsCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const pipeline = useQuery(voicePipelineQueryOptions());
  const [message, setMessage] = useState("");
  const save = useMutation({
    mutationFn: apiClient.updateVoicePipelineConfiguration,
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.voicePipeline, updated);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runtimeRouting
      });
      setMessage(t("settings.voicePipelineSaved"));
    }
  });
  const mode = pipeline.data?.mode ?? "composed";
  const nativeProviderId = pipeline.data?.nativeProviderId ?? "mock-native";

  const update = (input: {
    mode: VoicePipelineMode;
    nativeProviderId: string;
  }) => {
    setMessage("");
    save.mutate(input);
  };

  return (
    <section className="settings-card">
      <h3>{t("settings.voicePipelineTitle")}</h3>
      <p className="muted">{t("settings.voicePipelineDescription")}</p>
      <label>
        {t("settings.voicePipelineMode")}
        <select
          aria-label={t("settings.voicePipelineMode")}
          value={mode}
          onChange={(event) =>
            update({
              mode: event.target.value as VoicePipelineMode,
              nativeProviderId
            })
          }
        >
          <option value="composed">{t("settings.voiceModeComposed")}</option>
          <option value="native-multimodal">
            {t("settings.voiceModeNative")}
          </option>
        </select>
      </label>
      {mode === "native-multimodal" ? (
        <ProviderSelect
          capability="native-multimodal"
          label={t("settings.nativeVoiceProvider")}
          value={nativeProviderId}
          onChange={(value) =>
            update({ mode: "native-multimodal", nativeProviderId: value })
          }
        />
      ) : (
        <p className="muted">{t("settings.composedVoiceDescription")}</p>
      )}
      {message ? (
        <p className="success" role="status">
          {message}
        </p>
      ) : null}
      {save.error ? (
        <p className="error" role="alert">
          {localizedError(save.error, t, "settings.saveFailed")}
        </p>
      ) : null}
    </section>
  );
}
