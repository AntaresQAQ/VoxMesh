// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../api.js";
import { renderWithProviders } from "../test/render.js";
import { ChatPage } from "./chat/ChatPage.js";
import { ConversationsPage } from "./conversations/ConversationsPage.js";
import { DashboardPage } from "./dashboard/DashboardPage.js";
import { LogsPage } from "./logs/LogsPage.js";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: {
    children: ReactNode;
    params: { conversationId: string };
  }) => (
    <a href={`/conversations/${props.params.conversationId}`}>
      {props.children}
    </a>
  )
}));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("feature pages", () => {
  it("renders dashboard provider and tool status", async () => {
    vi.spyOn(apiClient, "dashboard").mockResolvedValue({
      status: "online",
      mode: "mock",
      uptimeSeconds: 10,
      conversationCount: 2,
      mcp: {
        name: "Mock MCP",
        status: "connected",
        enabledTools: ["mock.get_device_status"]
      },
      providers: {
        llm: "openai-compatible",
        stt: "alibaba-model-studio",
        tts: "alibaba-model-studio"
      }
    });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("mock.get_device_status")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
    expect(screen.getByText("OpenAI-compatible")).toBeVisible();
    expect(screen.getAllByText("Alibaba Cloud Model Studio")).toHaveLength(2);
  });

  it("submits chat and renders tool-assisted output", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "chat").mockResolvedValue({
      conversationId: "conversation-1",
      response: "The light is on.",
      usedTools: ["mock.get_device_status"]
    });
    renderWithProviders(<ChatPage />);

    await user.type(screen.getByLabelText("Message"), "Check the light");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("The light is on.")).toBeVisible();
    expect(screen.getByText("Tools: mock.get_device_status")).toBeVisible();
  });

  it("loads conversations with stable detail links", async () => {
    vi.spyOn(apiClient, "conversations").mockResolvedValue([
      {
        id: "conversation-1",
        title: "Test conversation",
        messageCount: 2,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:01.000Z"
      }
    ]);
    renderWithProviders(<ConversationsPage />);

    const link = await screen.findByRole("link", {
      name: /Test conversation/
    });
    expect(link).toHaveAttribute("href", "/conversations/conversation-1");
  });

  it("renders localized structured log metadata", async () => {
    vi.spyOn(apiClient, "logs").mockResolvedValue([
      {
        id: "log-1",
        category: "AUTH",
        level: "WARN",
        message: "Test log message",
        conversationId: null,
        createdAt: "2026-08-19T00:00:00.000Z"
      }
    ]);
    renderWithProviders(<LogsPage />);

    expect(await screen.findByText("Test log message")).toBeVisible();
    expect(screen.getByText("Authentication")).toBeVisible();
    expect(screen.getByText("Warning")).toBeVisible();
    await waitFor(() => expect(apiClient.logs).toHaveBeenCalledOnce());
  });
});
