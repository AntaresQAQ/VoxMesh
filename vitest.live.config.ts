import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    bail: 1,
    include: ["tests/live/**/*.live.test.ts"],
    passWithNoTests: false,
    retry: 0,
    sequence: {
      concurrent: false
    },
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
