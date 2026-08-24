import type { RuntimeRouteInput } from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

export function RouteModeSelect(props: {
  value: RuntimeRouteInput["mode"];
  onChange: (mode: RuntimeRouteInput["mode"]) => void;
}) {
  const { t } = useI18n();
  return (
    <label>
      {t("settings.voicePipelineMode")}
      <select
        value={props.value}
        onChange={(event) =>
          props.onChange(event.target.value as RuntimeRouteInput["mode"])
        }
      >
        <option value="composed">{t("settings.voiceModeComposed")}</option>
        <option value="native-multimodal">
          {t("settings.voiceModeNative")}
        </option>
      </select>
    </label>
  );
}

export function RouteEditorActions(props: {
  editing: boolean;
  pending: boolean;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="button-row">
      <button disabled={props.pending}>
        {props.editing ? t("settings.saveChanges") : t("settings.create")}
      </button>
      <button type="button" className="secondary" onClick={props.onCancel}>
        {t("settings.cancel")}
      </button>
    </div>
  );
}
