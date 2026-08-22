import { useState, type ReactNode } from "react";

import type {
  ModelDeploymentSummary,
  ProviderConnectionSummary
} from "@voxmesh/shared";

import { ProviderReadinessStatus } from "../../components/ProviderReadinessStatus.js";
import { useI18n } from "../../i18n/i18n.js";

export function ConnectionList(props: {
  connections: ProviderConnectionSummary[];
  models: ModelDeploymentSummary[];
  pending: boolean;
  editingId: string | undefined;
  renderEditor: (connection: ProviderConnectionSummary) => ReactNode;
  onEdit: (connection: ProviderConnectionSummary) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  return (
    <ul className="routing-summary-list">
      {props.connections.map((connection) => {
        const dependentModels = props.models.filter(
          (model) => model.connectionId === connection.id
        );
        const deleteBlocked = dependentModels.length > 0;
        return (
          <li
            key={connection.id}
            className={
              props.editingId === connection.id
                ? "routing-summary-list-item editing"
                : "routing-summary-list-item"
            }
          >
            <strong>{connection.displayName}</strong>
            <span>{connection.endpoint || t("settings.localProvider")}</span>
            {connection.endpoint ? (
              <span>
                {connection.apiKeyConfigured
                  ? t("settings.apiKeyConfiguredShort")
                  : t("settings.apiKeyMissing")}
              </span>
            ) : null}
            <span>
              {connection.enabled
                ? t("settings.enabled")
                : t("settings.disabled")}
            </span>
            <ProviderReadinessStatus readiness={connection.readiness} />
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={props.pending}
                aria-expanded={props.editingId === connection.id}
                onClick={() => props.onEdit(connection)}
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
              ) : deleteId === connection.id ? (
                <>
                  <button
                    type="button"
                    disabled={props.pending}
                    onClick={() =>
                      void props
                        .onDelete(connection.id)
                        .then(() => setDeleteId(null))
                    }
                  >
                    {t("settings.confirmDelete")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={props.pending}
                    onClick={() => setDeleteId(null)}
                  >
                    {t("settings.cancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={props.pending}
                  onClick={() => setDeleteId(connection.id)}
                >
                  {t("settings.delete")}
                </button>
              )}
            </div>
            {deleteBlocked ? (
              <span className="dependency-hint">
                {t("settings.connectionDependencyHint", {
                  names: dependentModels
                    .map((model) => model.displayName)
                    .join(", ")
                })}
              </span>
            ) : null}
            {props.renderEditor(connection)}
          </li>
        );
      })}
    </ul>
  );
}
