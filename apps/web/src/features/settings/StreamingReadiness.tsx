import type {
  ModelDeploymentSummary,
  ProviderConnectionSummary,
  StreamingRuntimeAvailability
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

export function StreamingReadiness(props: {
  streamingRole: "stt" | "chat" | "tts";
  modelId: string | null;
  models: ModelDeploymentSummary[];
  connections: ProviderConnectionSummary[];
  availability: StreamingRuntimeAvailability | undefined;
  id?: string;
  roleLabel?: string;
}) {
  const { t } = useI18n();
  const model = props.models.find((entry) => entry.id === props.modelId);
  const connection = props.connections.find(
    (entry) => entry.id === model?.connectionId
  );
  const providerIds =
    props.streamingRole === "stt"
      ? props.availability?.sttProviderIds
      : props.streamingRole === "chat"
        ? props.availability?.chatProviderIds
        : props.availability?.ttsProviderIds;
  const state = (value: boolean) =>
    value ? t("settings.available") : t("settings.unavailable");
  const readinessText = t("settings.streamingReadiness", {
    declared: state(model?.declaredCapabilities.includes("streaming") ?? false),
    verified: state(
      model?.verifiedStreamingRoles?.includes(props.streamingRole) ?? false
    ),
    adapter: state(
      Boolean(model?.enabled) &&
        Boolean(connection?.enabled) &&
        Boolean(
          connection && (providerIds?.includes(connection.providerId) ?? false)
        )
    ),
    transport: state(props.availability?.transportAvailable ?? false),
    browser: state(props.availability?.browserClientAvailable ?? false)
  });

  return (
    <p
      className="muted routing-streaming-readiness"
      id={props.id}
      role="status"
      aria-live="polite"
      aria-label={
        props.roleLabel
          ? t("settings.streamingReadinessLabel", {
              role: props.roleLabel,
              readiness: readinessText
            })
          : undefined
      }
    >
      {readinessText}
    </p>
  );
}
