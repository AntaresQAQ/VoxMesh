import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    passWithNoTests: false,
    testTimeout: 15_000
  }
});
