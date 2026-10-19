import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { runMigrations } from "./db/client.js";
import { seed } from "./db/seed.js";
import { DATA_DIR, HOST, PORT } from "./env.js";
import { startBackupScheduler } from "./services/backup.js";
import { startFxScheduler } from "./services/fx.js";

/** Start the local server. Used by `npm run dev`, `npm start` and the Electron wrapper. */
export async function start(port = PORT, host = HOST) {
  runMigrations();
  seed();
  startFxScheduler();
  startBackupScheduler();
  const app = createApp();
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const server = app.listen(port, host, () => {
      const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
      console.log(`[jjs] server ready at ${url} — data folder: ${DATA_DIR}`);
      resolve({ url, close: () => server.close() });
    });
  });
}

// Run directly (not when imported by Electron).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void start();
} else if (process.argv[1]?.endsWith("server/index.ts")) {
  void start();
}
