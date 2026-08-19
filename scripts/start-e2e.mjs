import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "voxmesh-e2e-"));
const child = spawn(
  process.execPath,
  [resolve(repositoryRoot, "apps/server/dist/index.js")],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      VOXMESH_HOST: "127.0.0.1",
      VOXMESH_PORT: "4173",
      VOXMESH_DATABASE_PATH: join(directory, "voxmesh.sqlite"),
      VOXMESH_WEB_ROOT: resolve(repositoryRoot, "apps/web/dist")
    },
    stdio: "inherit"
  }
);

const forward = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
child.on("exit", (code) => {
  rmSync(directory, { force: true, recursive: true });
  process.exit(code ?? 1);
});
