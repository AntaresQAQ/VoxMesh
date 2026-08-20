import { useEffect, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";

import type {
  ModelDeploymentSummary,
  RuntimeRouteInput,
  RuntimeRouteSummary
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { RouteAssignmentFields } from "./RouteAssignmentFields.js";

const defaults: RuntimeRouteInput = {
  displayName: "",
  mode: "composed",
  sttModelDeploymentId: null,
  chatModelDeploymentId: null,
  ttsModelDeploymentId: null,
  nativeModelDeploymentId: null,
  fallbackRouteId: null,
  sttStreamingEnabled: false,
  ttsStreamingEnabled: false,
  enabled: true
};

export function RouteEditor(props: {
  route: RuntimeRouteSummary | null;
  models: ModelDeploymentSummary[];
  routes: RuntimeRouteSummary[];
  pending: boolean;
  onSave: (input: RuntimeRouteInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const form = useForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      await props.onSave(value);
      form.reset(defaults);
    }
  });
  useEffect(() => {
    form.reset(props.route ? routeToInput(props.route) : defaults);
  }, [form, props.route]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void form.handleSubmit();
  };
  return (
    <form className="routing-editor" onSubmit={submit}>
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
      <form.Field name="mode">
        {(field) => (
          <label>
            {t("settings.voicePipelineMode")}
            <select
              value={field.state.value}
              onChange={(event) => {
                const mode = event.target.value as RuntimeRouteInput["mode"];
                field.handleChange(mode);
                if (mode === "composed") {
                  form.setFieldValue("nativeModelDeploymentId", null);
                  form.setFieldValue("fallbackRouteId", null);
                } else {
                  form.setFieldValue("sttModelDeploymentId", null);
                  form.setFieldValue("chatModelDeploymentId", null);
                  form.setFieldValue("ttsModelDeploymentId", null);
                  form.setFieldValue("sttStreamingEnabled", false);
                  form.setFieldValue("ttsStreamingEnabled", false);
                }
              }}
            >
              <option value="composed">
                {t("settings.voiceModeComposed")}
              </option>
              <option value="native-multimodal">
                {t("settings.voiceModeNative")}
              </option>
            </select>
          </label>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <RouteAssignmentFields
            values={values}
            models={props.models}
            routes={props.routes}
            onSttModelChange={(value) =>
              form.setFieldValue("sttModelDeploymentId", value)
            }
            onChatModelChange={(value) =>
              form.setFieldValue("chatModelDeploymentId", value)
            }
            onTtsModelChange={(value) =>
              form.setFieldValue("ttsModelDeploymentId", value)
            }
            onNativeModelChange={(value) =>
              form.setFieldValue("nativeModelDeploymentId", value)
            }
            onFallbackChange={(value) =>
              form.setFieldValue("fallbackRouteId", value)
            }
            onSttStreamingChange={(value) =>
              form.setFieldValue("sttStreamingEnabled", value)
            }
            onTtsStreamingChange={(value) =>
              form.setFieldValue("ttsStreamingEnabled", value)
            }
          />
        )}
      </form.Subscribe>
      <form.Field name="enabled">
        {(field) => (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={field.state.value}
              onChange={(event) => field.handleChange(event.target.checked)}
            />
            {t("settings.enabled")}
          </label>
        )}
      </form.Field>
      <div className="button-row">
        <button disabled={props.pending}>
          {props.route ? t("settings.saveChanges") : t("settings.create")}
        </button>
        <button type="button" className="secondary" onClick={props.onCancel}>
          {t("settings.cancel")}
        </button>
      </div>
    </form>
  );
}

function routeToInput(route: RuntimeRouteSummary): RuntimeRouteInput {
  return {
    displayName: route.displayName,
    mode: route.mode,
    sttModelDeploymentId: route.sttModelDeploymentId,
    chatModelDeploymentId: route.chatModelDeploymentId,
    ttsModelDeploymentId: route.ttsModelDeploymentId,
    nativeModelDeploymentId: route.nativeModelDeploymentId,
    fallbackRouteId: route.fallbackRouteId,
    sttStreamingEnabled: route.sttStreamingEnabled,
    ttsStreamingEnabled: route.ttsStreamingEnabled,
    enabled: route.enabled
  };
}
