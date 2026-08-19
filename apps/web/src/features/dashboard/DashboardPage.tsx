import { useQuery } from "@tanstack/react-query";

import type { Dashboard } from "@voxmesh/shared";

import { Metric } from "../../components/layout/Metric.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { useI18n } from "../../i18n/i18n.js";
import { dashboardQueryOptions } from "../../query.js";
import { localizedError } from "../../utils/errors.js";

export function DashboardPage() {
  const { t } = useI18n();
  const dashboard = useQuery(dashboardQueryOptions());

  return (
    <PageHeader
      title={t("nav.dashboard")}
      description={t("dashboard.description")}
    >
      {dashboard.error ? (
        <p className="error" role="alert">
          {localizedError(dashboard.error, t, "common.requestFailed")}
        </p>
      ) : null}
      {dashboard.data ? (
        <div className="grid">
          <Metric label={t("dashboard.runtime")} value={t("common.online")} />
          <Metric label={t("dashboard.mode")} value={t("common.mockMode")} />
          <Metric
            label={t("dashboard.conversations")}
            value={String(dashboard.data.conversationCount)}
          />
          <Metric label={t("dashboard.mcp")} value={t("common.connected")} />
          <Metric
            label={t("dashboard.llm")}
            value={providerLabel(dashboard.data.providers.llm, t)}
          />
          <Metric
            label={t("dashboard.stt")}
            value={providerLabel(dashboard.data.providers.stt, t)}
          />
          <Metric
            label={t("dashboard.tts")}
            value={providerLabel(dashboard.data.providers.tts, t)}
          />
          <Metric
            label={t("dashboard.enabledTool")}
            value={dashboard.data.mcp.enabledTools[0] ?? t("common.none")}
          />
        </div>
      ) : (
        <p role="status">{t("dashboard.loading")}</p>
      )}
    </PageHeader>
  );
}

function providerLabel(
  provider: Dashboard["providers"][keyof Dashboard["providers"]],
  t: ReturnType<typeof useI18n>["t"]
): string {
  switch (provider) {
    case "mock":
      return t("common.mock");
    case "azure-openai":
      return t("common.azureOpenAI");
    case "openai-compatible":
      return t("common.openAiCompatible");
    case "alibaba-model-studio":
      return t("common.alibabaModelStudio");
  }
}
