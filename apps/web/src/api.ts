import type {
  ChatResponse,
  ConversationRun,
  ConversationDetail,
  ConversationSummary,
  Dashboard,
  DeviceStatus,
  LogEntry,
  ModelDeploymentInput,
  ProviderConnectionInput,
  RuntimeRouteInput,
  RuntimeRoutingSummary,
  Session,
  SetupStatus,
  VoiceResponse
} from "@voxmesh/shared";

interface ApiFailure {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiClientError extends Error {
  public constructor(
    public readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiFailure;
    throw new ApiClientError(
      body.error?.code,
      body.error?.message ?? `Request failed (${response.status})`
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const apiClient = {
  setupStatus: () => api<SetupStatus>("/api/setup/status"),
  setup: (password: string) =>
    api<SetupStatus>("/api/setup", {
      method: "POST",
      body: JSON.stringify({ password })
    }),
  login: (password: string) =>
    api<Session>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password })
    }),
  session: () => api<Session>("/api/auth/session"),
  logout: () => api<void>("/api/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<void>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    }),
  runtimeRouting: () => api<RuntimeRoutingSummary>("/api/runtime-routing"),
  createRuntimeConnection: (input: ProviderConnectionInput) =>
    api<RuntimeRoutingSummary>("/api/runtime-routing/connections", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateRuntimeConnection: (id: string, input: ProviderConnectionInput) =>
    api<RuntimeRoutingSummary>(`/api/runtime-routing/connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  deleteRuntimeConnection: (id: string) =>
    api<RuntimeRoutingSummary>(`/api/runtime-routing/connections/${id}`, {
      method: "DELETE"
    }),
  createRuntimeModel: (input: ModelDeploymentInput) =>
    api<RuntimeRoutingSummary>("/api/runtime-routing/models", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateRuntimeModel: (id: string, input: ModelDeploymentInput) =>
    api<RuntimeRoutingSummary>(`/api/runtime-routing/models/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  deleteRuntimeModel: (id: string) =>
    api<RuntimeRoutingSummary>(`/api/runtime-routing/models/${id}`, {
      method: "DELETE"
    }),
  createRuntimeRoute: (input: RuntimeRouteInput) =>
    api<RuntimeRoutingSummary>("/api/runtime-routing/routes", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateRuntimeRoute: (id: string, input: RuntimeRouteInput) =>
    api<RuntimeRoutingSummary>(`/api/runtime-routing/routes/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  deleteRuntimeRoute: (id: string) =>
    api<RuntimeRoutingSummary>(`/api/runtime-routing/routes/${id}`, {
      method: "DELETE"
    }),
  testRuntimeRoute: (id: string) =>
    api<RuntimeRoutingSummary>(`/api/runtime-routing/routes/${id}/test`, {
      method: "POST"
    }),
  activateRuntimeRoute: (routeId: string) =>
    api<RuntimeRoutingSummary>("/api/runtime-routing/active", {
      method: "PUT",
      body: JSON.stringify({ routeId })
    }),
  dashboard: () => api<Dashboard>("/api/dashboard"),
  deviceStatus: () => api<DeviceStatus>("/api/device"),
  chat: (
    runId: string,
    message: string,
    signal?: AbortSignal,
    conversationId?: string
  ) =>
    api<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ runId, message, conversationId }),
      ...(signal ? { signal } : {})
    }),
  retryChatRun: (retryOfRunId: string, runId: string, signal?: AbortSignal) =>
    api<ChatResponse>(`/api/chat/runs/${retryOfRunId}/retry`, {
      method: "POST",
      body: JSON.stringify({ runId }),
      ...(signal ? { signal } : {})
    }),
  chatRun: (runId: string) => api<ConversationRun>(`/api/chat/runs/${runId}`),
  cancelChatRun: (runId: string) =>
    api<ConversationRun>(`/api/chat/runs/${runId}/cancel`, {
      method: "POST"
    }),
  voice: (audio: Blob) =>
    api<VoiceResponse>("/api/voice", {
      method: "POST",
      headers: {
        "content-type": audio.type || "application/octet-stream"
      },
      body: audio
    }),
  conversations: async () =>
    (await api<{ conversations: ConversationSummary[] }>("/api/conversations"))
      .conversations,
  conversation: (id: string) =>
    api<ConversationDetail>(`/api/conversations/${id}`),
  logs: async () => (await api<{ logs: LogEntry[] }>("/api/logs")).logs
};
