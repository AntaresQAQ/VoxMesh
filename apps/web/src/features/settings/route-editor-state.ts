import type {
  NormalizedRuntimeRouteInput,
  RuntimeRouteSummary
} from "@voxmesh/shared";

export const routeEditorDefaults: NormalizedRuntimeRouteInput = {
  displayName: "",
  mode: "composed",
  sttModelDeploymentId: null,
  chatModelDeploymentId: null,
  ttsModelDeploymentId: null,
  nativeModelDeploymentId: null,
  fallbackRouteId: null,
  sttStreamingEnabled: false,
  chatStreamingEnabled: false,
  ttsStreamingEnabled: false,
  enabled: true
};

export function routeToInput(
  route: RuntimeRouteSummary
): NormalizedRuntimeRouteInput {
  return {
    displayName: route.displayName,
    mode: route.mode,
    sttModelDeploymentId: route.sttModelDeploymentId,
    chatModelDeploymentId: route.chatModelDeploymentId,
    ttsModelDeploymentId: route.ttsModelDeploymentId,
    nativeModelDeploymentId: route.nativeModelDeploymentId,
    fallbackRouteId: route.fallbackRouteId,
    sttStreamingEnabled: route.sttStreamingEnabled,
    chatStreamingEnabled: route.chatStreamingEnabled,
    ttsStreamingEnabled: route.ttsStreamingEnabled,
    enabled: route.enabled
  };
}
