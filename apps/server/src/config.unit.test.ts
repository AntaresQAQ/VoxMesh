import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("loads configurable host and port", () => {
    const config = loadConfig({
      VOXMESH_HOST: "0.0.0.0",
      VOXMESH_PORT: "8080",
      VOXMESH_SESSION_TTL_SECONDS: "120"
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
    expect(config.sessionTtlSeconds).toBe(120);
  });

  it("rejects invalid ports", () => {
    expect(() => loadConfig({ VOXMESH_PORT: "70000" })).toThrow(
      "VOXMESH_PORT must be between 1 and 65535"
    );
  });
});
