import type { ModelCapability, RuntimeRoutingSummary } from "@voxmesh/shared";

import { ProviderReadinessStatus } from "../../components/ProviderReadinessStatus.js";
import { useI18n } from "../../i18n/i18n.js";

export interface DashboardAssignment {
  label: string;
  modelId: string | null;
  required: ModelCapability[];
  transport?: "buffered" | "streaming";
}

export function DashboardAssignmentCard({
  assignment,
  routing
}: {
  assignment: DashboardAssignment;
  routing: RuntimeRoutingSummary;
}) {
  const { t } = useI18n();
  const model = routing.models.find(
    (candidate) => candidate.id === assignment.modelId
  );
  const connection = model
    ? routing.connections.find(
        (candidate) => candidate.id === model.connectionId
      )
    : undefined;
  const verifiedCount = model
    ? assignment.required.filter((capability) =>
        model.verifiedCapabilities.includes(capability)
      ).length
    : 0;
  const ready =
    Boolean(model?.enabled) &&
    Boolean(connection?.enabled) &&
    verifiedCount === assignment.required.length;

  return (
    <article className="metric dashboard-assignment">
      <p className="eyebrow">{assignment.label}</p>
      <strong>{model?.displayName ?? t("dashboard.missingAssignment")}</strong>
      {model ? <p>{model.modelName}</p> : null}
      <p>
        {t("dashboard.connection")}:{" "}
        {connection?.displayName ?? t("dashboard.missingConnection")}
      </p>
      {connection ? (
        <>
          <p>
            {t("dashboard.provider")}: {providerLabel(connection.providerId, t)}
          </p>
          <ProviderReadinessStatus readiness={connection.readiness} />
        </>
      ) : null}
      {assignment.transport ? (
        <p>
          {t("dashboard.transport")}:{" "}
          {assignment.transport === "streaming"
            ? t("dashboard.streaming")
            : t("dashboard.buffered")}
        </p>
      ) : null}
      <p className={ready ? "success" : "error"}>
        {ready
          ? t("dashboard.requiredCapabilitiesVerified")
          : t("dashboard.requiredCapabilitiesIncomplete", {
              verified: verifiedCount,
              required: assignment.required.length
            })}
      </p>
    </article>
  );
}

function providerLabel(
  providerId: string,
  t: ReturnType<typeof useI18n>["t"]
): string {
  switch (providerId) {
    case "mock":
      return t("common.mock");
    case "mock-native":
      return t("dashboard.mockNative");
    case "azure-openai":
      return t("common.azureOpenAI");
    case "openai-compatible":
      return t("common.openAiCompatible");
    case "alibaba-model-studio":
      return t("common.alibabaModelStudio");
    default:
      return providerId;
  }
}
