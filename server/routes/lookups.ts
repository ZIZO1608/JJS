import { and, asc, eq, isNull, max } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { LOOKUP_TYPES, type LookupType, type Module } from "../../shared/permissions.js";
import { db } from "../db/client.js";
import { lookups } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { can, requireAuth, requirePerm, type AuthUser } from "../lib/auth.js";
import { h, HttpError, newId, notFound, nowIso, parse } from "../lib/util.js";

export const lookupsRouter = Router();

/**
 * "+ Add new" lives inside everyday forms (an expense, a stock count…), so the person
 * filling that form may add to its list without full settings rights.
 */
const OWNER_MODULE: Record<LookupType, Module> = {
  expense_item: "expenses",
  expense_category: "expenses",
  unit: "warehouse",
  client_tag: "clients",
  waste_reason: "warehouse",
};
const canAdd = (u: AuthUser | undefined, t: LookupType) => can(u, "settings", "edit") || can(u, OWNER_MODULE[t], "create");

const typeSchema = z.enum(LOOKUP_TYPES);

const out = (l: typeof lookups.$inferSelect) => ({ id: l.id, listType: l.listType, nameAr: l.nameAr, nameEn: l.nameEn, sort: l.sort, active: l.active });

lookupsRouter.get(
  "/",
  requireAuth,
  h((req, res) => {
    const q = parse(z.object({ type: typeSchema, includeInactive: z.enum(["0", "1"]).default("0") }), req.query);
    const where = [eq(lookups.listType, q.type), isNull(lookups.deletedAt)];
    if (q.includeInactive === "0") where.push(eq(lookups.active, true));
    res.json({
      items: db.select().from(lookups).where(and(...where)).orderBy(asc(lookups.sort), asc(lookups.nameEn)).all().map(out),
      canAdd: canAdd(req.user, q.type),
    });
  }),
);

const createSchema = z.object({ listType: typeSchema, nameAr: z.string().trim().min(1).max(60), nameEn: z.string().trim().min(1).max(60) });

lookupsRouter.post(
  "/",
  requireAuth,
  h((req, res) => {
    const body = parse(createSchema, req.body);
    if (!canAdd(req.user, body.listType)) throw new HttpError(403, "forbidden", "Your role cannot add to this list.");
    const dup = db
      .select()
      .from(lookups)
      .where(and(eq(lookups.listType, body.listType), isNull(lookups.deletedAt), eq(lookups.nameEn, body.nameEn)))
      .get();
    if (dup) throw new HttpError(409, "duplicate", "This item is already in the list.", { item: out(dup) });
    const sort = (db.select({ m: max(lookups.sort) }).from(lookups).where(eq(lookups.listType, body.listType)).get()?.m ?? -1) + 1;
    const id = newId();
    db.transaction((tx) => {
      tx.insert(lookups).values({ id, ...body, sort }).run();
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: `lookup.${body.listType}`, entityId: id, after: body });
    });
    res.status(201).json({ item: out(db.select().from(lookups).where(eq(lookups.id, id)).get()!) });
  }),
);

const updateSchema = z.object({
  nameAr: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(60),
  active: z.boolean(),
  sort: z.number().int().min(0).max(10_000),
});

lookupsRouter.put(
  "/:id",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(updateSchema, req.body);
    const before = db.select().from(lookups).where(and(eq(lookups.id, id), isNull(lookups.deletedAt))).get();
    if (!before) throw notFound("list item");
    db.transaction((tx) => {
      tx.update(lookups).set({ ...body, updatedAt: nowIso(), syncedAt: null }).where(eq(lookups.id, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: `lookup.${before.listType}`, entityId: id, before: out(before), after: body });
    });
    res.json({ item: out(db.select().from(lookups).where(eq(lookups.id, id)).get()!) });
  }),
);

/** Soft delete: old records that used this item keep showing its name. */
lookupsRouter.delete(
  "/:id",
  requirePerm("settings", "delete"),
  h((req, res) => {
    const id = String(req.params.id);
    const before = db.select().from(lookups).where(and(eq(lookups.id, id), isNull(lookups.deletedAt))).get();
    if (!before) throw notFound("list item");
    db.transaction((tx) => {
      tx.update(lookups).set({ deletedAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(eq(lookups.id, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "delete", entity: `lookup.${before.listType}`, entityId: id, before: out(before) });
    });
    res.json({ ok: true });
  }),
);
