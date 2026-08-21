import type {
  AvailabilityStatus,
  DeviceMetricStatus,
  DeviceResourceStatus,
  DeviceStatus,
  DeviceStatusDetailCode
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";

export function DeviceStatusPanel({ status }: { status: DeviceStatus }) {
  const { t, locale, formatTime } = useI18n();

  return (
    <section
      className="dashboard-device-status"
      aria-labelledby="device-status-title"
    >
      <h3 id="device-status-title">{t("dashboard.deviceStatus")}</h3>
      <div className="grid">
        <StatusCard
          label={t("dashboard.device")}
          status={status.device.status}
          value={resourceValue(status.device, t("common.none"))}
          detailCode={status.device.detailCode}
          observedAt={status.device.observedAt}
          formatTime={formatTime}
        />
        <StatusCard
          label={t("dashboard.audioInput")}
          status={status.audio.input.status}
          value={resourceValue(status.audio.input, t("common.none"))}
          detailCode={status.audio.input.detailCode}
          observedAt={status.audio.input.observedAt}
          formatTime={formatTime}
        />
        <StatusCard
          label={t("dashboard.audioOutput")}
          status={status.audio.output.status}
          value={resourceValue(status.audio.output, t("common.none"))}
          detailCode={status.audio.output.detailCode}
          observedAt={status.audio.output.observedAt}
          formatTime={formatTime}
        />
        <StatusCard
          label={t("dashboard.cpuUsage")}
          status={status.system.cpuUsage.status}
          value={metricValue(status.system.cpuUsage, locale, t("common.none"))}
          detailCode={status.system.cpuUsage.detailCode}
          observedAt={status.system.cpuUsage.observedAt}
          formatTime={formatTime}
        />
        <StatusCard
          label={t("dashboard.memoryUsage")}
          status={status.system.memoryUsage.status}
          value={metricValue(
            status.system.memoryUsage,
            locale,
            t("common.none")
          )}
          detailCode={status.system.memoryUsage.detailCode}
          observedAt={status.system.memoryUsage.observedAt}
          formatTime={formatTime}
        />
        <StatusCard
          label={t("dashboard.temperature")}
          status={status.system.temperature.status}
          value={metricValue(
            status.system.temperature,
            locale,
            t("common.none")
          )}
          detailCode={status.system.temperature.detailCode}
          observedAt={status.system.temperature.observedAt}
          formatTime={formatTime}
        />
      </div>
    </section>
  );
}

function StatusCard({
  label,
  status,
  value,
  detailCode,
  observedAt,
  formatTime
}: {
  label: string;
  status: AvailabilityStatus;
  value: string;
  detailCode: DeviceStatusDetailCode | null;
  observedAt: string | null;
  formatTime: (value: string) => string;
}) {
  const { t } = useI18n();
  return (
    <article className={`metric device-status-card ${status}`}>
      <p className="eyebrow">{label}</p>
      <strong>{value}</strong>
      <p className={`availability-status ${status}`}>
        {t(`dashboard.availability.${status}`)}
      </p>
      {detailCode ? <p>{t(`dashboard.detail.${detailCode}`)}</p> : null}
      <p className="muted">
        {observedAt
          ? t("dashboard.observedAt", { time: formatTime(observedAt) })
          : t("dashboard.notObserved")}
      </p>
    </article>
  );
}

function resourceValue(
  resource: DeviceResourceStatus,
  unavailable: string
): string {
  return resource.displayName ?? unavailable;
}

function metricValue(
  metric: DeviceMetricStatus,
  locale: string,
  unavailable: string
): string {
  if (metric.value === null) return unavailable;
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1
  }).format(
    metric.unit === "bytes" ? metric.value / (1024 * 1024) : metric.value
  );
  switch (metric.unit) {
    case "percent":
      return `${number}%`;
    case "bytes":
      return `${number} MiB`;
    case "celsius":
      return `${number} °C`;
  }
}
