import { useQuery } from "@tanstack/react-query";

import { useI18n } from "../../i18n/i18n.js";
import { runtimeRoutingQueryOptions } from "../../query.js";
import { localizedError } from "../../utils/errors.js";
import { ConnectionManagement } from "./ConnectionManagement.js";
import { ModelManagement } from "./ModelManagement.js";
import { RouteManagement } from "./RouteManagement.js";
import { useRuntimeRoutingMutations } from "./useRuntimeRoutingMutations.js";

export function RuntimeRoutingSummaryCard() {
  const { t } = useI18n();
  const routing = useQuery(runtimeRoutingQueryOptions());
  const mutations = useRuntimeRoutingMutations();
  const routingData = routing.data;
  const activeRoute = routingData?.routes.find(
    (route) => route.id === routingData.activeRouteId
  );
  const routeOperation =
    mutations.operation?.type === "test-route" ||
    mutations.operation?.type === "test-and-activate-route"
      ? mutations.operation
      : undefined;
  const routeStatus = routeOperation
    ? mutations.pending
      ? routeOperation.type === "test-route"
        ? t("settings.routeTestPending")
        : t("settings.routeTestAndActivatePending")
      : mutations.succeeded
        ? routeOperation.type === "test-route"
          ? t("settings.routeTestSucceeded")
          : t("settings.routeTestAndActivateSucceeded")
        : undefined
    : undefined;
  const routeError =
    routeOperation && mutations.error
      ? localizedError(mutations.error, t, "settings.routeTestFailed")
      : undefined;

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
      {mutations.error && !routeOperation ? (
        <p className="error" role="alert">
          {localizedError(mutations.error, t, "settings.saveFailed")}
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
          <div className="routing-overview" role="list">
            <span role="listitem">
              {t("settings.connectionCount", {
                count: routingData.connections.length
              })}
            </span>
            <span role="listitem">
              {t("settings.modelCount", { count: routingData.models.length })}
            </span>
            <span role="listitem">
              {t("settings.routeCount", { count: routingData.routes.length })}
            </span>
          </div>
          <p className="muted">{t("settings.routingDeleteHint")}</p>
          <details className="routing-management">
            <summary>
              {t("settings.connections")} ({routingData.connections.length})
            </summary>
            <ConnectionManagement
              routing={routingData}
              pending={mutations.pending}
              execute={mutations.execute}
            />
          </details>
          <details className="routing-management">
            <summary>
              {t("settings.models")} ({routingData.models.length})
            </summary>
            <ModelManagement
              routing={routingData}
              pending={mutations.pending}
              execute={mutations.execute}
            />
          </details>
          <details className="routing-management">
            <summary>
              {t("settings.routes")} ({routingData.routes.length})
            </summary>
            <RouteManagement
              routing={routingData}
              pending={mutations.pending}
              {...(routeStatus ? { status: routeStatus } : {})}
              {...(routeError ? { error: routeError } : {})}
              execute={mutations.execute}
            />
          </details>
        </div>
      ) : null}
    </section>
  );
}
