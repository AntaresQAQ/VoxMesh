import { useQuery } from "@tanstack/react-query";

import { voicePipelineQueryOptions } from "../../query.js";
import { LlmSettingsCard } from "./LlmSettingsCard.js";
import { RuntimeRoutingSummaryCard } from "./RuntimeRoutingSummaryCard.js";
import { SpeechSettingsCard } from "./SpeechSettingsCard.js";
import { VoicePipelineSettingsCard } from "./VoicePipelineSettingsCard.js";

export function AiProvidersSettings() {
  const pipeline = useQuery(voicePipelineQueryOptions());
  const mode = pipeline.data?.mode ?? "composed";
  return (
    <div className="settings-provider-stack">
      <VoicePipelineSettingsCard />
      <RuntimeRoutingSummaryCard />
      {mode === "composed" ? (
        <>
          <LlmSettingsCard />
          <SpeechSettingsCard />
        </>
      ) : null}
    </div>
  );
}
