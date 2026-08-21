// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { renderWithProviders } from "../../test/render.js";
import { LogsPage } from "./LogsPage.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LogsPage", () => {
  it("filters logs and emits URL-backed filter changes", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "logs").mockResolvedValue([
      {
        id: "auth-log",
        category: "AUTH",
        level: "WARN",
        message: "Authentication warning",
        conversationId: null,
        createdAt: "2026-08-21T00:00:00.000Z"
      },
      {
        id: "system-log",
        category: "SYSTEM",
        level: "INFO",
        message: "System ready",
        conversationId: null,
        createdAt: "2026-08-21T00:00:01.000Z"
      }
    ]);
    const onFiltersChange = vi.fn();
    renderWithProviders(
      <LogsPage category="AUTH" onFiltersChange={onFiltersChange} />
    );

    expect(await screen.findByText("Authentication warning")).toBeVisible();
    expect(screen.queryByText("System ready")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Level"), "ERROR");
    expect(onFiltersChange).toHaveBeenCalledWith("AUTH", "ERROR");
  });

  it("shows replay gaps and refreshes the persisted snapshot", async () => {
    const user = userEvent.setup();
    const logs = vi
      .spyOn(apiClient, "logs")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const clearGap = vi.fn();
    renderWithProviders(
      <LogsPage
        realtimeState={{
          status: "connected",
          gap: {
            version: 1,
            type: "stream.gap",
            streamId: "stream-1",
            requestedAfter: 1,
            oldestAvailableSequence: 5,
            latestSequence: 8
          },
          streamRestarted: false,
          error: "",
          clearGap,
          clearStreamRestart: vi.fn()
        }}
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("5–8");
    await user.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    await waitFor(() => expect(logs).toHaveBeenCalledTimes(2));
    expect(clearGap).toHaveBeenCalledOnce();
  });

  it("keeps the replay-gap warning when snapshot recovery fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "logs")
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Snapshot unavailable"));
    const clearGap = vi.fn();
    renderWithProviders(
      <LogsPage
        realtimeState={{
          status: "connected",
          gap: {
            version: 1,
            type: "stream.gap",
            streamId: "stream-1",
            requestedAfter: 1,
            oldestAvailableSequence: 5,
            latestSequence: 8
          },
          streamRestarted: false,
          error: "",
          clearGap,
          clearStreamRestart: vi.fn()
        }}
      />
    );

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    await screen.findByText("Snapshot unavailable");
    expect(clearGap).not.toHaveBeenCalled();
  });

  it("recovers the persisted snapshot after a server stream restart", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "logs").mockResolvedValue([]);
    const clearStreamRestart = vi.fn();
    renderWithProviders(
      <LogsPage
        realtimeState={{
          status: "connected",
          gap: null,
          streamRestarted: true,
          error: "",
          clearGap: vi.fn(),
          clearStreamRestart
        }}
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "server event stream restarted"
    );
    await user.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    await waitFor(() => expect(clearStreamRestart).toHaveBeenCalledOnce());
  });
});
