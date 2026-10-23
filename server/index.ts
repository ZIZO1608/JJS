import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { runMigrations } from "./db/client.js";
import { seed, seedAdminFromEnv } from "./db/seed.js";
import { DATA_DIR, HOST, PORT } from "./env.js";
import { startBackupScheduler } from "./services/backup.js";
import { startFxScheduler } from "./services/fx.js";
import { db } from "./db/client.js";
import { currentRate, localDate } from "./lib/biz.js";
import { getSetting } from "./lib/settings.js";
import { renewSubscriptions } from "./services/clients.js";
import { startSyncScheduler } from "./services/sync.js";
import { generateRecurringExpenses } from "./routes/expenses.js";

/** Start the local server. Used by `npm run dev`, `npm start` and the Electron wrapper. */
export async function start(port = PORT, host?: string) {
  runMigrations();
  seed();
  seedAdminFromEnv();
  startFxScheduler();
  startBackupScheduler();
  startSyncScheduler();
  const renew = () => {
    try {
      db.transaction((tx) => renewSubscriptions(tx, localDate(), currentRate()));
    } catch (e) {
      console.error("[subscriptions] renew failed", e);
    }
    try {
      generateRecurringExpenses();
    } catch (e) {
      console.error("[expenses] monthly expenses failed", e);
    }
  };
  renew();
  setInterval(renew, 60 * 60 * 1000);
  // Phones on the same Wi-Fi can reach the system only when the admin turned it on.
  const lan = getSetting("network").lanAccess;
  host = host ?? (lan ? "0.0.0.0" : HOST);
  process.env.JJS_LAN_ACTIVE = host === "0.0.0.0" ? "1" : "0";
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
