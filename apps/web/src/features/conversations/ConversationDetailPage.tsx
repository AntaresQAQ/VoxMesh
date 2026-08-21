import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";

import type { MessageRole } from "@voxmesh/shared";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { useI18n } from "../../i18n/i18n.js";
import { conversationQueryOptions } from "../../query.js";
import { localizedError, type Translator } from "../../utils/errors.js";
import { PipelineTimeline } from "./PipelineTimeline.js";
import { ConversationRunList } from "./ConversationRunList.js";

export function ConversationDetailPage() {
  const { t } = useI18n();
  const { conversationId } = useParams({
    from: "/_authenticated/conversations/$conversationId"
  });
  const conversation = useQuery(conversationQueryOptions(conversationId));

  return (
    <PageHeader
      title={conversation.data?.title ?? t("nav.conversations")}
      description={t("conversations.description")}
    >
      <Link className="back-link" to="/conversations">
        {t("nav.conversations")}
      </Link>
      {conversation.data ? (
        <Link
          className="back-link"
          to="/chat"
          search={{ conversationId: conversation.data.id }}
        >
          {t("conversations.continueChat")}
        </Link>
      ) : null}
      {conversation.error ? (
        <p className="error" role="alert">
          {localizedError(conversation.error, t, "conversations.loadingFailed")}
        </p>
      ) : null}
      <div className="timeline">
        {conversation.data?.messages.map((message) => (
          <article key={message.id}>
            <p className="eyebrow">{roleLabel(message.role, t)}</p>
            <p>{message.content}</p>
          </article>
        ))}
      </div>
      <ConversationRunList runs={conversation.data?.runs ?? []} />
      <PipelineTimeline events={conversation.data?.events ?? []} />
    </PageHeader>
  );
}

function roleLabel(role: MessageRole, t: Translator): string {
  switch (role) {
    case "user":
      return t("conversations.role.user");
    case "assistant":
      return t("conversations.role.assistant");
    case "tool":
      return t("conversations.role.tool");
  }
}
