import { describe, expect, it } from "vitest";

import { UnavailableDeviceStatusProvider } from "./device-status.js";

describe("UnavailableDeviceStatusProvider", () => {
  it("reports explicit safe unavailability for every adapter surface", async () => {
    const status = await new UnavailableDeviceStatusProvider().getStatus();

    expect(status.device).toMatchObject({
      status: "unavailable",
      displayName: null,
      observedAt: null
    });
    expect(status.audio.input.status).toBe("unavailable");
    expect(status.audio.output.status).toBe("unavailable");
    expect(status.system.cpuUsage).toMatchObject({
      status: "unavailable",
      value: null,
      unit: "percent"
    });
    expect(status.system.memoryUsage.unit).toBe("bytes");
    expect(status.system.temperature.unit).toBe("celsius");
  });
});
