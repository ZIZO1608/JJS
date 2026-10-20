/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { Router, type Request } from "express";
import type { ZodTypeAny } from "zod";
import type { Module } from "../../shared/permissions.js";
import { db, type Tx } from "../db/client.js";
import { writeAudit } from "./audit.js";
import { requirePerm } from "./auth.js";
import { h, newId, notFound, nowIso, parse } from "./util.js";

/**
 * List / create / edit / soft-delete for a simple table, with permissions and audit.
 * Hooks let a table add checks (e.g. "a category with products cannot be deleted").
 */
export function crudRouter(opts: {
  table: any;
  module: Module;
  entity: string;
  schema: ZodTypeAny;
  /** View permission used for listing (defaults to module:view). */
  viewModule?: Module;
  orderBy?: any[];
  where?: (req: Request) => SQL | undefined;
  map?: (row: any) => any;
  beforeSave?: (tx: Tx, body: any, before: any | null, req: Request) => any | void;
  afterSave?: (tx: Tx, row: any, before: any | null, req: Request) => void;
  beforeDelete?: (tx: Tx, row: any, req: Request) => void;
}) {
  const r = Router();
  const t = opts.table;
  const map = opts.map ?? ((x: any) => x);
  const getRow = (id: string) => db.select().from(t).where(eq(t.id, id)).get() as any;

  r.get(
    "/",
    requirePerm(opts.viewModule ?? opts.module, "view"),
    h((req, res) => {
      const conds = [isNull(t.deletedAt), opts.where?.(req)].filter(Boolean) as SQL[];
      const order = opts.orderBy ?? (t.sort ? [asc(t.sort), asc(t.createdAt)] : [asc(t.createdAt)]);
      const rows = db.select().from(t).where(and(...conds)).orderBy(...order).all() as any[];
      res.json({ rows: rows.map(map) });
    }),
  );

  r.post(
    "/",
    requirePerm(opts.module, "create"),
    h((req, res) => {
      const body = parse(opts.schema, req.body);
      const id = newId();
      db.transaction((tx) => {
        const extra = opts.beforeSave?.(tx, body, null, req) ?? {};
        tx.insert(t).values({ id, ...body, ...extra }).run();
        const row = tx.select().from(t).where(eq(t.id, id)).get();
        opts.afterSave?.(tx, row, null, req);
        writeAudit(tx, { userId: req.user!.id, action: "create", entity: opts.entity, entityId: id, after: body });
      });
      res.status(201).json({ row: map(getRow(id)) });
    }),
  );

  r.put(
    "/:id",
    requirePerm(opts.module, "edit"),
    h((req, res) => {
      const id = String(req.params.id);
      const before = getRow(id);
      if (!before || before.deletedAt) throw notFound(opts.entity);
      const body = parse(opts.schema, req.body);
      db.transaction((tx) => {
        const extra = opts.beforeSave?.(tx, body, before, req) ?? {};
        tx.update(t).set({ ...body, ...extra, updatedAt: nowIso(), syncedAt: null }).where(eq(t.id, id)).run();
        const row = tx.select().from(t).where(eq(t.id, id)).get();
        opts.afterSave?.(tx, row, before, req);
        writeAudit(tx, { userId: req.user!.id, action: "edit", entity: opts.entity, entityId: id, before, after: body });
      });
      res.json({ row: map(getRow(id)) });
    }),
  );

  r.delete(
    "/:id",
    requirePerm(opts.module, "delete"),
    h((req, res) => {
      const id = String(req.params.id);
      const before = getRow(id);
      if (!before || before.deletedAt) throw notFound(opts.entity);
      db.transaction((tx) => {
        opts.beforeDelete?.(tx, before, req);
        tx.update(t).set({ deletedAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(eq(t.id, id)).run();
        writeAudit(tx, { userId: req.user!.id, action: "delete", entity: opts.entity, entityId: id, before });
      });
      res.json({ ok: true });
    }),
  );

  return r;
}
