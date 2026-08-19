import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { useI18n } from "../../i18n/i18n.js";
import { logsQueryOptions } from "../../query.js";
import { localizedError } from "../../utils/errors.js";

export function LogsPage() {
  const { t, formatTime } = useI18n();
  const logs = useQuery(logsQueryOptions());

  return (
    <PageHeader title={t("nav.logs")} description={t("logs.description")}>
      {logs.error ? (
        <p className="error" role="alert">
          {localizedError(logs.error, t, "common.requestFailed")}
        </p>
      ) : null}
      <div className="logs">
        {logs.data?.map((log) => (
          <article key={log.id}>
            <span>{formatTime(log.createdAt)}</span>
            <strong>{t(`logs.category.${log.category}`)}</strong>
            <span>{t(`logs.level.${log.level}`)}</span>
            <p>{log.message}</p>
          </article>
        ))}
      </div>
    </PageHeader>
  );
}
