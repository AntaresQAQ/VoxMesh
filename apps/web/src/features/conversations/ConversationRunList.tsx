import type { ConversationRun } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

export function ConversationRunList({ runs }: { runs: ConversationRun[] }) {
  const { t, formatTime } = useI18n();
  if (runs.length === 0) return null;

  return (
    <section aria-labelledby="conversation-runs-title">
      <h3 id="conversation-runs-title">{t("conversations.runs")}</h3>
      <ol className="conversation-runs">
        {runs.map((run) => (
          <li key={run.id}>
            <div>
              <strong>{t(`conversations.runKind.${run.kind}`)}</strong>
              <span className={`pipeline-status ${run.status}`}>
                {t(`conversations.runStatus.${run.status}`)}
              </span>
            </div>
            <dl>
              <dt>{t("conversations.correlationId")}</dt>
              <dd>{run.correlationId}</dd>
              <dt>{t("conversations.startedAt")}</dt>
              <dd>{formatTime(run.startedAt)}</dd>
              <dt>{t("conversations.completedAt")}</dt>
              <dd>
                {run.completedAt
                  ? formatTime(run.completedAt)
                  : t("common.none")}
              </dd>
              <dt>{t("conversations.duration")}</dt>
              <dd>
                {run.durationMs === null
                  ? t("common.none")
                  : t("conversations.durationMs", {
                      duration: run.durationMs
                    })}
              </dd>
              {run.errorCode ? (
                <>
                  <dt>{t("conversations.errorCode")}</dt>
                  <dd>{run.errorCode}</dd>
                </>
              ) : null}
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
