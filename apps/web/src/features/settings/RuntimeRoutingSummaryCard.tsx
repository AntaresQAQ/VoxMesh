import { useQuery } from "@tanstack/react-query";

import type { ModelCapability } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { runtimeRoutingQueryOptions } from "../../query.js";
import { localizedError } from "../../utils/errors.js";

export function RuntimeRoutingSummaryCard() {
  const { t } = useI18n();
  const routing = useQuery(runtimeRoutingQueryOptions());
  const routingData = routing.data;
  const activeRoute = routingData?.routes.find(
    (route) => route.id === routingData.activeRouteId
  );

  return (
    <section className="settings-card settings-card-wide">
      <h3>{t("settings.runtimeRoutingTitle")}</h3>
      <p className="muted">{t("settings.runtimeRoutingDescription")}</p>
      {routing.isPending ? <p role="status">{t("common.loading")}</p> : null}
      {routing.error ? (
        <p className="error" role="alert">
          {localizedError(routing.error, t, "common.requestFailed")}
        </p>
      ) : null}
      {routingData && activeRoute ? (
        <div className="routing-summary-grid">
          <section>
            <h4>{t("settings.activeRoute")}</h4>
            <p>
              <strong>{activeRoute.displayName}</strong>
              {" · "}
              {activeRoute.mode === "composed"
                ? t("settings.voiceModeComposed")
                : t("settings.voiceModeNative")}
            </p>
          </section>
          <section>
            <h4>{t("settings.connections")}</h4>
            <ul className="routing-summary-list">
              {routingData.connections.map((connection) => (
                <li key={connection.id}>
                  <strong>{connection.displayName}</strong>
                  <span>
                    {connection.endpoint || t("settings.localProvider")}
                  </span>
                  {connection.endpoint ? (
                    <span>
                      {connection.apiKeyConfigured
                        ? t("settings.apiKeyConfiguredShort")
                        : t("settings.apiKeyMissing")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h4>{t("settings.models")}</h4>
            <ul className="routing-summary-list">
              {routingData.models.map((model) => (
                <li key={model.id}>
                  <strong>{model.displayName}</strong>
                  <span>
                    {t("settings.verifiedCapabilities")}:{" "}
                    {model.verifiedCapabilities.length > 0
                      ? model.verifiedCapabilities
                          .map((capability) => capabilityLabel(capability, t))
                          .join(", ")
                      : t("common.none")}
                  </span>
                  <span>
                    {t("settings.declaredCapabilities")}:{" "}
                    {model.declaredCapabilities
                      .map((capability) => capabilityLabel(capability, t))
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function capabilityLabel(
  capability: ModelCapability,
  t: ReturnType<typeof useI18n>["t"]
): string {
  const keys = {
    "text-input": "settings.capabilityTextInput",
    "text-output": "settings.capabilityTextOutput",
    "audio-input": "settings.capabilityAudioInput",
    "audio-output": "settings.capabilityAudioOutput",
    transcription: "settings.capabilityTranscription",
    "speech-synthesis": "settings.capabilitySpeechSynthesis",
    "tool-calling": "settings.capabilityToolCalling",
    "native-multimodal": "settings.capabilityNativeMultimodal"
  } as const;
  return t(keys[capability]);
}
