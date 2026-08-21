import type { PipelineEvent } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

export function PipelineTimeline({ events }: { events: PipelineEvent[] }) {
  const { t, formatTime } = useI18n();
  if (events.length === 0) return null;

  return (
    <section aria-labelledby="pipeline-title">
      <h3 id="pipeline-title">{t("conversations.pipeline")}</h3>
      <ol className="pipeline">
        {events.map((event) => (
          <li key={event.id}>
            <div>
              <strong>{t(`conversations.stage.${event.stage}`)}</strong>
              <span>{formatTime(event.createdAt)}</span>
            </div>
            <p>{event.message}</p>
            {event.correlationId ? (
              <span className="muted">
                {t("conversations.correlationId")}: {event.correlationId}
              </span>
            ) : null}
            {event.durationMs !== null ? (
              <span className="muted">
                {t("conversations.durationMs", {
                  duration: event.durationMs
                })}
              </span>
            ) : null}
            <span className={`pipeline-status ${event.status}`}>
              {t(`conversations.status.${event.status}`)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
