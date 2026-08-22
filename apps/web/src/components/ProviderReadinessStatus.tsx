import type { ProviderReadiness } from "@voxmesh/shared";

import { useI18n } from "../i18n/i18n.js";

export function ProviderReadinessStatus({
  readiness
}: {
  readiness: ProviderReadiness;
}) {
  const { t, formatTime } = useI18n();
  return (
    <div className={`provider-readiness ${readiness.state}`}>
      <span className="provider-readiness-state">
        {t("readiness.label")}: {t(`readiness.state.${readiness.state}`)}
      </span>
      {readiness.lastTestedAt ? (
        <span>
          {t("readiness.lastTested")}:{" "}
          <time dateTime={readiness.lastTestedAt}>
            {formatTime(readiness.lastTestedAt)}
          </time>
        </span>
      ) : (
        <span>{t("readiness.notTested")}</span>
      )}
      {readiness.lastError ? (
        <span>
          {t("readiness.lastError")}:{" "}
          {t(`readiness.error.${readiness.lastError.category}`)}
        </span>
      ) : null}
    </div>
  );
}
