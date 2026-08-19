import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  external: ["better-sqlite3", "ws"],
  format: ["esm"],
  noExternal: [
    "@voxmesh/agent-core",
    "@voxmesh/ai",
    "@voxmesh/audio",
    "@voxmesh/shared",
    "@voxmesh/storage"
  ],
  outDir: "dist",
  platform: "node",
  target: "node22"
});
