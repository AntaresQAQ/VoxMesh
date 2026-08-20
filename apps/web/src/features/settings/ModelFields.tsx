import type {
  ModelDeploymentInput,
  ProviderConnectionSummary
} from "@voxmesh/shared";
import type { ModelCapability } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { CapabilityMultiSelect } from "./CapabilityMultiSelect.js";

export interface ModelEditorValues extends Omit<
  ModelDeploymentInput,
  "providerOptions"
> {
  providerOptionsJson: string;
}

export const modelEditorDefaults: ModelEditorValues = {
  connectionId: "",
  displayName: "",
  modelName: "",
  apiVersion: "",
  providerOptionsJson: "{}",
  declaredCapabilities: [],
  enabled: true
};

export function ModelFields(props: {
  values: ModelEditorValues;
  connections: ProviderConnectionSummary[];
  onChange: {
    connectionId: (value: string) => void;
    displayName: (value: string) => void;
    modelName: (value: string) => void;
    apiVersion: (value: string) => void;
    capabilities: (value: ModelCapability[]) => void;
    providerOptionsJson: (value: string) => void;
    enabled: (value: boolean) => void;
  };
}) {
  const { t } = useI18n();
  return (
    <>
      <label>
        {t("settings.connection")}
        <select
          required
          value={props.values.connectionId}
          onChange={(event) => props.onChange.connectionId(event.target.value)}
        >
          <option value="">{t("settings.selectConnection")}</option>
          {props.connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.displayName}
            </option>
          ))}
        </select>
      </label>
      <TextInput
        label={t("settings.displayName")}
        value={props.values.displayName}
        required
        onChange={props.onChange.displayName}
      />
      <TextInput
        label={t("settings.model")}
        value={props.values.modelName}
        required
        onChange={props.onChange.modelName}
      />
      <TextInput
        label={t("settings.apiVersion")}
        value={props.values.apiVersion}
        onChange={props.onChange.apiVersion}
      />
      <CapabilityMultiSelect
        value={props.values.declaredCapabilities}
        onChange={props.onChange.capabilities}
      />
      <label>
        {t("settings.providerOptions")}
        <textarea
          value={props.values.providerOptionsJson}
          onChange={(event) =>
            props.onChange.providerOptionsJson(event.target.value)
          }
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={props.values.enabled}
          onChange={(event) => props.onChange.enabled(event.target.checked)}
        />
        {t("settings.enabled")}
      </label>
    </>
  );
}

function TextInput(props: {
  label: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <input
        required={props.required}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}
