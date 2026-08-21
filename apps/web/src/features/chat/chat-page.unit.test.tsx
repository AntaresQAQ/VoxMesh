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
      expect.any(AbortSignal)
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
