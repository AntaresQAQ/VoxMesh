import type { ProviderCapability, SpeechProviderMode } from "@voxmesh/shared";

import { ProviderSelect } from "./ProviderSelect.js";

export function SpeechProviderSelect(props: {
  capability: ProviderCapability;
  label: string;
  value: SpeechProviderMode;
  onChange: (value: SpeechProviderMode) => void;
}) {
  return (
    <ProviderSelect
      capability={props.capability}
      label={props.label}
      value={props.value}
      onChange={(value) => props.onChange(value as SpeechProviderMode)}
    />
  );
}
