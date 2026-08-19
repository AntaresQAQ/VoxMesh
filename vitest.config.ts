import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false
    },
    include: ["**/*.unit.test.{ts,tsx}"],
    setupFiles: ["apps/web/src/test/setup.ts"],
    passWithNoTests: false
  }
});
