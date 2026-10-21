import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { BACKUP_DIR, RESTORE_PENDING } from "../env.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { h, HttpError, parse } from "../lib/util.js";
import { createBackup, listBackups } from "../services/backup.js";

export const backupsRouter = Router();

backupsRouter.get(
  "/",
  requirePerm("settings", "view"),
  h((_req, res) => res.json({ folder: BACKUP_DIR, backups: listBackups() })),
);

backupsRouter.post(
  "/",
  requirePerm("settings", "edit"),
  h(async (req, res) => {
    const b = await createBackup();
    writeAudit(db, { userId: req.user!.id, action: "backup", entity: "system", after: { file: b.name } });
    res.status(201).json({ backup: b, backups: listBackups() });
  }),
);

/**
 * Choose a backup to bring back. It takes effect when the app is closed and opened again;
 * the current data is kept as one more backup, so this can be undone the same way.
 */
backupsRouter.post(
  "/restore",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const body = parse(z.object({ name: z.string().min(1).max(120) }), req.body);
    const b = listBackups().find((x) => x.name === body.name);
    if (!b) throw new HttpError(404, "not_found", "That backup does not exist.");
    fs.copyFileSync(path.join(BACKUP_DIR, b.name), RESTORE_PENDING);
    writeAudit(db, { userId: req.user!.id, action: "restore", entity: "system", after: { file: b.name } });
    res.json({ ok: true, restartNeeded: true });
  }),
);

backupsRouter.post(
  "/restore/cancel",
  requirePerm("settings", "edit"),
  h((_req, res) => {
    fs.rmSync(RESTORE_PENDING, { force: true });
    res.json({ ok: true });
  }),
);

backupsRouter.get(
  "/restore",
  requirePerm("settings", "view"),
  h((_req, res) => res.json({ pending: fs.existsSync(RESTORE_PENDING) })),
);
