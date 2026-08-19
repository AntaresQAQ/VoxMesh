import { QueryClient, queryOptions } from "@tanstack/react-query";

import { apiClient } from "./api.js";

export const queryKeys = {
  setup: ["setup"] as const,
  session: ["session"] as const,
  dashboard: ["dashboard"] as const,
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversations", id] as const,
  logs: ["logs"] as const,
  llmConfiguration: ["configuration", "llm"] as const
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 10_000
      },
      mutations: {
        retry: false
      }
    }
  });
}

export const setupQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.setup,
    queryFn: apiClient.setupStatus
  });

export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.session,
    queryFn: apiClient.session,
    staleTime: 30_000
  });

export const dashboardQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.dashboard,
    queryFn: apiClient.dashboard
  });

export const conversationsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.conversations,
    queryFn: apiClient.conversations
  });

export const conversationQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.conversation(id),
    queryFn: () => apiClient.conversation(id)
  });

export const logsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.logs,
    queryFn: apiClient.logs
  });

export const llmConfigurationQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.llmConfiguration,
    queryFn: apiClient.llmConfiguration
  });
