import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  cookieSecure: boolean;
  sessionTtlSeconds: number;
  webRoot: string;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): ServerConfig {
  const port = parseInteger(environment.VOXMESH_PORT, 3000, "VOXMESH_PORT");
  const sessionTtlSeconds = parseInteger(
    environment.VOXMESH_SESSION_TTL_SECONDS,
    86_400,
    "VOXMESH_SESSION_TTL_SECONDS"
  );
  if (port < 1 || port > 65_535) {
    throw new Error("VOXMESH_PORT must be between 1 and 65535");
  }
  if (sessionTtlSeconds < 60) {
    throw new Error("VOXMESH_SESSION_TTL_SECONDS must be at least 60");
  }

  return {
    host: environment.VOXMESH_HOST ?? "127.0.0.1",
    port,
    databasePath:
      environment.VOXMESH_DATABASE_PATH ??
      resolve(repositoryRoot, "data", "voxmesh.sqlite"),
    cookieSecure: environment.VOXMESH_COOKIE_SECURE === "true",
    sessionTtlSeconds,
    webRoot:
      environment.VOXMESH_WEB_ROOT ??
      resolve(repositoryRoot, "apps", "web", "dist")
  };
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}
