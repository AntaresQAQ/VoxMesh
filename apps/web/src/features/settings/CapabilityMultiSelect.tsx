import { useEffect, useId, useRef } from "react";

import type { ModelCapability } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { capabilityLabel } from "./capability-label.js";

export const modelCapabilities: ModelCapability[] = [
  "text-input",
  "text-output",
  "audio-input",
  "audio-output",
  "transcription",
  "speech-synthesis",
  "tool-calling",
  "native-multimodal",
  "streaming",
  "non-streaming"
];

export function CapabilityMultiSelect(props: {
  value: ModelCapability[];
  onChange: (value: ModelCapability[]) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        detailsRef.current?.open &&
        !detailsRef.current.contains(event.target as Node)
      ) {
        detailsRef.current.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        detailsRef.current?.open &&
        detailsRef.current.contains(document.activeElement)
      ) {
        detailsRef.current.open = false;
        summaryRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const summary =
    props.value.length === 0
      ? t("settings.selectCapabilities")
      : t("settings.capabilitiesSelected", { count: props.value.length });

  return (
    <div className="capability-picker">
      <span id={`${id}-label`}>{t("settings.declaredCapabilities")}</span>
      <details ref={detailsRef}>
        <summary
          ref={summaryRef}
          aria-label={t("settings.declaredCapabilities")}
          aria-describedby={`${id}-value`}
        >
          <span id={`${id}-value`}>{summary}</span>
        </summary>
        <div className="capability-picker-options">
          <div className="capability-picker-list">
            {modelCapabilities.map((capability) => (
              <label className="checkbox-label" key={capability}>
                <input
                  type="checkbox"
                  checked={props.value.includes(capability)}
                  onChange={(event) =>
                    props.onChange(
                      modelCapabilities.filter((item) =>
                        item === capability
                          ? event.target.checked
                          : props.value.includes(item)
                      )
                    )
                  }
                />
                {capabilityLabel(capability, t)}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="secondary capability-picker-done"
            onClick={() => {
              if (detailsRef.current) {
                detailsRef.current.open = false;
              }
              summaryRef.current?.focus();
            }}
          >
            {t("settings.done")}
          </button>
        </div>
      </details>
    </div>
  );
}
