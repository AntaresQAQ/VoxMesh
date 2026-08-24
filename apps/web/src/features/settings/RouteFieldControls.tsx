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

export function Checkbox(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="checkbox-label">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}
