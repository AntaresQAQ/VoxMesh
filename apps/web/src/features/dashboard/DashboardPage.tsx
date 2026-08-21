import { useQuery } from "@tanstack/react-query";

import { Metric } from "../../components/layout/Metric.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { useI18n } from "../../i18n/i18n.js";
import {
  dashboardQueryOptions,
  deviceStatusQueryOptions
} from "../../query.js";
import { localizedError } from "../../utils/errors.js";
import { DashboardRouteOverview } from "./DashboardRouteOverview.js";
import { DeviceStatusPanel } from "./DeviceStatusPanel.js";

export function DashboardPage() {
  const { t } = useI18n();
  const dashboard = useQuery(dashboardQueryOptions());
  const deviceStatus = useQuery(deviceStatusQueryOptions());

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
      {deviceStatus.error ? (
        <p className="error" role="alert">
          {localizedError(
            deviceStatus.error,
            t,
            "dashboard.deviceStatusFailed"
          )}
        </p>
      ) : null}
      {dashboard.data ? (
        <>
          <div className="grid">
            <Metric label={t("dashboard.runtime")} value={t("common.online")} />
            <Metric
              label={t("dashboard.uptime")}
              value={t("dashboard.uptimeSeconds", {
                count: dashboard.data.uptimeSeconds
              })}
            />
            <Metric
              label={t("dashboard.conversations")}
              value={String(dashboard.data.conversationCount)}
            />
            <Metric
              label={t("dashboard.mcp")}
              value={`${dashboard.data.mcp.name} · ${t("common.connected")}`}
            />
            <Metric
              label={t("dashboard.enabledTool")}
              value={dashboard.data.mcp.enabledTools[0] ?? t("common.none")}
            />
          </div>
          <DashboardRouteOverview routing={dashboard.data.routing} />
        </>
      ) : dashboard.isError ? null : (
        <p role="status">{t("dashboard.loading")}</p>
      )}
      {deviceStatus.data ? (
        <DeviceStatusPanel status={deviceStatus.data} />
      ) : deviceStatus.isError ? null : (
        <p role="status">{t("dashboard.deviceStatusLoading")}</p>
      )}
    </PageHeader>
  );
}
