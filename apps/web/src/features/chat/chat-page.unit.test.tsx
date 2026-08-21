// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationRun } from "@voxmesh/shared";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { ChatPage } from "./ChatPage.js";

vi.mock("./VoiceControls.js", () => ({
  VoiceControls: () => <div>Voice controls</div>
}));

const runId = "11111111-1111-4111-8111-111111111111";

function run(status: ConversationRun["status"]): ConversationRun {
  return {
    id: runId,
    conversationId: "conversation-1",
    kind: "chat",
    status,
    correlationId: "22222222-2222-4222-8222-222222222222",
    inputMessageId: "message-1",
    retryOfRunId: null,
    startedAt: "2026-08-19T00:00:00.000Z",
    completedAt: status === "in_progress" ? null : "2026-08-19T00:00:01.000Z",
    durationMs: status === "in_progress" ? null : 1000,
    errorCode: status === "cancelled" ? "RUN_CANCELLED" : null
  };
}

function submitMessage(message = "Check the light status") {
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: message }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ChatPage", () => {
  it("generates a run ID and sends it with the Chat request", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(runId);
    const chat = vi.spyOn(apiClient, "chat").mockResolvedValue({
      runId,
      conversationId: "conversation-1",
      response: "The light is on.",
      usedTools: ["mock.get_device_status"]
    });
    renderWithProviders(<ChatPage />);

    submitMessage();

    expect(await screen.findByText("The light is on.")).toBeVisible();
    expect(chat).toHaveBeenCalledWith(
      runId,
      "Check the light status",
      expect.any(AbortSignal),
      undefined
    );
  });

  it("continues the conversation from the stable Chat URL state", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(runId);
    vi.spyOn(apiClient, "conversation").mockResolvedValue({
      id: "conversation-1",
      title: "Existing conversation",
      messageCount: 2,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:01.000Z",
      messages: [
        {
          id: "message-1",
          role: "user",
          runId,
          content: "Previous question",
          createdAt: "2026-08-19T00:00:00.000Z"
        },
        {
          id: "message-2",
          role: "assistant",
          runId,
          content: "Previous answer",
          createdAt: "2026-08-19T00:00:01.000Z"
        }
      ],
      events: [],
      runs: [run("completed")]
    });
    const chat = vi.spyOn(apiClient, "chat").mockResolvedValue({
      runId,
      conversationId: "conversation-1",
      response: "Current answer",
      usedTools: []
    });
    renderWithProviders(<ChatPage conversationId="conversation-1" />);

    expect(await screen.findByText("Previous answer")).toBeVisible();
    submitMessage("Current question");

    await waitFor(() =>
      expect(chat).toHaveBeenCalledWith(
        runId,
        "Current question",
        expect.any(AbortSignal),
        "conversation-1"
      )
    );
  });

  it("retries a cancelled run with a new client run ID", async () => {
    const retryRunId = "33333333-3333-4333-8333-333333333333";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(retryRunId);
    vi.spyOn(apiClient, "conversation").mockResolvedValue({
      id: "conversation-1",
      title: "Cancelled conversation",
      messageCount: 1,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:01.000Z",
      messages: [
        {
          id: "message-1",
          role: "user",
          runId,
          content: "Retry this",
          createdAt: "2026-08-19T00:00:00.000Z"
        }
      ],
      events: [],
      runs: [run("cancelled")]
    });
    const retry = vi.spyOn(apiClient, "retryChatRun").mockResolvedValue({
      runId: retryRunId,
      conversationId: "conversation-1",
      response: "Retry succeeded",
      usedTools: []
    });
    renderWithProviders(<ChatPage conversationId="conversation-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith(
        runId,
        retryRunId,
        expect.any(AbortSignal)
      )
    );
  });

  it("recovers the durable conversation after an initial provider failure", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(runId);
    vi.spyOn(apiClient, "chat").mockRejectedValue(
      new Error("Provider unavailable")
    );
    vi.spyOn(apiClient, "chatRun").mockResolvedValue(run("failed"));
    const onConversationChange = vi.fn();
    renderWithProviders(
      <ChatPage onConversationChange={onConversationChange} />
    );

    submitMessage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider unavailable"
    );
    await waitFor(() =>
      expect(onConversationChange).toHaveBeenCalledWith("conversation-1")
    );
  });

  it("cancels an active run and suppresses the aborted request error", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(runId);
    vi.spyOn(apiClient, "chat").mockImplementation(
      async (_runId, _message, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const cancel = vi
      .spyOn(apiClient, "cancelChatRun")
      .mockResolvedValue(run("cancelled"));
    renderWithProviders(<ChatPage />);

    submitMessage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cancel"
      })
    );

    expect(
      await screen.findByText("Conversation run cancelled.")
    ).toBeVisible();
    expect(cancel).toHaveBeenCalledWith(runId);
    expect(screen.queryByText("Chat request failed")).not.toBeInTheDocument();
  });

  it("reports when completion wins the cancellation race", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(runId);
    vi.spyOn(apiClient, "chat").mockImplementation(
      async () => new Promise(() => undefined)
    );
    vi.spyOn(apiClient, "cancelChatRun").mockResolvedValue(run("completed"));
    renderWithProviders(<ChatPage />);

    submitMessage();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(
      await screen.findByText(
        "The run completed before cancellation took effect."
      )
    ).toBeVisible();
  });

  it("clears transient cancellation state for a new conversation", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(runId);
    vi.spyOn(apiClient, "conversation").mockResolvedValue({
      id: "conversation-1",
      title: "Existing conversation",
      messageCount: 0,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
      messages: [],
      events: [],
      runs: []
    });
    vi.spyOn(apiClient, "chat").mockImplementation(
      async (_runId, _message, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    vi.spyOn(apiClient, "cancelChatRun").mockResolvedValue(run("cancelled"));
    renderWithProviders(<ChatPage conversationId="conversation-1" />);

    submitMessage();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByText("Conversation run cancelled.")
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));

    expect(
      screen.queryByText("Conversation run cancelled.")
    ).not.toBeInTheDocument();
  });

  it("keeps the active run available after cancellation fails", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(runId);
    vi.spyOn(apiClient, "chat").mockImplementation(
      async () => new Promise(() => undefined)
    );
    vi.spyOn(apiClient, "cancelChatRun").mockRejectedValue(
      new Error("Network unavailable")
    );
    renderWithProviders(<ChatPage />);

    submitMessage();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network unavailable"
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled()
    );
  });

  it("shows an actionable error when secure UUID generation is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    const chat = vi.spyOn(apiClient, "chat");
    renderWithProviders(<ChatPage />);

    submitMessage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This browser cannot create a stable conversation run identifier."
    );
    expect(chat).not.toHaveBeenCalled();
  });
});
