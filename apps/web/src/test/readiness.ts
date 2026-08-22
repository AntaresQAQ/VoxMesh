import type { ProviderReadiness } from "@voxmesh/shared";

export const unknownReadiness: ProviderReadiness = {
  state: "unknown",
  lastTestedAt: null,
  lastError: null
};
