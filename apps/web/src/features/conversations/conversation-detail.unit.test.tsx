// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { ConversationDetailPage } from "./ConversationDetailPage.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search
  }: {
    children: ReactNode;
    to: string;
    search?: { conversationId: string };
  }) => (
    <a
      href={
        search
          ? `${to}?conversationId=${search.conversationId}`
          : "/conversations"
      }
    >
      {children}
    </a>
  ),
  useParams: () => ({ conversationId: "conversation-1" })
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConversationDetailPage", () => {
  it("loads a deep-linked conversation timeline", async () => {
    vi.spyOn(apiClient, "conversation").mockResolvedValue({
      id: "conversation-1",
      title: "Deep-linked conversation",
      messageCount: 1,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:01.000Z",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          runId: "11111111-1111-4111-8111-111111111111",
          content: "Loaded from route parameter",
          createdAt: "2026-08-19T00:00:01.000Z"
        }
      ],
      events: [
        {
          id: "event-1",
          runId: "11111111-1111-4111-8111-111111111111",
          correlationId: "22222222-2222-4222-8222-222222222222",
          stage: "AGENT",
          status: "completed",
          durationMs: 125,
          message: "Agent completed",
          createdAt: "2026-08-19T00:00:01.000Z"
        }
      ],
      runs: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          conversationId: "conversation-1",
          kind: "chat",
          status: "completed",
          correlationId: "22222222-2222-4222-8222-222222222222",
          inputMessageId: "message-0",
          retryOfRunId: null,
          startedAt: "2026-08-19T00:00:00.000Z",
          completedAt: "2026-08-19T00:00:01.000Z",
          durationMs: 1000,
          errorCode: null
        }
      ]
    });
    renderWithProviders(<ConversationDetailPage />);

    expect(
      await screen.findByRole("heading", { name: "Deep-linked conversation" })
    ).toBeVisible();
    expect(screen.getByText("Loaded from route parameter")).toBeVisible();
    expect(screen.getByText("Agent completed")).toBeVisible();
    expect(screen.getByText("Correlation ID")).toBeVisible();
    expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute(
      "href",
      "/conversations"
    );
    expect(
      screen.getByRole("link", { name: "Continue in Chat" })
    ).toHaveAttribute("href", "/chat?conversationId=conversation-1");
  });
});
