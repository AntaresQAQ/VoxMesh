import { useEffect, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";

import type {
  ProviderConnectionInput,
  ProviderConnectionSummary
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

const defaults: ProviderConnectionInput = {
  providerId: "openai-compatible",
  displayName: "",
  endpoint: "",
  clearApiKey: false,
  enabled: true
};

export function ConnectionEditor(props: {
  connection: ProviderConnectionSummary | null;
  pending: boolean;
  onSave: (input: ProviderConnectionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const form = useForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      await props.onSave(normalizeConnectionInput(value));
      form.reset(defaults);
    }
  });
  useEffect(() => {
    form.reset(
      props.connection
        ? {
            providerId: props.connection.providerId,
            displayName: props.connection.displayName,
            endpoint: props.connection.endpoint,
            clearApiKey: false,
            enabled: props.connection.enabled
          }
        : defaults
    );
  }, [form, props.connection]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void form.handleSubmit();
  };

  return (
    <form className="routing-editor" onSubmit={submit}>
      <form.Field name="providerId">
        {(field) => (
          <label>
            {t("settings.provider")}
            <select
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              <option value="mock">{t("common.mock")}</option>
              <option value="mock-native">Mock Native Multimodal</option>
              <option value="azure-openai">{t("common.azureOpenAI")}</option>
              <option value="openai-compatible">
                {t("common.openAiCompatible")}
              </option>
              <option value="alibaba-model-studio">
                {t("common.alibabaModelStudio")}
              </option>
            </select>
          </label>
        )}
      </form.Field>
      <form.Field name="displayName">
        {(field) => (
          <label>
            {t("settings.displayName")}
            <input
              required
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>
      <form.Field name="endpoint">
        {(field) => (
          <label>
            {t("settings.endpoint")}
            <input
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>
      <form.Field name="apiKey">
        {(field) => (
          <label>
            {t("settings.apiKey")}
            <input
              type="password"
              value={field.state.value ?? ""}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>
      <form.Field name="clearApiKey">
        {(field) => (
          <Checkbox
            label={t("settings.clearApiKey")}
            checked={field.state.value ?? false}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Field name="enabled">
        {(field) => (
          <Checkbox
            label={t("settings.enabled")}
            checked={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <div className="button-row">
        <button disabled={props.pending}>
          {props.connection ? t("settings.saveChanges") : t("settings.create")}
        </button>
        <button type="button" className="secondary" onClick={props.onCancel}>
          {t("settings.cancel")}
        </button>
      </div>
    </form>
  );
}

function normalizeConnectionInput(
  value: ProviderConnectionInput
): ProviderConnectionInput {
  const { apiKey, ...input } = value;
  if (!value.clearApiKey && apiKey?.trim()) {
    return { ...input, apiKey };
  }
  return input;
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
