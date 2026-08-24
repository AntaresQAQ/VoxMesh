import type { ModelDeploymentSummary } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

export function ModelSelect(props: {
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

export function StreamingModelSelect(props: {
  label: string;
  value: string | null;
  capability: "transcription" | "tool-calling" | "speech-synthesis";
  models: ModelDeploymentSummary[];
  onChange: (value: string | null) => void;
  onStreamingChange: (value: boolean) => void;
}) {
  return (
    <ModelSelect
      label={props.label}
      value={props.value}
      models={props.models.filter(
        (model) =>
          model.declaredCapabilities.includes(props.capability) &&
          model.declaredCapabilities.includes("non-streaming")
      )}
      onChange={(modelId) => {
        props.onChange(modelId);
        if (
          !props.models
            .find((model) => model.id === modelId)
            ?.declaredCapabilities.includes("streaming")
        ) {
          props.onStreamingChange(false);
        }
      }}
    />
  );
}

export function Checkbox(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  describedBy?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="checkbox-label">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        aria-describedby={props.describedBy}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}

export function supportsStreaming(
  models: ModelDeploymentSummary[],
  modelId: string | null
): boolean {
  return (
    models
      .find((model) => model.id === modelId)
      ?.declaredCapabilities.includes("streaming") ?? false
  );
}
