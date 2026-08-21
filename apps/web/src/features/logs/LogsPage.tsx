import { useQuery } from "@tanstack/react-query";

import type { LogEntry } from "@voxmesh/shared";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { useI18n } from "../../i18n/i18n.js";
import { logsQueryOptions } from "../../query.js";
import {
  useRealtimeEvents,
  type RealtimeEventsState
} from "../../realtime/RealtimeEventsProvider.js";
import { localizedError } from "../../utils/errors.js";

export type LogCategoryFilter = LogEntry["category"] | "ALL";
export type LogLevelFilter = LogEntry["level"] | "ALL";

const categories: LogCategoryFilter[] = [
  "ALL",
  "AGENT",
  "MCP",
  "AUTH",
  "SYSTEM",
  "ERROR"
];
const levels: LogLevelFilter[] = ["ALL", "INFO", "WARN", "ERROR"];

export function LogsPage(props: {
  category?: LogEntry["category"];
  level?: LogEntry["level"];
  onFiltersChange: (
    category: LogEntry["category"] | undefined,
    level: LogEntry["level"] | undefined
  ) => void;
  realtimeState?: RealtimeEventsState;
}) {
  const { t, formatTime } = useI18n();
  const logs = useQuery(logsQueryOptions());
  const realtimeContext = useRealtimeEvents();
  const realtime = props.realtimeState ?? realtimeContext;
  const category = props.category ?? "ALL";
  const level = props.level ?? "ALL";
  const filteredLogs = (logs.data ?? []).filter(
    (log) =>
      (category === "ALL" || log.category === category) &&
      (level === "ALL" || log.level === level)
  );
  const changeFilters = (
    nextCategory: LogCategoryFilter,
    nextLevel: LogLevelFilter
  ) =>
    props.onFiltersChange(
      nextCategory === "ALL" ? undefined : nextCategory,
      nextLevel === "ALL" ? undefined : nextLevel
    );

  return (
    <PageHeader title={t("nav.logs")} description={t("logs.description")}>
      <div className="log-toolbar">
        <label>
          {t("logs.categoryFilter")}
          <select
            value={category}
            onChange={(event) =>
              changeFilters(event.target.value as LogCategoryFilter, level)
            }
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {value === "ALL"
                  ? t("logs.filterAll")
                  : t(`logs.category.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("logs.levelFilter")}
          <select
            value={level}
            onChange={(event) =>
              changeFilters(category, event.target.value as LogLevelFilter)
            }
          >
            {levels.map((value) => (
              <option key={value} value={value}>
                {value === "ALL"
                  ? t("logs.filterAll")
                  : t(`logs.level.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <p className={`connection-status ${realtime.status}`} role="status">
          {connectionStatus(realtime.status, t)}
        </p>
      </div>
      {logs.error ? (
        <p className="error" role="alert">
          {localizedError(logs.error, t, "common.requestFailed")}
        </p>
      ) : null}
      {realtime.error ? (
        <p className="error" role="alert">
          {realtime.error}
        </p>
      ) : null}
      {realtime.gap ? (
        <div className="error log-gap" role="alert">
          <p>
            {t("logs.gap", {
              oldest: realtime.gap.oldestAvailableSequence,
              latest: realtime.gap.latestSequence
            })}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void logs.refetch().then((result) => {
                if (result.isSuccess) realtime.clearGap();
              });
            }}
          >
            {t("logs.refreshSnapshot")}
          </button>
        </div>
      ) : null}
      {realtime.streamRestarted ? (
        <div className="error log-gap" role="alert">
          <p>{t("logs.streamRestarted")}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void logs.refetch().then((result) => {
                if (result.isSuccess) realtime.clearStreamRestart();
              });
            }}
          >
            {t("logs.refreshSnapshot")}
          </button>
        </div>
      ) : null}
      <div className="logs">
        {filteredLogs.map((log) => (
          <article key={log.id}>
            <span>{formatTime(log.createdAt)}</span>
            <strong>{t(`logs.category.${log.category}`)}</strong>
            <span>{t(`logs.level.${log.level}`)}</span>
            <p>{log.message}</p>
          </article>
        ))}
        {!logs.isPending && filteredLogs.length === 0 ? (
          <p className="muted">{t("logs.empty")}</p>
        ) : null}
      </div>
    </PageHeader>
  );
}

function connectionStatus(
  status: ReturnType<typeof useRealtimeEvents>["status"],
  t: ReturnType<typeof useI18n>["t"]
): string {
  switch (status) {
    case "connecting":
      return t("logs.connecting");
    case "connected":
      return t("logs.connected");
    case "reconnecting":
      return t("logs.reconnecting");
    case "failed":
      return t("logs.connectionFailed");
    case "disconnected":
      return t("logs.disconnected");
  }
}
