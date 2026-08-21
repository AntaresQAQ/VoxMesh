import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../../api.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { useI18n } from "../../i18n/i18n.js";
import { conversationQueryOptions, queryKeys } from "../../query.js";
import { localizedError } from "../../utils/errors.js";
import { ChatTranscript } from "./ChatTranscript.js";
import { VoiceControls } from "./VoiceControls.js";

type ChatMutationInput =
  | {
      kind: "message";
      runId: string;
      message: string;
      signal: AbortSignal;
    }
  | {
      kind: "retry";
      runId: string;
      retryOfRunId: string;
      signal: AbortSignal;
    };

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
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [runStatus, setRunStatus] = useState<
    "idle" | "running" | "cancelling" | "cancelled" | "completed-before-cancel"
  >("idle");
  const [runError, setRunError] = useState("");
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const activeRunId = useRef<string | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const conversation = useQuery({
    ...conversationQueryOptions(conversationId ?? ""),
    enabled: conversationId !== null
  });
  const chat = useMutation({
    mutationFn: (input: ChatMutationInput) =>
      input.kind === "message"
        ? apiClient.chat(
            input.runId,
            input.message,
            input.signal,
            conversationId ?? undefined
          )
        : apiClient.retryChatRun(input.retryOfRunId, input.runId, input.signal),
    onSuccess: async (result) => {
      setResponse(result.response);
      setTools(result.usedTools);
      setMessage("");
      setRunStatus("idle");
      activeRunId.current = null;
      await onConversationChange?.(result.conversationId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversation(result.conversationId)
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.logs })
      ]);
    },
    onError: (error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setRunStatus("idle");
      activeRunId.current = null;
    },
    onSettled: () => {
      activeController.current = null;
      setRetryingRunId(null);
    }
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!globalThis.crypto?.randomUUID) {
      setRunError(t("chat.runIdUnavailable"));
      return;
    }
    const runId = globalThis.crypto.randomUUID();
    const controller = new AbortController();
    activeRunId.current = runId;
    activeController.current = controller;
    setRunError("");
    setRunStatus("running");
    chat.mutate({
      kind: "message",
      runId,
      message,
      signal: controller.signal
    });
  };
  const retry = (retryOfRunId: string) => {
    if (!globalThis.crypto?.randomUUID) {
      setRunError(t("chat.runIdUnavailable"));
      return;
    }
    const runId = globalThis.crypto.randomUUID();
    const controller = new AbortController();
    activeRunId.current = runId;
    activeController.current = controller;
    setRetryingRunId(retryOfRunId);
    setRunError("");
    setRunStatus("running");
    chat.mutate({
      kind: "retry",
      runId,
      retryOfRunId,
      signal: controller.signal
    });
  };
  const cancel = async () => {
    const runId = activeRunId.current;
    if (!runId) return;
    setRunError("");
    setRunStatus("cancelling");
    try {
      const run = await apiClient.cancelChatRun(runId);
      if (run.status === "cancelled") {
        activeController.current?.abort();
        chat.reset();
        setRunStatus("cancelled");
      } else {
        setRunStatus("completed-before-cancel");
      }
      activeRunId.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversation(run.conversationId)
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.logs })
      ]);
    } catch (error) {
      setRunStatus("running");
      setRunError(localizedError(error, t, "chat.cancelFailed"));
    }
  };

  return (
    <PageHeader title={t("nav.chat")} description={t("chat.description")}>
      {conversationId ? (
        <button
          type="button"
          className="secondary"
          disabled={chat.isPending}
          onClick={() => {
            setResponse("");
            setTools([]);
            setRunError("");
            void onConversationChange?.(null);
          }}
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
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t("chat.placeholder")}
          />
        </label>
        <button disabled={chat.isPending}>
          {chat.isPending ? t("chat.sending") : t("chat.send")}
        </button>
        {chat.isPending ? (
          <button
            type="button"
            className="secondary"
            disabled={runStatus === "cancelling"}
            onClick={() => void cancel()}
          >
            {runStatus === "cancelling"
              ? t("chat.cancelling")
              : t("chat.cancel")}
          </button>
        ) : null}
      </form>
      {runStatus === "running" ? (
        <p role="status">{t("chat.runInProgress")}</p>
      ) : null}
      {runStatus === "cancelling" ? (
        <p role="status">{t("chat.cancelling")}</p>
      ) : null}
      {runStatus === "cancelled" ? (
        <p role="status">{t("chat.cancelled")}</p>
      ) : null}
      {runStatus === "completed-before-cancel" ? (
        <p role="status">{t("chat.completedBeforeCancel")}</p>
      ) : null}
      {runError ? (
        <p className="error" role="alert">
          {runError}
        </p>
      ) : null}
      {chat.error && runStatus !== "cancelled" ? (
        <p className="error" role="alert">
          {localizedError(chat.error, t, "chat.failed")}
        </p>
      ) : null}
      {conversation.isError ? (
        <p className="error" role="alert">
          {localizedError(conversation.error, t, "conversations.loadingFailed")}
        </p>
      ) : null}
      {conversation.data ? (
        <ChatTranscript
          conversation={conversation.data}
          retryingRunId={retryingRunId}
          onRetry={retry}
        />
      ) : response ? (
        <section className="response" aria-live="polite">
          <p className="eyebrow">{t("chat.assistant")}</p>
          <p>{response}</p>
          {tools.length > 0 ? (
            <p className="muted">
              {t("chat.tools", { tools: tools.join(", ") })}
            </p>
          ) : null}
        </section>
      ) : null}
      <VoiceControls />
    </PageHeader>
  );
}
