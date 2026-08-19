import type { ProviderDescriptor } from "@voxmesh/shared";

import { llmProviderDescriptors } from "./llm-providers.js";
import { nativeVoiceProviderDescriptors } from "./native-voice-providers.js";
import { speechProviderDescriptors } from "./speech-providers.js";

/** Returns one capability-merged catalog for every configured provider type. */
export function providerCatalog(): ProviderDescriptor[] {
  const merged = new Map<string, ProviderDescriptor>();
  for (const descriptor of [
    ...llmProviderDescriptors(),
    ...speechProviderDescriptors(),
    ...nativeVoiceProviderDescriptors()
  ]) {
    const current = merged.get(descriptor.id);
    if (!current) {
      merged.set(descriptor.id, {
        ...descriptor,
        capabilities: [...descriptor.capabilities]
      });
      continue;
    }
    if (current.displayName !== descriptor.displayName) {
      throw new Error(`Provider display name mismatch for ${descriptor.id}`);
    }
    current.capabilities = [
      ...new Set([...current.capabilities, ...descriptor.capabilities])
    ];
  }
  return [...merged.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName)
  );
}
