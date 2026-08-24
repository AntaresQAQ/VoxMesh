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

  return (
    <p className="muted routing-streaming-readiness">
      {t("settings.streamingReadiness", {
        declared: state(
          model?.declaredCapabilities.includes("streaming") ?? false
        ),
        verified: state(
          model?.verifiedCapabilities.includes("streaming") ?? false
        ),
        adapter: state(
          connection
            ? (providerIds?.includes(connection.providerId) ?? false)
            : false
        ),
        transport: state(props.availability?.transportAvailable ?? false),
        browser: state(props.availability?.browserClientAvailable ?? false)
      })}
    </p>
  );
}
