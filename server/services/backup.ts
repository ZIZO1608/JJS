import fs from "node:fs";
import path from "node:path";
import { sqlite } from "../db/client.js";
import { BACKUP_DIR, BACKUPS_TO_KEEP } from "../env.js";

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export function listBackups(): BackupFile[] {
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("jjs-") && f.endsWith(".db"))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function prune() {
  for (const old of listBackups().slice(BACKUPS_TO_KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
}

/** Online backup of the live database (safe while the app is running). */
export async function createBackup(): Promise<BackupFile> {
  const name = `jjs-${stamp(new Date())}.db`;
  await sqlite.backup(path.join(BACKUP_DIR, name));
  prune();
  const st = fs.statSync(path.join(BACKUP_DIR, name));
  return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
}

const hasBackupToday = () => {
  const today = new Date().toDateString();
  return listBackups().some((b) => new Date(b.createdAt).toDateString() === today);
};

/** One automatic backup per day: checked at start and every hour. */
export function startBackupScheduler() {
  const tick = () => {
    if (!hasBackupToday()) createBackup().catch((e) => console.error("[backup] failed", e));
  };
  tick();
  return setInterval(tick, 60 * 60 * 1000);
}
