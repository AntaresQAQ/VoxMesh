// @vitest-environment jsdom

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelCapability } from "@voxmesh/shared";

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
    vi.spyOn(apiClient, "deviceStatus").mockResolvedValue({
      device: {
        status: "unavailable",
        displayName: null,
        detailCode: "adapter-not-configured",
        observedAt: null
      },
      audio: {
        input: {
          status: "unavailable",
          displayName: null,
          detailCode: "adapter-not-configured",
          observedAt: null
        },
        output: {
          status: "unavailable",
          displayName: null,
          detailCode: "adapter-not-configured",
          observedAt: null
        }
      },
      system: {
        cpuUsage: {
          status: "unavailable",
          value: null,
          unit: "percent",
          detailCode: "adapter-not-configured",
          observedAt: null
        },
        memoryUsage: {
          status: "unavailable",
          value: null,
          unit: "bytes",
          detailCode: "adapter-not-configured",
          observedAt: null
        },
        temperature: {
          status: "unavailable",
          value: null,
          unit: "celsius",
          detailCode: "adapter-not-configured",
          observedAt: null
        }
      }
    });

    vi.spyOn(apiClient, "dashboard").mockResolvedValue({
      status: "online",
      uptimeSeconds: 10,
      conversationCount: 2,
      mcp: {
        name: "Mock MCP",
        status: "connected",
        enabledTools: ["mock.get_device_status"]
      },
      routing: {
        connections: [
          {
            id: "connection-chat",
            providerId: "openai-compatible",
            displayName: "Alibaba Chat",
            endpoint: "https://example.com/v1",
            apiKeyConfigured: true,
            enabled: true
          },
          {
            id: "connection-speech",
            providerId: "alibaba-model-studio",
            displayName: "Alibaba Speech",
            endpoint: "wss://example.com",
            apiKeyConfigured: true,
            enabled: true
          }
        ],
        models: [
          dashboardModel("model-chat", "connection-chat", "Qwen Chat", [
            "text-input",
            "text-output",
            "tool-calling"
          ]),
          dashboardModel("model-stt", "connection-speech", "Fun-ASR", [
            "audio-input",
            "text-output",
            "transcription"
          ]),
          dashboardModel("model-tts", "connection-speech", "Qwen TTS", [
            "text-input",
            "audio-output",
            "speech-synthesis"
          ])
        ],
        routes: [
          {
            id: "route-composed",
            displayName: "Production Voice",
            mode: "composed",
            sttModelDeploymentId: "model-stt",
            chatModelDeploymentId: "model-chat",
            ttsModelDeploymentId: "model-tts",
            nativeModelDeploymentId: null,
            fallbackRouteId: null,
            sttStreamingEnabled: false,
            ttsStreamingEnabled: false,
            enabled: true
          }
        ],
        activeRouteId: "route-composed"
      }
    });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("mock.get_device_status")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
    expect(screen.getByText("Production Voice")).toBeVisible();
    expect(screen.getByText("Qwen Chat")).toBeVisible();
    expect(screen.getByText("Fun-ASR")).toBeVisible();
    expect(screen.getByText("Qwen TTS")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Device and physical audio" })
    ).toBeVisible();
    expect(screen.getAllByText("Unavailable")).toHaveLength(6);
    expect(
      screen.getByRole("link", { name: "Manage routing" })
    ).toHaveAttribute("href", "/settings?section=providers");
    expect(screen.getAllByText("Required capabilities verified")).toHaveLength(
      3
    );
  });

  it("keeps device status visible when the main Dashboard request fails", async () => {
    vi.spyOn(apiClient, "dashboard").mockRejectedValue(
      new Error("Dashboard unavailable")
    );
    vi.spyOn(apiClient, "deviceStatus").mockResolvedValue({
      device: {
        status: "ready",
        displayName: "Mock edge device",
        detailCode: null,
        observedAt: "2026-08-21T00:00:00.000Z"
      },
      audio: {
        input: {
          status: "unavailable",
          displayName: null,
          detailCode: "adapter-not-configured",
          observedAt: null
        },
        output: {
          status: "unavailable",
          displayName: null,
          detailCode: "adapter-not-configured",
          observedAt: null
        }
      },
      system: {
        cpuUsage: {
          status: "unavailable",
          value: null,
          unit: "percent",
          detailCode: "adapter-not-configured",
          observedAt: null
        },
        memoryUsage: {
          status: "unavailable",
          value: null,
          unit: "bytes",
          detailCode: "adapter-not-configured",
          observedAt: null
        },
        temperature: {
          status: "unavailable",
          value: null,
          unit: "celsius",
          detailCode: "adapter-not-configured",
          observedAt: null
        }
      }
    });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("Dashboard unavailable")).toBeVisible();
    expect(screen.getByText("Mock edge device")).toBeVisible();
    expect(
      screen.queryByText("Loading device status...")
    ).not.toBeInTheDocument();
  });

  function dashboardModel(
    id: string,
    connectionId: string,
    displayName: string,
    capabilities: ModelCapability[]
  ) {
    return {
      id,
      connectionId,
      displayName,
      modelName: id,
      apiVersion: "",
      providerOptions: {},
      declaredCapabilities: capabilities,
      verifiedCapabilities: capabilities,
      enabled: true
    };
  }

  it("submits chat and renders tool-assisted output", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "chat").mockResolvedValue({
      runId: "11111111-1111-4111-8111-111111111111",
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
    renderWithProviders(<LogsPage onFiltersChange={vi.fn()} />);

    const log = (await screen.findByText("Test log message")).closest(
      "article"
    );
    if (!log) throw new Error("Expected a log article");
    expect(within(log).getByText("Authentication")).toBeVisible();
    expect(within(log).getByText("Warning")).toBeVisible();
    await waitFor(() => expect(apiClient.logs).toHaveBeenCalledOnce());
  });
});
