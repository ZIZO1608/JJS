import { and, asc, count, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { batches, items, locations, lookups, products, stockMoves, warehouses } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { assertDayOpen, localDate, round4 } from "../lib/biz.js";
import { crudRouter } from "../lib/crud.js";
import { h, HttpError, notFound, nowIso, parse } from "../lib/util.js";
import { addStock, defaultFridgeLocation, ensureProductItem, itemQty, recipeOf, takeFromBatch, takeStock } from "../services/stock.js";

export const stockRouter = Router();
const names = { nameAr: z.string().trim().min(1).max(80), nameEn: z.string().trim().min(1).max(80) };

stockRouter.use(
  "/warehouses",
  crudRouter({
    table: warehouses,
    module: "warehouse",
    entity: "warehouse",
    schema: z.object({ ...names, kind: z.enum(["store", "fridge", "freezer"]), sort: z.number().int().min(0).default(0), active: z.boolean().default(true) }),
    beforeDelete: (tx, row) => {
      const n = tx.select({ n: count() }).from(locations).where(and(eq(locations.warehouseId, row.id), isNull(locations.deletedAt))).get()?.n ?? 0;
      if (n) throw new HttpError(409, "in_use", "Delete or move its locations first.");
    },
  }),
);

stockRouter.use(
  "/locations",
  crudRouter({
    table: locations,
    module: "warehouse",
    entity: "location",
    schema: z.object({ warehouseId: z.string().min(1), ...names, active: z.boolean().default(true) }),
    beforeDelete: (tx, row) => {
      const n = tx.select({ n: count() }).from(batches).where(and(eq(batches.locationId, row.id), sql`${batches.qtyLeft} > 0`, isNull(batches.deletedAt))).get()?.n ?? 0;
      if (n) throw new HttpError(409, "in_use", "This location still has stock in it. Move it first.");
    },
  }),
);

/* ---------- items ---------- */
const itemSchema = z.object({
  kind: z.enum(["ingredient", "packaging"]),
  ...names,
  unitCode: z.enum(["kg", "g", "l", "ml", "pc"]),
  minLevel: z.number().min(0).default(0),
  avgCostUsd: z.number().min(0).default(0),
  active: z.boolean().default(true),
});

const itemOut = (i: typeof items.$inferSelect) => {
  const qty = round4(itemQty(db, i.id));
  return { ...i, qty, valueUsd: round4(Math.max(0, qty) * i.avgCostUsd), low: i.minLevel > 0 && qty < i.minLevel };
};

stockRouter.get(
  "/items",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const kind = req.query.kind ? String(req.query.kind) : null;
    const rows = db
      .select()
      .from(items)
      .where(and(isNull(items.deletedAt), kind ? eq(items.kind, kind as "ingredient") : undefined))
      .orderBy(asc(items.kind), asc(items.nameEn))
      .all();
    res.json({ rows: rows.map(itemOut) });
  }),
);

stockRouter.post(
  "/items",
  requirePerm("warehouse", "create"),
  h((req, res) => {
    const body = parse(itemSchema, req.body);
    const id = crypto.randomUUID();
    db.transaction((tx) => {
      tx.insert(items).values({ id, ...body }).run();
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "item", entityId: id, after: body });
    });
    res.status(201).json({ row: itemOut(db.select().from(items).where(eq(items.id, id)).get()!) });
  }),
);

stockRouter.put(
  "/items/:id",
  requirePerm("warehouse", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const before = db.select().from(items).where(and(eq(items.id, id), isNull(items.deletedAt))).get();
    if (!before) throw notFound("item");
    // Finished-product items are renamed from the menu; only their minimum level is edited here.
    const body = before.kind === "product" ? parse(z.object({ minLevel: z.number().min(0) }), req.body) : parse(itemSchema, req.body);
    db.transaction((tx) => {
      tx.update(items).set({ ...body, updatedAt: nowIso(), syncedAt: null }).where(eq(items.id, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "item", entityId: id, before, after: body });
    });
    res.json({ row: itemOut(db.select().from(items).where(eq(items.id, id)).get()!) });
  }),
);

stockRouter.delete(
  "/items/:id",
  requirePerm("warehouse", "delete"),
  h((req, res) => {
    const id = String(req.params.id);
    const before = db.select().from(items).where(and(eq(items.id, id), isNull(items.deletedAt))).get();
    if (!before) throw notFound("item");
    if (before.kind === "product") throw new HttpError(409, "product_item", "Delete the product from the menu instead.");
    db.transaction((tx) => {
      tx.update(items).set({ deletedAt: nowIso(), active: false, updatedAt: nowIso(), syncedAt: null }).where(eq(items.id, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "delete", entity: "item", entityId: id, before });
    });
    res.json({ ok: true });
  }),
);

/* ---------- batches ---------- */
export type BatchStatus = "expired" | "today" | "soon" | "fresh" | "none";
export function batchStatus(expiresAt: string | null, now = new Date()): BatchStatus {
  if (!expiresAt) return "none";
  const e = new Date(expiresAt);
  if (e <= now) return "expired";
  if (localDate(e) === localDate(now)) return "today";
  if (e.getTime() - now.getTime() <= 2 * 864e5) return "soon";
  return "fresh";
}

const batchSelect = () =>
  db
    .select({
      batch: batches,
      item: { id: items.id, kind: items.kind, nameAr: items.nameAr, nameEn: items.nameEn, unitCode: items.unitCode, productId: items.productId },
      location: { id: locations.id, nameAr: locations.nameAr, nameEn: locations.nameEn },
      warehouse: { id: warehouses.id, nameAr: warehouses.nameAr, nameEn: warehouses.nameEn, kind: warehouses.kind },
      allergens: products.allergens,
      productCode: products.code,
    })
    .from(batches)
    .innerJoin(items, eq(batches.itemId, items.id))
    .innerJoin(locations, eq(batches.locationId, locations.id))
    .innerJoin(warehouses, eq(locations.warehouseId, warehouses.id))
    .leftJoin(products, eq(items.productId, products.id));

const batchOut = (r: Awaited<ReturnType<ReturnType<typeof batchSelect>["all"]>>[number]) => ({
  ...r.batch,
  status: batchStatus(r.batch.expiresAt),
  item: r.item,
  location: r.location,
  warehouse: r.warehouse,
  allergens: r.allergens ?? "",
  productCode: r.productCode ?? null,
});

stockRouter.get(
  "/batches",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const q = parse(
      z.object({ warehouseId: z.string().optional(), locationId: z.string().optional(), kind: z.enum(["ingredient", "packaging", "product"]).optional(), status: z.string().optional(), includeEmpty: z.enum(["0", "1"]).default("0") }),
      req.query,
    );
    const conds: (SQL | undefined)[] = [isNull(batches.deletedAt)];
    if (q.includeEmpty === "0") conds.push(sql`${batches.qtyLeft} > 0`);
    if (q.warehouseId) conds.push(eq(warehouses.id, q.warehouseId));
    if (q.locationId) conds.push(eq(batches.locationId, q.locationId));
    if (q.kind) conds.push(eq(items.kind, q.kind));
    let rows = batchSelect()
      .where(and(...conds))
      .orderBy(sql`${batches.expiresAt} IS NULL`, asc(batches.expiresAt))
      .all()
      .map(batchOut);
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    res.json({ rows });
  }),
);

stockRouter.get(
  "/scan/:code",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const code = String(req.params.code).trim().toUpperCase();
    const r = batchSelect().where(eq(sql`upper(${batches.batchCode})`, code)).get();
    if (r) return res.json({ kind: "batch", batch: batchOut(r) });
    const p = db.select().from(products).where(and(eq(sql`upper(${products.code})`, code), isNull(products.deletedAt))).get();
    if (p) return res.json({ kind: "product", product: p });
    throw new HttpError(404, "not_found", `Nothing found for code ${code}.`);
  }),
);

const ctxOf = (req: { user?: { id: string } }, refType?: string, note?: string) => ({ userId: req.user!.id, date: localDate(), refType, note });

/** Opening stock or anything received without a purchase invoice. */
stockRouter.post(
  "/receive",
  requirePerm("warehouse", "create"),
  h((req, res) => {
    const body = parse(
      z.object({ itemId: z.string(), locationId: z.string(), qty: z.number().positive(), unitCostUsd: z.number().min(0).optional(), expiresAt: z.string().nullable().optional(), note: z.string().max(200).optional() }),
      req.body,
    );
    const item = db.select().from(items).where(eq(items.id, body.itemId)).get();
    if (!item) throw notFound("item");
    const out = db.transaction((tx) => {
      assertDayOpen(tx, localDate());
      const r = addStock(tx, { itemId: body.itemId, locationId: body.locationId, qty: body.qty, unitCostUsd: body.unitCostUsd ?? item.avgCostUsd, type: "adjust", expiresAt: body.expiresAt ?? null }, ctxOf(req, "receive", body.note));
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "stock.receive", entityId: r.batchId, after: body });
      return r;
    });
    res.status(201).json(out);
  }),
);

/** The kitchen made N of a product: ingredients go out (FIFO), a labelled fridge batch comes in. */
stockRouter.post(
  "/produce",
  requirePerm("warehouse", "create"),
  h((req, res) => {
    const body = parse(z.object({ productId: z.string(), qty: z.number().int().positive().max(5000), locationId: z.string().optional() }), req.body);
    const p = db.select().from(products).where(and(eq(products.id, body.productId), isNull(products.deletedAt))).get();
    if (!p) throw notFound("product");
    const out = db.transaction((tx) => {
      const date = localDate();
      assertDayOpen(tx, date);
      const itemId = ensureProductItem(tx, p.id);
      const locationId = body.locationId ?? defaultFridgeLocation(tx);
      if (!locationId) throw new HttpError(409, "no_fridge", "Add a fridge location first (Warehouse → Locations).");
      const ctx = { userId: req.user!.id, date, refType: "production", refId: itemId };
      let cost = 0;
      for (const line of recipeOf(tx, { productId: p.id })) cost += takeStock(tx, { itemId: line.itemId, qty: round4(line.qty * body.qty), type: "use" }, ctx);
      const now = new Date();
      const r = addStock(
        tx,
        { itemId, locationId, qty: body.qty, unitCostUsd: body.qty ? cost / body.qty : 0, type: "production", producedAt: now.toISOString(), expiresAt: new Date(now.getTime() + p.shelfLifeHours * 3600e3).toISOString(), codePrefix: "B" },
        ctx,
      );
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "stock.production", entityId: r.batchId, after: { product: p.nameEn, qty: body.qty, costUsd: round4(cost) } });
      return { ...r, costUsd: round4(cost) };
    });
    res.status(201).json(out);
  }),
);

stockRouter.post(
  "/waste",
  requirePerm("warehouse", "create"),
  h((req, res) => {
    const body = parse(z.object({ batchId: z.string(), qty: z.number().positive().optional(), reasonId: z.string().nullable().optional(), note: z.string().max(200).optional() }), req.body);
    const b = db.select().from(batches).where(eq(batches.id, body.batchId)).get();
    if (!b) throw notFound("batch");
    const out = db.transaction((tx) => {
      assertDayOpen(tx, localDate());
      if (body.reasonId && !tx.select().from(lookups).where(eq(lookups.id, body.reasonId)).get()) throw new HttpError(400, "bad_reason", "Unknown waste reason.");
      const r = takeFromBatch(tx, { batchId: b.id, qty: body.qty ?? b.qtyLeft, type: "waste", reasonId: body.reasonId ?? null }, ctxOf(req, "waste", body.note));
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "stock.waste", entityId: b.id, after: { batch: b.batchCode, qty: body.qty ?? b.qtyLeft, costUsd: r.costUsd } });
      return { costUsd: r.costUsd };
    });
    res.json(out);
  }),
);

stockRouter.post(
  "/transfer",
  requirePerm("warehouse", "create"),
  h((req, res) => {
    const body = parse(z.object({ batchId: z.string(), toLocationId: z.string(), qty: z.number().positive().optional() }), req.body);
    const b = db.select().from(batches).where(eq(batches.id, body.batchId)).get();
    if (!b) throw notFound("batch");
    if (!db.select().from(locations).where(eq(locations.id, body.toLocationId)).get()) throw notFound("location");
    const qty = body.qty ?? b.qtyLeft;
    db.transaction((tx) => {
      assertDayOpen(tx, localDate());
      const ctx = ctxOf(req, "transfer");
      if (qty >= b.qtyLeft - 1e-9) {
        // whole batch moves: keep its code so printed labels stay valid
        tx.update(batches).set({ locationId: body.toLocationId, updatedAt: nowIso(), syncedAt: null }).where(eq(batches.id, b.id)).run();
        tx.insert(stockMoves).values([
          { id: crypto.randomUUID(), itemId: b.itemId, batchId: b.id, type: "transfer", qty: -b.qtyLeft, locationId: b.locationId, unitCostUsd: b.unitCostUsd, refType: "transfer", userId: ctx.userId, businessDate: ctx.date },
          { id: crypto.randomUUID(), itemId: b.itemId, batchId: b.id, type: "transfer", qty: b.qtyLeft, locationId: body.toLocationId, unitCostUsd: b.unitCostUsd, refType: "transfer", userId: ctx.userId, businessDate: ctx.date },
        ]).run();
      } else {
        takeFromBatch(tx, { batchId: b.id, qty, type: "transfer" }, ctx);
        const avgBefore = tx.select({ a: items.avgCostUsd }).from(items).where(eq(items.id, b.itemId)).get()!.a;
        const r = addStock(tx, { itemId: b.itemId, locationId: body.toLocationId, qty, unitCostUsd: b.unitCostUsd, type: "adjust", producedAt: b.producedAt, expiresAt: b.expiresAt }, ctx);
        // the new part is a transfer, not new stock: relabel the move and keep the average cost unchanged
        tx.update(stockMoves).set({ type: "transfer" }).where(and(eq(stockMoves.batchId, r.batchId), eq(stockMoves.type, "adjust"))).run();
        tx.update(items).set({ avgCostUsd: avgBefore }).where(eq(items.id, b.itemId)).run();
      }
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "stock.transfer", entityId: b.id, after: { qty, to: body.toLocationId } });
    });
    res.json({ ok: true });
  }),
);

/** Stock count: set what is really there. One batch, or a whole item. */
stockRouter.post(
  "/count",
  requirePerm("warehouse", "edit"),
  h((req, res) => {
    const body = parse(z.object({ batchId: z.string().optional(), itemId: z.string().optional(), counted: z.number().min(0), locationId: z.string().optional() }), req.body);
    const out = db.transaction((tx) => {
      const date = localDate();
      assertDayOpen(tx, date);
      const ctx = { userId: req.user!.id, date, refType: "count" };
      if (body.batchId) {
        const b = tx.select().from(batches).where(eq(batches.id, body.batchId)).get();
        if (!b) throw notFound("batch");
        const diff = round4(body.counted - b.qtyLeft);
        if (diff < 0) takeFromBatch(tx, { batchId: b.id, qty: -diff, type: "count" }, ctx);
        if (diff > 0) {
          tx.update(batches).set({ qtyLeft: body.counted, updatedAt: nowIso(), syncedAt: null }).where(eq(batches.id, b.id)).run();
          tx.insert(stockMoves).values({ id: crypto.randomUUID(), itemId: b.itemId, batchId: b.id, type: "count", qty: diff, locationId: b.locationId, unitCostUsd: b.unitCostUsd, refType: "count", userId: ctx.userId, businessDate: date }).run();
        }
        writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "stock.count", entityId: b.id, before: { qty: b.qtyLeft }, after: { qty: body.counted } });
        return { difference: diff };
      }
      if (!body.itemId) throw new HttpError(400, "invalid_input", "Choose a batch or an item to count.");
      const item = tx.select().from(items).where(eq(items.id, body.itemId)).get();
      if (!item) throw notFound("item");
      const have = itemQty(tx, item.id);
      const diff = round4(body.counted - have);
      if (diff < 0) takeStock(tx, { itemId: item.id, qty: -diff, type: "count", skipExpired: false }, { ...ctx, note: "stock count" });
      if (diff > 0) {
        const loc = body.locationId ?? tx.select({ id: locations.id }).from(locations).where(isNull(locations.deletedAt)).get()?.id;
        if (!loc) throw new HttpError(409, "no_location", "Add a location first.");
        addStock(tx, { itemId: item.id, locationId: loc, qty: diff, unitCostUsd: item.avgCostUsd, type: "count" }, ctx);
      }
      // A count of 0 also clears the remaining batches so nothing ghost is left.
      if (body.counted === 0) tx.update(batches).set({ qtyLeft: 0, updatedAt: nowIso(), syncedAt: null }).where(and(eq(batches.itemId, item.id), sql`${batches.qtyLeft} > 0`)).run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "stock.count", entityId: item.id, before: { qty: have }, after: { qty: body.counted } });
      return { difference: diff };
    });
    res.json(out);
  }),
);

stockRouter.get(
  "/moves",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const q = parse(z.object({ itemId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), type: z.string().optional() }), req.query);
    const rows = db
      .select({ move: stockMoves, nameAr: items.nameAr, nameEn: items.nameEn, unitCode: items.unitCode, batchCode: batches.batchCode })
      .from(stockMoves)
      .innerJoin(items, eq(stockMoves.itemId, items.id))
      .leftJoin(batches, eq(stockMoves.batchId, batches.id))
      .where(
        and(
          isNull(stockMoves.deletedAt),
          q.itemId ? eq(stockMoves.itemId, q.itemId) : undefined,
          q.from ? gte(stockMoves.businessDate, q.from) : undefined,
          q.to ? lte(stockMoves.businessDate, q.to) : undefined,
          q.type ? eq(stockMoves.type, q.type as "use") : undefined,
        ),
      )
      .orderBy(desc(stockMoves.createdAt))
      .limit(300)
      .all();
    res.json({ rows: rows.map((r) => ({ ...r.move, nameAr: r.nameAr, nameEn: r.nameEn, unitCode: r.unitCode, batchCode: r.batchCode })) });
  }),
);
