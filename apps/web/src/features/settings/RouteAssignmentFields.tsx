import type {
  ModelDeploymentSummary,
  ProviderConnectionSummary,
  RuntimeRouteInput,
  RuntimeRouteSummary,
  StreamingRuntimeAvailability
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { ComposedRouteAssignmentFields } from "./ComposedRouteAssignmentFields.js";
import { ModelSelect } from "./RouteFieldControls.js";

export function RouteAssignmentFields(props: {
  values: RuntimeRouteInput;
  models: ModelDeploymentSummary[];
  connections: ProviderConnectionSummary[];
  routes: RuntimeRouteSummary[];
  streamingAvailability: StreamingRuntimeAvailability | undefined;
  onSttModelChange: (value: string | null) => void;
  onChatModelChange: (value: string | null) => void;
  onTtsModelChange: (value: string | null) => void;
  onNativeModelChange: (value: string | null) => void;
  onFallbackChange: (value: string | null) => void;
  onSttStreamingChange: (value: boolean) => void;
  onChatStreamingChange: (value: boolean) => void;
  onTtsStreamingChange: (value: boolean) => void;
  onFullChainStreamingChange: (value: boolean) => void;
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
  return <ComposedRouteAssignmentFields {...props} />;
}
