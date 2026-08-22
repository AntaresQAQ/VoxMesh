import { useState, type ReactNode } from "react";

import type { RuntimeRouteSummary } from "@voxmesh/shared";

import { ProviderReadinessStatus } from "../../components/ProviderReadinessStatus.js";
import { useI18n } from "../../i18n/i18n.js";

export function RouteList(props: {
  routes: RuntimeRouteSummary[];
  activeRouteId: string;
  pending: boolean;
  editingId: string | undefined;
  renderEditor: (route: RuntimeRouteSummary) => ReactNode;
  onEdit: (route: RuntimeRouteSummary) => void;
  onTest: (id: string) => Promise<void>;
  onTestAndActivate: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  return (
    <ul className="routing-summary-list">
      {props.routes.map((route) => {
        const fallbackDependents = props.routes.filter(
          (candidate) => candidate.fallbackRouteId === route.id
        );
        const isActive = route.id === props.activeRouteId;
        const deleteBlocked = isActive || fallbackDependents.length > 0;
        return (
          <li
            key={route.id}
            className={
              props.editingId === route.id
                ? "routing-summary-list-item editing"
                : "routing-summary-list-item"
            }
          >
            <strong>{route.displayName}</strong>
            <span>
              {route.mode === "composed"
                ? t("settings.voiceModeComposed")
                : t("settings.voiceModeNative")}
            </span>
            <ProviderReadinessStatus readiness={route.readiness} />
            {isActive ? (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={props.pending}
                  onClick={() => void props.onTest(route.id)}
                >
                  {t("settings.testRoute")}
                </button>
                <span>{t("settings.activeRoute")}</span>
              </>
            ) : route.enabled ? (
              <button
                type="button"
                className="secondary"
                disabled={props.pending}
                onClick={() => void props.onTestAndActivate(route.id)}
              >
                {t("settings.testAndActivate")}
              </button>
            ) : null}
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={props.pending}
                aria-expanded={props.editingId === route.id}
                onClick={() => props.onEdit(route)}
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
              ) : deleteId === route.id ? (
                <button
                  type="button"
                  disabled={props.pending}
                  onClick={() =>
                    void props.onDelete(route.id).then(() => setDeleteId(null))
                  }
                >
                  {t("settings.confirmDelete")}
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={props.pending}
                  onClick={() => setDeleteId(route.id)}
                >
                  {t("settings.delete")}
                </button>
              )}
            </div>
            {isActive ? (
              <span className="dependency-hint">
                {t("settings.activateAnotherBeforeDelete")}
              </span>
            ) : null}
            {fallbackDependents.length > 0 ? (
              <span className="dependency-hint">
                {t("settings.routeFallbackDependencyHint", {
                  names: fallbackDependents
                    .map((candidate) => candidate.displayName)
                    .join(", ")
                })}
              </span>
            ) : null}
            {props.renderEditor(route)}
          </li>
        );
      })}
    </ul>
  );
}
