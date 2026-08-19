import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  external: ["better-sqlite3"],
  format: ["esm"],
  noExternal: [
    "@voxmesh/agent-core",
    "@voxmesh/ai",
    "@voxmesh/shared",
    "@voxmesh/storage"
  ],
  outDir: "dist",
  platform: "node",
  target: "node22"
});
