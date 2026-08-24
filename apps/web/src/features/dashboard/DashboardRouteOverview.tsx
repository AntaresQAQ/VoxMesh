import type { ModelCapability, RuntimeRoutingSummary } from "@voxmesh/shared";

import { Metric } from "../../components/layout/Metric.js";
import { ProviderReadinessStatus } from "../../components/ProviderReadinessStatus.js";
import { useI18n } from "../../i18n/i18n.js";
import {
  DashboardAssignmentCard,
  type DashboardAssignment
} from "./DashboardAssignmentCard.js";

export function DashboardRouteOverview({
  routing
}: {
  routing: RuntimeRoutingSummary;
}) {
  const { t } = useI18n();
  const route = routing.routes.find(
    (candidate) => candidate.id === routing.activeRouteId
  );
  if (!route) {
    return (
      <section className="dashboard-route-overview">
        <h3>{t("dashboard.activeRoute")}</h3>
        <p className="error" role="alert">
          {t("dashboard.activeRouteMissing")}
        </p>
      </section>
    );
  }

  const assignments: DashboardAssignment[] =
    route.mode === "composed"
      ? [
          {
            label: t("dashboard.stt"),
            modelId: route.sttModelDeploymentId,
            required: [
              "audio-input",
              "text-output",
              "transcription",
              "non-streaming",
              ...(route.sttStreamingEnabled
                ? (["streaming"] as ModelCapability[])
                : [])
            ],
            transport: route.sttStreamingEnabled ? "streaming" : "buffered"
          },
          {
            label: t("dashboard.llm"),
            modelId: route.chatModelDeploymentId,
            required: [
              "text-input",
              "text-output",
              "tool-calling",
              "non-streaming",
              ...(route.chatStreamingEnabled
                ? (["streaming"] as ModelCapability[])
                : [])
            ],
            transport: route.chatStreamingEnabled ? "streaming" : "buffered"
          },
          {
            label: t("dashboard.tts"),
            modelId: route.ttsModelDeploymentId,
            required: [
              "text-input",
              "audio-output",
              "speech-synthesis",
              "non-streaming",
              ...(route.ttsStreamingEnabled
                ? (["streaming"] as ModelCapability[])
                : [])
            ],
            transport: route.ttsStreamingEnabled ? "streaming" : "buffered"
          }
        ]
      : [
          {
            label: t("dashboard.nativeModel"),
            modelId: route.nativeModelDeploymentId,
            required: [
              "audio-input",
              "audio-output",
              "text-output",
              "tool-calling",
              "native-multimodal",
              "non-streaming"
            ]
          }
        ];
  const fallback = route.fallbackRouteId
    ? routing.routes.find((candidate) => candidate.id === route.fallbackRouteId)
    : undefined;

  return (
    <section className="dashboard-route-overview">
      <div className="dashboard-route-heading">
        <h3>{t("dashboard.activeRouteConfiguration")}</h3>
        <a href="/settings?section=providers">{t("dashboard.manageRouting")}</a>
      </div>
      <div className="grid">
        <Metric label={t("dashboard.activeRoute")} value={route.displayName} />
        <Metric
          label={t("dashboard.pipelineMode")}
          value={
            route.mode === "composed"
              ? t("settings.voiceModeComposed")
              : t("settings.voiceModeNative")
          }
        />
        <Metric
          label={t("dashboard.routeStatus")}
          value={route.enabled ? t("settings.enabled") : t("settings.disabled")}
        />
        {route.mode === "native-multimodal" ? (
          <Metric
            label={t("dashboard.fallbackRoute")}
            value={
              fallback?.displayName ??
              (route.fallbackRouteId
                ? t("dashboard.missingAssignment")
                : t("common.none"))
            }
          />
        ) : null}
      </div>
      <ProviderReadinessStatus readiness={route.readiness} />
      <h4>{t("dashboard.assignedModels")}</h4>
      <div className="grid">
        {assignments.map((assignment) => (
          <DashboardAssignmentCard
            key={assignment.label}
            assignment={assignment}
            routing={routing}
          />
        ))}
      </div>
    </section>
  );
}
