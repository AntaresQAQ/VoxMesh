import { useState, type ReactNode } from "react";

import type {
  ModelDeploymentSummary,
  RuntimeRouteSummary
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { capabilityLabel } from "./capability-label.js";

export function ModelList(props: {
  models: ModelDeploymentSummary[];
  routes: RuntimeRouteSummary[];
  pending: boolean;
  editingId: string | undefined;
  renderEditor: (model: ModelDeploymentSummary) => ReactNode;
  onEdit: (model: ModelDeploymentSummary) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  return (
    <ul className="routing-summary-list">
      {props.models.map((model) => {
        const dependentRoutes = props.routes.filter(
          (route) =>
            route.sttModelDeploymentId === model.id ||
            route.chatModelDeploymentId === model.id ||
            route.ttsModelDeploymentId === model.id ||
            route.nativeModelDeploymentId === model.id
        );
        const deleteBlocked = dependentRoutes.length > 0;
        return (
          <li
            key={model.id}
            className={
              props.editingId === model.id
                ? "routing-summary-list-item editing"
                : "routing-summary-list-item"
            }
          >
            <strong>{model.displayName}</strong>
            <span>
              {t("settings.verifiedCapabilities")}:{" "}
              {model.verifiedCapabilities
                .map((capability) => capabilityLabel(capability, t))
                .join(", ") || t("common.none")}
            </span>
            <span>
              {t("settings.declaredCapabilities")}:{" "}
              {model.declaredCapabilities
                .map((capability) => capabilityLabel(capability, t))
                .join(", ")}
            </span>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={props.pending}
                aria-expanded={props.editingId === model.id}
                onClick={() => props.onEdit(model)}
              >
                {t("settings.edit")}
              </button>
              {deleteBlocked ? (
                <button
                  type="button"
                  className="secondary dependency-blocked"
                  disabled
                >
                  {t("settings.delete")}
                </button>
              ) : deleteId === model.id ? (
                <button
                  type="button"
                  disabled={props.pending}
                  onClick={() =>
                    void props.onDelete(model.id).then(() => setDeleteId(null))
                  }
                >
                  {t("settings.confirmDelete")}
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={props.pending}
                  onClick={() => setDeleteId(model.id)}
                >
                  {t("settings.delete")}
                </button>
              )}
            </div>
            {deleteBlocked ? (
              <span className="dependency-hint">
                {t("settings.modelDependencyHint", {
                  names: dependentRoutes
                    .map((route) => route.displayName)
                    .join(", ")
                })}
              </span>
            ) : null}
            {props.renderEditor(model)}
          </li>
        );
      })}
    </ul>
  );
}
