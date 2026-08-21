// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render.js";
import { ConversationRunList } from "./ConversationRunList.js";

describe("ConversationRunList", () => {
  it("renders cancelled run correlation, duration, and error metadata", () => {
    renderWithProviders(
      <ConversationRunList
        runs={[
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
        ]}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Conversation runs" })
    ).toBeVisible();
    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(
      screen.getByText("22222222-2222-4222-8222-222222222222")
    ).toBeVisible();
    expect(screen.getByText("1000 ms")).toBeVisible();
    expect(screen.getByText("RUN_CANCELLED")).toBeVisible();
  });
});
