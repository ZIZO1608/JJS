import { and, asc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { taxes } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { h, newId, notFound, nowIso, parse } from "../lib/util.js";

export const taxesRouter = Router();

const out = (t: typeof taxes.$inferSelect) => ({ id: t.id, nameAr: t.nameAr, nameEn: t.nameEn, kind: t.kind, value: t.value, active: t.active });

const taxSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(60),
    nameEn: z.string().trim().min(1).max(60),
    kind: z.enum(["percent", "fixed"]),
    value: z.number().min(0),
    active: z.boolean().default(true),
  })
  .refine((t) => t.kind !== "percent" || t.value <= 100, { message: "A percentage cannot be above 100", path: ["value"] });

taxesRouter.get(
  "/",
  requirePerm("settings", "view"),
  h((_req, res) => res.json({ taxes: db.select().from(taxes).where(isNull(taxes.deletedAt)).orderBy(asc(taxes.createdAt)).all().map(out) })),
);

taxesRouter.post(
  "/",
  requirePerm("settings", "create"),
  h((req, res) => {
    const body = parse(taxSchema, req.body);
    const id = newId();
    db.transaction((tx) => {
      tx.insert(taxes).values({ id, ...body }).run();
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "tax", entityId: id, after: body });
    });
    res.status(201).json({ tax: out(db.select().from(taxes).where(eq(taxes.id, id)).get()!) });
  }),
);

taxesRouter.put(
  "/:id",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(taxSchema, req.body);
    const before = db.select().from(taxes).where(and(eq(taxes.id, id), isNull(taxes.deletedAt))).get();
    if (!before) throw notFound("tax");
    db.transaction((tx) => {
      tx.update(taxes).set({ ...body, updatedAt: nowIso(), syncedAt: null }).where(eq(taxes.id, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "tax", entityId: id, before: out(before), after: body });
    });
    res.json({ tax: out(db.select().from(taxes).where(eq(taxes.id, id)).get()!) });
  }),
);

taxesRouter.delete(
  "/:id",
  requirePerm("settings", "delete"),
  h((req, res) => {
    const id = String(req.params.id);
    const before = db.select().from(taxes).where(and(eq(taxes.id, id), isNull(taxes.deletedAt))).get();
    if (!before) throw notFound("tax");
    db.transaction((tx) => {
      tx.update(taxes).set({ deletedAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(eq(taxes.id, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "delete", entity: "tax", entityId: id, before: out(before) });
    });
    res.json({ ok: true });
  }),
);
