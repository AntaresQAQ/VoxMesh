import { useQuery } from "@tanstack/react-query";

import type { ProviderCapability } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { providerCatalogQueryOptions } from "../../query.js";

export function ProviderSelect(props: {
  capability: ProviderCapability;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const catalog = useQuery(providerCatalogQueryOptions());
  const providers = catalog.data?.providers.filter((provider) =>
    provider.capabilities.includes(props.capability)
  ) ?? [
    {
      id: props.value,
      displayName: props.value,
      capabilities: [props.capability]
    }
  ];

  return (
    <label>
      {props.label}
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {providerLabel(provider.id, provider.displayName, t)}
          </option>
        ))}
      </select>
    </label>
  );
}

function providerLabel(
  id: string,
  fallback: string,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (id === "mock") return t("common.mock");
  if (id === "azure-openai") return t("common.azureOpenAI");
  if (id === "openai-compatible") return t("common.openAiCompatible");
  if (id === "alibaba-model-studio") return t("common.alibabaModelStudio");
  return fallback;
}
