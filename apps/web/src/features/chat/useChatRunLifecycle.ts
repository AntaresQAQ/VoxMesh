import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../../api.js";
import { useI18n } from "../../i18n/i18n.js";
import { conversationQueryOptions, queryKeys } from "../../query.js";
import { localizedError } from "../../utils/errors.js";

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

type ChatRunStatus =
  "idle" | "running" | "cancelling" | "cancelled" | "completed-before-cancel";

/**
 * Owns Chat run identity, cancellation, retry, recovery, and query
 * invalidation so the page remains a composition layer.
 */
export function useChatRunLifecycle({
  conversationId,
  onConversationChange
}: {
  conversationId: string | null;
  onConversationChange?: (
    conversationId: string | null
  ) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [runStatus, setRunStatus] = useState<ChatRunStatus>("idle");
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
    onSuccess: async (result, _variables) => {
      setResponse(result.response);
      setTools(result.usedTools);
      setMessage("");
      setRunStatus("idle");
      await onConversationChange?.(result.conversationId);
      await invalidateChatQueries(result.conversationId);
    },
    onError: async (error, variables) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setRunStatus("idle");
      const recoveredConversationId = await recoverConversationId(
        variables.runId
      );
      if (recoveredConversationId) {
        await onConversationChange?.(recoveredConversationId);
        await invalidateChatQueries(recoveredConversationId);
      } else if (conversationId) {
        await invalidateChatQueries(conversationId);
      }
    },
    onSettled: (_result, _error, variables) => {
      if (activeController.current?.signal === variables.signal) {
        activeRunId.current = null;
        activeController.current = null;
        setRetryingRunId(null);
      }
    }
  });

  async function invalidateChatQueries(currentConversationId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(currentConversationId)
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.logs })
    ]);
  }

  async function recoverConversationId(runId: string): Promise<string | null> {
    try {
      return (await apiClient.chatRun(runId)).conversationId;
    } catch {
      return null;
    }
  }

  function createRun(): { runId: string; controller: AbortController } | null {
    if (!globalThis.crypto?.randomUUID) {
      setRunError(t("chat.runIdUnavailable"));
      return null;
    }
    const runId = globalThis.crypto.randomUUID();
    const controller = new AbortController();
    activeRunId.current = runId;
    activeController.current = controller;
    setRunError("");
    setRunStatus("running");
    return { runId, controller };
  }

  function submit() {
    const active = createRun();
    if (!active) return;
    chat.mutate({
      kind: "message",
      runId: active.runId,
      message,
      signal: active.controller.signal
    });
  }

  function retry(retryOfRunId: string) {
    const active = createRun();
    if (!active) return;
    setRetryingRunId(retryOfRunId);
    chat.mutate({
      kind: "retry",
      runId: active.runId,
      retryOfRunId,
      signal: active.controller.signal
    });
  }

  async function cancel() {
    const runId = activeRunId.current;
    if (!runId) return;
    setRunError("");
    setRunStatus("cancelling");
    try {
      const run = await apiClient.cancelChatRun(runId);
      if (run.status === "cancelled") {
        activeController.current?.abort();
        setRunStatus("cancelled");
      } else {
        setRunStatus("completed-before-cancel");
      }
      await onConversationChange?.(run.conversationId);
      await invalidateChatQueries(run.conversationId);
    } catch (error) {
      setRunStatus("running");
      setRunError(localizedError(error, t, "chat.cancelFailed"));
    }
  }

  function startNewConversation() {
    setResponse("");
    setTools([]);
    setRunError("");
    setRunStatus("idle");
    setRetryingRunId(null);
    void onConversationChange?.(null);
  }

  return {
    cancel,
    chat,
    conversation,
    message,
    response,
    retry,
    retryingRunId,
    runError,
    runStatus,
    setMessage,
    startNewConversation,
    submit,
    tools
  };
}
