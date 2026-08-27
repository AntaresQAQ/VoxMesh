import type { FormEvent } from "react";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { useI18n } from "../../i18n/i18n.js";
import { localizedError } from "../../utils/errors.js";
import { ChatTranscript } from "./ChatTranscript.js";
import { useChatRunLifecycle } from "./useChatRunLifecycle.js";
import { VoiceControls } from "./VoiceControls.js";
import { StreamingVoiceControls } from "./StreamingVoiceControls.js";

export function ChatPage({
  conversationId = null,
  onConversationChange
}: {
  conversationId?: string | null;
  onConversationChange?: (
    conversationId: string | null
  ) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const lifecycle = useChatRunLifecycle({
    conversationId,
    ...(onConversationChange ? { onConversationChange } : {})
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    lifecycle.submit();
  };

  return (
    <PageHeader title={t("nav.chat")} description={t("chat.description")}>
      {conversationId ? (
        <button
          type="button"
          className="secondary"
          disabled={lifecycle.chat.isPending}
          onClick={lifecycle.startNewConversation}
        >
          {t("chat.newConversation")}
        </button>
      ) : null}
      <form className="chat-form" onSubmit={(event) => void submit(event)}>
        <label>
          {t("chat.message")}
          <textarea
            aria-label={t("chat.message")}
            required
            value={lifecycle.message}
            onChange={(event) => lifecycle.setMessage(event.target.value)}
            placeholder={t("chat.placeholder")}
          />
        </label>
        <button disabled={lifecycle.chat.isPending}>
          {lifecycle.chat.isPending ? t("chat.sending") : t("chat.send")}
        </button>
        {lifecycle.chat.isPending ? (
          <button
            type="button"
            className="secondary"
            disabled={lifecycle.runStatus === "cancelling"}
            onClick={() => void lifecycle.cancel()}
          >
            {lifecycle.runStatus === "cancelling"
              ? t("chat.cancelling")
              : t("chat.cancel")}
          </button>
        ) : null}
      </form>
      {lifecycle.runStatus === "running" ? (
        <p role="status">{t("chat.runInProgress")}</p>
      ) : null}
      {lifecycle.runStatus === "cancelling" ? (
        <p role="status">{t("chat.cancelling")}</p>
      ) : null}
      {lifecycle.runStatus === "cancelled" ? (
        <p role="status">{t("chat.cancelled")}</p>
      ) : null}
      {lifecycle.runStatus === "completed-before-cancel" ? (
        <p role="status">{t("chat.completedBeforeCancel")}</p>
      ) : null}
      {lifecycle.runError ? (
        <p className="error" role="alert">
          {lifecycle.runError}
        </p>
      ) : null}
      {lifecycle.chat.error && lifecycle.runStatus !== "cancelled" ? (
        <p className="error" role="alert">
          {localizedError(lifecycle.chat.error, t, "chat.failed")}
        </p>
      ) : null}
      {lifecycle.conversation.isError ? (
        <p className="error" role="alert">
          {localizedError(
            lifecycle.conversation.error,
            t,
            "conversations.loadingFailed"
          )}
        </p>
      ) : null}
      {lifecycle.conversation.data ? (
        <ChatTranscript
          conversation={lifecycle.conversation.data}
          retryingRunId={lifecycle.retryingRunId}
          onRetry={lifecycle.retry}
        />
      ) : lifecycle.response ? (
        <section className="response" aria-live="polite">
          <p className="eyebrow">{t("chat.assistant")}</p>
          <p>{lifecycle.response}</p>
          {lifecycle.tools.length > 0 ? (
            <p className="muted">
              {t("chat.tools", { tools: lifecycle.tools.join(", ") })}
            </p>
          ) : null}
        </section>
      ) : null}
      <VoiceControls />
      <StreamingVoiceControls />
    </PageHeader>
  );
}
