import { useMutation, useQueryClient } from "@tanstack/react-query";

import type {
  ModelDeploymentInput,
  ProviderConnectionInput,
  RuntimeRouteInput,
  RuntimeRoutingSummary
} from "@voxmesh/shared";

import { apiClient } from "../../api.js";
import { queryKeys } from "../../query.js";

export type RuntimeRoutingOperation =
  | { type: "create-connection"; input: ProviderConnectionInput }
  | { type: "update-connection"; id: string; input: ProviderConnectionInput }
  | { type: "delete-connection"; id: string }
  | { type: "create-model"; input: ModelDeploymentInput }
  | { type: "update-model"; id: string; input: ModelDeploymentInput }
  | { type: "delete-model"; id: string }
  | { type: "create-route"; input: RuntimeRouteInput }
  | { type: "update-route"; id: string; input: RuntimeRouteInput }
  | { type: "delete-route"; id: string }
  | { type: "test-route"; id: string }
  | { type: "test-and-activate-route"; id: string };

export function useRuntimeRoutingMutations() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: executeOperation,
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.runtimeRouting, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (_error, operation) => {
      if (
        operation.type === "test-route" ||
        operation.type === "test-and-activate-route"
      ) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.runtimeRouting
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      }
    }
  });
  return {
    execute: mutation.mutateAsync,
    pending: mutation.isPending,
    succeeded: mutation.isSuccess,
    operation: mutation.variables,
    error: mutation.error,
    reset: mutation.reset
  };
}

function executeOperation(
  operation: RuntimeRoutingOperation
): Promise<RuntimeRoutingSummary> {
  switch (operation.type) {
    case "create-connection":
      return apiClient.createRuntimeConnection(operation.input);
    case "update-connection":
      return apiClient.updateRuntimeConnection(operation.id, operation.input);
    case "delete-connection":
      return apiClient.deleteRuntimeConnection(operation.id);
    case "create-model":
      return apiClient.createRuntimeModel(operation.input);
    case "update-model":
      return apiClient.updateRuntimeModel(operation.id, operation.input);
    case "delete-model":
      return apiClient.deleteRuntimeModel(operation.id);
    case "create-route":
      return apiClient.createRuntimeRoute(operation.input);
    case "update-route":
      return apiClient.updateRuntimeRoute(operation.id, operation.input);
    case "delete-route":
      return apiClient.deleteRuntimeRoute(operation.id);
    case "test-route":
      return apiClient.testRuntimeRoute(operation.id);
    case "test-and-activate-route":
      return apiClient
        .testRuntimeRoute(operation.id)
        .then(() => apiClient.activateRuntimeRoute(operation.id));
  }
}
