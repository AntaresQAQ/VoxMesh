// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render.js";
import { ChatTranscript } from "./ChatTranscript.js";

describe("ChatTranscript", () => {
  it("shows durable messages and exposes retry for a cancelled run", () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <ChatTranscript
        conversation={{
          id: "conversation-1",
          title: "Conversation",
          messageCount: 3,
          createdAt: "2026-08-19T00:00:00.000Z",
          updatedAt: "2026-08-19T00:00:01.000Z",
          messages: [
            {
              id: "message-1",
              role: "user",
              runId: "11111111-1111-4111-8111-111111111111",
              content: "Question",
              createdAt: "2026-08-19T00:00:00.000Z"
            },
            {
              id: "message-2",
              role: "tool",
              runId: "11111111-1111-4111-8111-111111111111",
              content: "Internal tool result",
              createdAt: "2026-08-19T00:00:00.500Z"
            }
          ],
          events: [],
          runs: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              conversationId: "conversation-1",
              kind: "chat",
              status: "cancelled",
              correlationId: "22222222-2222-4222-8222-222222222222",
              inputMessageId: "message-1",
              retryOfRunId: null,
              startedAt: "2026-08-19T00:00:00.000Z",
              completedAt: "2026-08-19T00:00:01.000Z",
              durationMs: 1000,
              errorCode: "RUN_CANCELLED"
            }
          ]
        }}
        retryingRunId={null}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText("Question")).toBeVisible();
    expect(screen.queryByText("Internal tool result")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("does not expose an older failed attempt after a later run", () => {
    renderWithProviders(
      <ChatTranscript
        conversation={{
          id: "conversation-1",
          title: "Conversation",
          messageCount: 2,
          createdAt: "2026-08-19T00:00:00.000Z",
          updatedAt: "2026-08-19T00:00:02.000Z",
          messages: [],
          events: [],
          runs: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              conversationId: "conversation-1",
              kind: "chat",
              status: "failed",
              correlationId: "22222222-2222-4222-8222-222222222222",
              inputMessageId: "message-1",
              retryOfRunId: null,
              startedAt: "2026-08-19T00:00:00.000Z",
              completedAt: "2026-08-19T00:00:01.000Z",
              durationMs: 1000,
              errorCode: "AGENT_FAILED"
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              conversationId: "conversation-1",
              kind: "chat",
              status: "completed",
              correlationId: "44444444-4444-4444-8444-444444444444",
              inputMessageId: "message-2",
              retryOfRunId: null,
              startedAt: "2026-08-19T00:00:01.000Z",
              completedAt: "2026-08-19T00:00:02.000Z",
              durationMs: 1000,
              errorCode: null
            }
          ]
        }}
        retryingRunId={null}
        onRetry={() => undefined}
      />
    );

    expect(
      screen.queryByRole("button", { name: "Retry" })
    ).not.toBeInTheDocument();
  });
});
