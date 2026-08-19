import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command: "pnpm --filter @voxmesh/server start:e2e",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
