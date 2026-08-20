import type {
  ModelDeploymentSummary,
  RuntimeRouteInput,
  RuntimeRouteSummary
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

export function RouteAssignmentFields(props: {
  values: RuntimeRouteInput;
  models: ModelDeploymentSummary[];
  routes: RuntimeRouteSummary[];
  onSttModelChange: (value: string | null) => void;
  onChatModelChange: (value: string | null) => void;
  onTtsModelChange: (value: string | null) => void;
  onNativeModelChange: (value: string | null) => void;
  onFallbackChange: (value: string | null) => void;
  onSttStreamingChange: (value: boolean) => void;
  onTtsStreamingChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  if (props.values.mode === "native-multimodal") {
    return (
      <>
        <ModelSelect
          label={t("settings.nativeVoiceProvider")}
          value={props.values.nativeModelDeploymentId}
          onChange={props.onNativeModelChange}
          models={props.models.filter((model) =>
            model.declaredCapabilities.includes("native-multimodal")
          )}
        />
        <label>
          {t("settings.fallbackRoute")}
          <select
            value={props.values.fallbackRouteId ?? ""}
            onChange={(event) =>
              props.onFallbackChange(event.target.value || null)
            }
          >
            <option value="">{t("common.none")}</option>
            {props.routes
              .filter((route) => route.mode === "composed")
              .map((route) => (
                <option key={route.id} value={route.id}>
                  {route.displayName}
                </option>
              ))}
          </select>
        </label>
      </>
    );
  }
  return (
    <>
      <ModelSelect
        label={t("settings.sttTitle")}
        value={props.values.sttModelDeploymentId}
        onChange={props.onSttModelChange}
        models={props.models.filter((model) =>
          model.declaredCapabilities.includes("transcription")
        )}
      />
      <ModelSelect
        label={t("dashboard.llm")}
        value={props.values.chatModelDeploymentId}
        onChange={props.onChatModelChange}
        models={props.models.filter((model) =>
          model.declaredCapabilities.includes("tool-calling")
        )}
      />
      <ModelSelect
        label={t("settings.ttsTitle")}
        value={props.values.ttsModelDeploymentId}
        onChange={props.onTtsModelChange}
        models={props.models.filter((model) =>
          model.declaredCapabilities.includes("speech-synthesis")
        )}
      />
      <Checkbox
        label={t("settings.enableSttStreaming")}
        checked={props.values.sttStreamingEnabled}
        onChange={props.onSttStreamingChange}
      />
      <Checkbox
        label={t("settings.enableTtsStreaming")}
        checked={props.values.ttsStreamingEnabled}
        onChange={props.onTtsStreamingChange}
      />
    </>
  );
}

function ModelSelect(props: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  models: ModelDeploymentSummary[];
}) {
  const { t } = useI18n();
  return (
    <label>
      {props.label}
      <select
        value={props.value ?? ""}
        onChange={(event) => props.onChange(event.target.value || null)}
      >
        <option value="">{t("settings.selectModel")}</option>
        {props.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

function Checkbox(props: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="checkbox-label">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}
