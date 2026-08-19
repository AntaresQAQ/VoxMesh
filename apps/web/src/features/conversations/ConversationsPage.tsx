import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { useI18n } from "../../i18n/i18n.js";
import { conversationsQueryOptions } from "../../query.js";
import { localizedError } from "../../utils/errors.js";

export function ConversationsPage() {
  const { t } = useI18n();
  const conversations = useQuery(conversationsQueryOptions());

  return (
    <PageHeader
      title={t("nav.conversations")}
      description={t("conversations.description")}
    >
      {conversations.error ? (
        <p className="error" role="alert">
          {localizedError(
            conversations.error,
            t,
            "conversations.loadingFailed"
          )}
        </p>
      ) : null}
      <div className="list">
        {conversations.data?.length === 0 ? (
          <p className="muted">{t("conversations.empty")}</p>
        ) : null}
        {conversations.data?.map((conversation) => (
          <Link
            key={conversation.id}
            className="list-link"
            to="/conversations/$conversationId"
            params={{ conversationId: conversation.id }}
          >
            <strong>{conversation.title}</strong>
            <span>
              {t("conversations.count", {
                count: conversation.messageCount
              })}
            </span>
          </Link>
        ))}
      </div>
    </PageHeader>
  );
}
