import type { ConversationDetail } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

export function ChatTranscript({
  conversation,
  retryingRunId,
  onRetry
}: {
  conversation: ConversationDetail;
  retryingRunId: string | null;
  onRetry: (runId: string) => void;
}) {
  const { t } = useI18n();
  const latestRun = conversation.runs.at(-1);
  const hasActiveRun = conversation.runs.some(
    (run) => run.status === "in_progress"
  );
  const messages = conversation.messages.filter(
    (message) => message.role !== "tool"
  );

  return (
    <section
      aria-labelledby="chat-transcript-title"
      aria-live="polite"
      aria-atomic="false"
    >
      <h3 id="chat-transcript-title">{t("chat.transcript")}</h3>
      <ol className="chat-transcript">
        {messages.map((message) => (
          <li key={message.id} className={`chat-message ${message.role}`}>
            <strong>{t(`conversations.role.${message.role}`)}</strong>
            <p>{message.content}</p>
          </li>
        ))}
      </ol>
      {latestRun &&
      (latestRun.status === "failed" || latestRun.status === "cancelled") ? (
        <div className="chat-retries">
          <button
            type="button"
            className="secondary"
            disabled={hasActiveRun || retryingRunId !== null}
            onClick={() => onRetry(latestRun.id)}
          >
            {retryingRunId === latestRun.id
              ? t("chat.retrying")
              : t("chat.retry")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
