import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildServer({ config });

const close = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void close();
});
process.on("SIGTERM", () => {
  void close();
});

await app.listen({
  host: config.host,
  port: config.port
});
