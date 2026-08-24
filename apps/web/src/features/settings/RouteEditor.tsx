import { useEffect, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";

import type {
  ModelDeploymentSummary,
  NormalizedRuntimeRouteInput,
  ProviderConnectionSummary,
  RuntimeRouteSummary,
  StreamingRuntimeAvailability
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { RouteAssignmentFields } from "./RouteAssignmentFields.js";
import { RouteEditorActions, RouteModeSelect } from "./RouteModeSelect.js";
import { routeEditorDefaults, routeToInput } from "./route-editor-state.js";

export function RouteEditor(props: {
  route: RuntimeRouteSummary | null;
  models: ModelDeploymentSummary[];
  connections: ProviderConnectionSummary[];
  routes: RuntimeRouteSummary[];
  streamingAvailability: StreamingRuntimeAvailability | undefined;
  pending: boolean;
  onSave: (input: NormalizedRuntimeRouteInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const form = useForm({
    defaultValues: routeEditorDefaults,
    onSubmit: async ({ value }) => {
      await props.onSave(value);
      form.reset(routeEditorDefaults);
    }
  });
  useEffect(() => {
    form.reset(props.route ? routeToInput(props.route) : routeEditorDefaults);
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
          <RouteModeSelect
            value={field.state.value}
            onChange={(mode) => {
              field.handleChange(mode);
              if (mode === "composed") {
                form.setFieldValue("nativeModelDeploymentId", null);
                form.setFieldValue("fallbackRouteId", null);
              } else {
                form.setFieldValue("sttModelDeploymentId", null);
                form.setFieldValue("chatModelDeploymentId", null);
                form.setFieldValue("ttsModelDeploymentId", null);
                form.setFieldValue("sttStreamingEnabled", false);
                form.setFieldValue("chatStreamingEnabled", false);
                form.setFieldValue("ttsStreamingEnabled", false);
              }
            }}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <RouteAssignmentFields
            values={values}
            models={props.models}
            connections={props.connections}
            routes={props.routes}
            streamingAvailability={props.streamingAvailability}
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
            onChatStreamingChange={(value) =>
              form.setFieldValue("chatStreamingEnabled", value)
            }
            onTtsStreamingChange={(value) =>
              form.setFieldValue("ttsStreamingEnabled", value)
            }
            onFullChainStreamingChange={(value) => {
              form.setFieldValue("sttStreamingEnabled", value);
              form.setFieldValue("chatStreamingEnabled", value);
              form.setFieldValue("ttsStreamingEnabled", value);
            }}
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
      <RouteEditorActions
        editing={props.route !== null}
        pending={props.pending}
        onCancel={props.onCancel}
      />
    </form>
  );
}
