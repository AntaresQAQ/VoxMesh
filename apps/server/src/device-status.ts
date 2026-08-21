import type { DeviceStatus } from "@voxmesh/shared";

/** Platform adapter for safe host, metric, and physical-audio availability. */
export interface DeviceStatusProvider {
  getStatus(): Promise<DeviceStatus>;
}

/**
 * Reports explicit unavailability until a deployment configures a
 * platform-specific hardware adapter.
 */
export class UnavailableDeviceStatusProvider implements DeviceStatusProvider {
  public async getStatus(): Promise<DeviceStatus> {
    return {
      device: unavailableResource(),
      audio: {
        input: unavailableResource(),
        output: unavailableResource()
      },
      system: {
        cpuUsage: unavailableMetric("percent"),
        memoryUsage: unavailableMetric("bytes"),
        temperature: unavailableMetric("celsius")
      }
    };
  }
}

function unavailableResource() {
  return {
    status: "unavailable" as const,
    displayName: null,
    detailCode: "adapter-not-configured" as const,
    observedAt: null
  };
}

function unavailableMetric(unit: "percent" | "bytes" | "celsius") {
  return {
    status: "unavailable" as const,
    value: null,
    unit,
    detailCode: "adapter-not-configured" as const,
    observedAt: null
  };
}
