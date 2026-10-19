import { Router } from "express";
import { db } from "../db/client.js";
import { BACKUP_DIR } from "../env.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { h } from "../lib/util.js";
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
