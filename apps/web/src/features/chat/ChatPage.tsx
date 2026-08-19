import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../../api.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { useI18n } from "../../i18n/i18n.js";
import { queryKeys } from "../../query.js";
import { localizedError } from "../../utils/errors.js";

export function ChatPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const chat = useMutation({
    mutationFn: apiClient.chat,
    onSuccess: async (result) => {
      setResponse(result.response);
      setTools(result.usedTools);
      setMessage("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.logs })
      ]);
    }
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    chat.mutate(message);
  };

  return (
    <PageHeader title={t("nav.chat")} description={t("chat.description")}>
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
      </form>
      {chat.error ? (
        <p className="error" role="alert">
          {localizedError(chat.error, t, "chat.failed")}
        </p>
      ) : null}
      {response ? (
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
    </PageHeader>
  );
}
