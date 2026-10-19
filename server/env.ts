import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up from this file until package.json — works from server/ (dev) and dist/server/server/ (built). */
function findProjectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not find the project root (package.json)");
}

export const ROOT_DIR = findProjectRoot();
export const DATA_DIR = process.env.JJS_DATA_DIR ?? path.join(ROOT_DIR, "data");
export const DB_PATH = path.join(DATA_DIR, "jjs.db");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");
export const MIGRATIONS_DIR = process.env.JJS_MIGRATIONS_DIR ?? path.join(ROOT_DIR, "drizzle");
export const WEB_DIST_DIR = path.join(ROOT_DIR, "dist", "web");
export const PORT = Number(process.env.PORT ?? 4310);
export const HOST = process.env.HOST ?? "127.0.0.1";
export const IS_PROD = process.env.NODE_ENV === "production" || fs.existsSync(path.join(WEB_DIST_DIR, "index.html"));

/** How many daily backups to keep (spec: keep the last 30). */
export const BACKUPS_TO_KEEP = 30;
/** How long a login on this laptop stays valid. */
export const SESSION_DAYS = 30;
/** FX refresh interval when online. */
export const FX_REFRESH_MS = 30 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
