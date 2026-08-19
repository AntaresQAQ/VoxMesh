// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { ConversationDetailPage } from "./ConversationDetailPage.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/conversations">{children}</a>
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
          content: "Loaded from route parameter",
          createdAt: "2026-08-19T00:00:01.000Z"
        }
      ],
      events: [
        {
          id: "event-1",
          stage: "AGENT",
          status: "completed",
          message: "Agent completed",
          createdAt: "2026-08-19T00:00:01.000Z"
        }
      ]
    });
    renderWithProviders(<ConversationDetailPage />);

    expect(
      await screen.findByRole("heading", { name: "Deep-linked conversation" })
    ).toBeVisible();
    expect(screen.getByText("Loaded from route parameter")).toBeVisible();
    expect(screen.getByText("Agent completed")).toBeVisible();
    expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute(
      "href",
      "/conversations"
    );
  });
});
