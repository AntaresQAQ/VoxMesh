import type {
  ModelDeploymentSummary,
  ProviderConnectionSummary,
  RuntimeRouteInput,
  StreamingRuntimeAvailability
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { Checkbox, StreamingModelSelect } from "./RouteFieldControls.js";
import { StreamingReadiness } from "./StreamingReadiness.js";

export function ComposedRouteAssignmentFields(props: {
  values: RuntimeRouteInput;
  models: ModelDeploymentSummary[];
  connections: ProviderConnectionSummary[];
  streamingAvailability: StreamingRuntimeAvailability | undefined;
  onSttModelChange: (value: string | null) => void;
  onChatModelChange: (value: string | null) => void;
  onTtsModelChange: (value: string | null) => void;
  onSttStreamingChange: (value: boolean) => void;
  onChatStreamingChange: (value: boolean) => void;
  onTtsStreamingChange: (value: boolean) => void;
  onFullChainStreamingChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const modelIds = [
    props.values.sttModelDeploymentId,
    props.values.chatModelDeploymentId,
    props.values.ttsModelDeploymentId
  ];
  const fullChainEnabled =
    props.values.sttStreamingEnabled &&
    props.values.chatStreamingEnabled &&
    props.values.ttsStreamingEnabled;
  const fullChainSupported = modelIds.every((modelId) =>
    supportsStreaming(props.models, modelId)
  );
  const roleProps = {
    models: props.models,
    connections: props.connections,
    availability: props.streamingAvailability
  };

  return (
    <>
      <Checkbox
        label={t("settings.enableFullChainStreaming")}
        checked={fullChainEnabled}
        disabled={!fullChainSupported}
        onChange={props.onFullChainStreamingChange}
      />
      <p className="muted">{t("settings.fullChainStreamingHint")}</p>
      <StreamingModelSelect
        label={t("settings.sttTitle")}
        value={props.values.sttModelDeploymentId}
        capability="transcription"
        models={props.models}
        onChange={props.onSttModelChange}
        onStreamingChange={props.onSttStreamingChange}
      />
      <StreamingModelSelect
        label={t("dashboard.llm")}
        value={props.values.chatModelDeploymentId}
        capability="tool-calling"
        models={props.models}
        onChange={props.onChatModelChange}
        onStreamingChange={props.onChatStreamingChange}
      />
      <StreamingModelSelect
        label={t("settings.ttsTitle")}
        value={props.values.ttsModelDeploymentId}
        capability="speech-synthesis"
        models={props.models}
        onChange={props.onTtsModelChange}
        onStreamingChange={props.onTtsStreamingChange}
      />
      <RoleStreamingControl
        label={t("settings.enableSttStreaming")}
        streamingRole="stt"
        modelId={props.values.sttModelDeploymentId}
        checked={props.values.sttStreamingEnabled}
        onChange={props.onSttStreamingChange}
        {...roleProps}
      />
      <RoleStreamingControl
        label={t("settings.enableChatStreaming")}
        streamingRole="chat"
        modelId={props.values.chatModelDeploymentId}
        checked={props.values.chatStreamingEnabled}
        onChange={props.onChatStreamingChange}
        {...roleProps}
      />
      <RoleStreamingControl
        label={t("settings.enableTtsStreaming")}
        streamingRole="tts"
        modelId={props.values.ttsModelDeploymentId}
        checked={props.values.ttsStreamingEnabled}
        onChange={props.onTtsStreamingChange}
        {...roleProps}
      />
    </>
  );
}

function RoleStreamingControl(props: {
  label: string;
  streamingRole: "stt" | "chat" | "tts";
  modelId: string | null;
  checked: boolean;
  models: ModelDeploymentSummary[];
  connections: ProviderConnectionSummary[];
  availability: StreamingRuntimeAvailability | undefined;
  onChange: (value: boolean) => void;
}) {
  return (
    <>
      <Checkbox
        label={props.label}
        checked={props.checked}
        disabled={
          !props.checked && !supportsStreaming(props.models, props.modelId)
        }
        onChange={props.onChange}
      />
      <StreamingReadiness {...props} />
    </>
  );
}

function supportsStreaming(
  models: ModelDeploymentSummary[],
  modelId: string | null
): boolean {
  return (
    models
      .find((model) => model.id === modelId)
      ?.declaredCapabilities.includes("streaming") ?? false
  );
}
