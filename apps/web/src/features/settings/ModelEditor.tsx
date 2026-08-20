import { useEffect, useState, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";

import type {
  ModelDeploymentInput,
  ModelDeploymentSummary,
  ProviderConnectionSummary
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import {
  ModelFields,
  modelEditorDefaults,
  type ModelEditorValues
} from "./ModelFields.js";

export function ModelEditor(props: {
  model: ModelDeploymentSummary | null;
  connections: ProviderConnectionSummary[];
  pending: boolean;
  onSave: (input: ModelDeploymentInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [jsonError, setJsonError] = useState("");
  const form = useForm({
    defaultValues: modelEditorDefaults,
    onSubmit: async ({ value }) => {
      try {
        await props.onSave(toModelInput(value));
        setJsonError("");
        form.reset(modelEditorDefaults);
      } catch (error) {
        if (error instanceof SyntaxError) {
          setJsonError(t("settings.invalidProviderOptions"));
          return;
        }
        throw error;
      }
    }
  });
  useEffect(() => {
    form.reset(props.model ? modelToValues(props.model) : modelEditorDefaults);
  }, [form, props.model]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void form.handleSubmit();
  };
  return (
    <form className="routing-editor" onSubmit={submit}>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <ModelFields
            values={values}
            connections={props.connections}
            onChange={{
              connectionId: (value) =>
                form.setFieldValue("connectionId", value),
              displayName: (value) => form.setFieldValue("displayName", value),
              modelName: (value) => form.setFieldValue("modelName", value),
              apiVersion: (value) => form.setFieldValue("apiVersion", value),
              capabilities: (value) =>
                form.setFieldValue("declaredCapabilities", value),
              providerOptionsJson: (value) =>
                form.setFieldValue("providerOptionsJson", value),
              enabled: (value) => form.setFieldValue("enabled", value)
            }}
          />
        )}
      </form.Subscribe>
      {jsonError ? (
        <p className="error" role="alert">
          {jsonError}
        </p>
      ) : null}
      <div className="button-row">
        <button disabled={props.pending}>
          {props.model ? t("settings.saveChanges") : t("settings.create")}
        </button>
        <button type="button" className="secondary" onClick={props.onCancel}>
          {t("settings.cancel")}
        </button>
      </div>
    </form>
  );
}

function toModelInput(value: ModelEditorValues): ModelDeploymentInput {
  const parsed: unknown = JSON.parse(value.providerOptionsJson);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every(
      (entry) =>
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean"
    )
  ) {
    throw new SyntaxError("Invalid provider options");
  }
  return {
    connectionId: value.connectionId,
    displayName: value.displayName,
    modelName: value.modelName,
    apiVersion: value.apiVersion,
    providerOptions: parsed as ModelDeploymentInput["providerOptions"],
    declaredCapabilities: value.declaredCapabilities,
    enabled: value.enabled
  };
}

function modelToValues(model: ModelDeploymentSummary): ModelEditorValues {
  return {
    connectionId: model.connectionId,
    displayName: model.displayName,
    modelName: model.modelName,
    apiVersion: model.apiVersion,
    providerOptionsJson: JSON.stringify(model.providerOptions, null, 2),
    declaredCapabilities: model.declaredCapabilities,
    enabled: model.enabled
  };
}
