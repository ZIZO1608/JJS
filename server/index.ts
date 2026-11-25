import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { runMigrations } from "./db/client.js";
import { seed, seedStudyZoneLogin, seedUsersFromEnv } from "./db/seed.js";
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
  seedUsersFromEnv();
  seedStudyZoneLogin();
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
  return new Promise<{ url: string; close: () => void }>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      server.off("error", reject);
      const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
      console.log(`[jjs] server ready at ${url} — data folder: ${DATA_DIR}`);
      resolve({ url, close: () => server.close() });
    });
    // Port taken (another program, or a second copy of the server): fail loudly instead of hanging.
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(err.code === "EADDRINUSE" ? new Error(`Port ${port} is already used by another program. Close it, or set PORT to a free port.`) : err);
    });
  });
}

/** True when this file is the program being run (Windows paths compare without case, through links). */
function isEntry(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  if (arg.replace(/\\/g, "/").endsWith("server/index.ts")) return true;
  const norm = (p: string) => {
    let real = path.resolve(p);
    try {
      real = fs.realpathSync(real);
    } catch {
      /* keep the resolved path */
    }
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  return norm(fileURLToPath(import.meta.url)) === norm(arg);
}

// Run directly (not when imported by Electron).
if (isEntry()) {
  start().catch((err) => {
    console.error("[jjs] could not start:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
