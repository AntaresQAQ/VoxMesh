import {
  MockNativeVoiceProvider,
  type NativeVoiceProvider
} from "@voxmesh/agent-core";
import { ProviderRegistry } from "@voxmesh/shared";
import type { StoredVoicePipelineConfiguration } from "@voxmesh/storage";

const registry = new ProviderRegistry<
  StoredVoicePipelineConfiguration,
  NativeVoiceProvider
>((config) => config.nativeProviderId).register({
  id: "mock-native",
  displayName: "Mock Native Multimodal",
  capabilities: [
    "native-multimodal",
    "audio-input",
    "audio-output",
    "tool-calling"
  ],
  validate: () => undefined,
  create: () => new MockNativeVoiceProvider()
});

export function createNativeVoiceProvider(
  config: StoredVoicePipelineConfiguration
): NativeVoiceProvider {
  return registry.create(config);
}

export function validateNativeVoiceConfiguration(
  config: StoredVoicePipelineConfiguration
): void {
  if (config.mode === "composed") return;
  registry.create(config);
}

export function nativeVoiceProviderDescriptors() {
  return registry.descriptors();
}
