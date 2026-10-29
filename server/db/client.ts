import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DB_PATH, MIGRATIONS_DIR } from "../env.js";
import * as schema from "./schema.js";

export const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
// Safe with WAL and much faster writes; keep more pages in memory and temp tables off the disk.
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("cache_size = -16000");
sqlite.pragma("temp_store = MEMORY");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
/** A transaction handle has the same query API as db. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export function runMigrations() {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
