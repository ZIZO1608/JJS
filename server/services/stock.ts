import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { batches, items, locations, products, recipes, stockMoves, warehouses } from "../db/schema.js";
import { HttpError, newId, nowIso } from "../lib/util.js";
import { round4, type Q } from "../lib/biz.js";

/**
 * Stock rules
 * - Quantity of an item = the sum of its stock moves (the ledger). It can go below zero when
 *   the kitchen uses more than was recorded; a stock count fixes it.
 * - Batches carry location, production and expiry dates, and are used first-in-first-out.
 * - Cost: each item keeps a weighted average cost per unit in USD; a batch keeps its own cost.
 */

export const itemQty = (tx: Q, itemId: string) =>
  (tx.select({ q: sql<number>`coalesce(sum(${stockMoves.qty}),0)` }).from(stockMoves).where(and(eq(stockMoves.itemId, itemId), isNull(stockMoves.deletedAt))).get()?.q ?? 0);

export const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Short, scannable, unique batch code, e.g. B-1020-07. */
export function newBatchCode(tx: Q, prefix: string, date = new Date()) {
  const stem = `${prefix}-${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const n = tx.select({ n: sql<number>`count(*)` }).from(batches).where(sql`${batches.batchCode} like ${stem + "-%"}`).get()?.n ?? 0;
  return `${stem}-${pad(n + 1)}`;
}

interface Ctx {
  userId: string | null;
  date: string;
  refType?: string;
  refId?: string;
  note?: string;
}

/** Put new stock in: creates a batch, a ledger move and updates the average cost. */
export function addStock(
  tx: Q,
  p: { itemId: string; locationId: string; qty: number; unitCostUsd: number; type: "purchase" | "production" | "adjust" | "count"; producedAt?: string; expiresAt?: string | null; codePrefix?: string },
  ctx: Ctx,
) {
  if (!(p.qty > 0)) throw new HttpError(400, "invalid_qty", "Quantity must be more than zero.");
  const item = tx.select().from(items).where(eq(items.id, p.itemId)).get();
  if (!item) throw new HttpError(404, "not_found", "Item not found");
  const before = Math.max(0, itemQty(tx, p.itemId));
  const newAvg = before + p.qty > 0 ? (before * item.avgCostUsd + p.qty * p.unitCostUsd) / (before + p.qty) : p.unitCostUsd;
  tx.update(items).set({ avgCostUsd: round4(newAvg), updatedAt: nowIso(), syncedAt: null }).where(eq(items.id, p.itemId)).run();

  const batchId = newId();
  const code = newBatchCode(tx, p.codePrefix ?? (item.kind === "product" ? "B" : "S"));
  tx.insert(batches)
    .values({
      id: batchId,
      itemId: p.itemId,
      locationId: p.locationId,
      batchCode: code,
      producedAt: p.producedAt ?? nowIso(),
      expiresAt: p.expiresAt ?? null,
      qtyIn: p.qty,
      qtyLeft: p.qty,
      unitCostUsd: round4(p.unitCostUsd),
    })
    .run();
  tx.insert(stockMoves)
    .values({
      id: newId(),
      itemId: p.itemId,
      batchId,
      type: p.type,
      qty: p.qty,
      locationId: p.locationId,
      unitCostUsd: round4(p.unitCostUsd),
      refType: ctx.refType,
      refId: ctx.refId,
      note: ctx.note,
      userId: ctx.userId,
      businessDate: ctx.date,
    })
    .run();
  return { batchId, batchCode: code };
}

/**
 * Take stock out first-in-first-out (oldest expiry first, expired batches skipped).
 * Whatever is missing is still recorded (at average cost) so the ledger shows a shortage.
 * Returns the total cost in USD of what was taken.
 */
export function takeStock(tx: Q, p: { itemId: string; qty: number; type: "use" | "sale" | "waste" | "count"; reasonId?: string | null; skipExpired?: boolean }, ctx: Ctx) {
  if (p.qty <= 0) return 0;
  const item = tx.select().from(items).where(eq(items.id, p.itemId)).get();
  if (!item) throw new HttpError(404, "not_found", "Item not found");
  const nowStr = nowIso();
  const list = tx
    .select()
    .from(batches)
    .where(
      and(
        eq(batches.itemId, p.itemId),
        gt(batches.qtyLeft, 0),
        isNull(batches.deletedAt),
        p.skipExpired === false ? undefined : sql`(${batches.expiresAt} IS NULL OR ${batches.expiresAt} > ${nowStr})`,
      ),
    )
    .orderBy(sql`${batches.expiresAt} IS NULL`, asc(batches.expiresAt), asc(batches.producedAt))
    .all();
  let left = p.qty;
  let cost = 0;
  for (const b of list) {
    if (left <= 1e-9) break;
    const take = Math.min(left, b.qtyLeft);
    tx.update(batches).set({ qtyLeft: round4(b.qtyLeft - take), updatedAt: nowIso(), syncedAt: null }).where(eq(batches.id, b.id)).run();
    tx.insert(stockMoves)
      .values({ id: newId(), itemId: p.itemId, batchId: b.id, type: p.type, qty: -take, locationId: b.locationId, unitCostUsd: b.unitCostUsd, refType: ctx.refType, refId: ctx.refId, reasonId: p.reasonId ?? null, note: ctx.note, userId: ctx.userId, businessDate: ctx.date })
      .run();
    cost += take * b.unitCostUsd;
    left -= take;
  }
  if (left > 1e-9) {
    tx.insert(stockMoves)
      .values({ id: newId(), itemId: p.itemId, batchId: null, type: p.type, qty: -round4(left), unitCostUsd: item.avgCostUsd, refType: ctx.refType, refId: ctx.refId, reasonId: p.reasonId ?? null, note: ctx.note ?? "not enough recorded stock", userId: ctx.userId, businessDate: ctx.date })
      .run();
    cost += left * item.avgCostUsd;
  }
  return round4(cost);
}

/** Take a quantity out of one specific batch (waste of an expired batch, a transfer…). */
export function takeFromBatch(tx: Q, p: { batchId: string; qty: number; type: "waste" | "transfer" | "count" | "sale"; reasonId?: string | null }, ctx: Ctx) {
  const b = tx.select().from(batches).where(eq(batches.id, p.batchId)).get();
  if (!b) throw new HttpError(404, "not_found", "Batch not found");
  if (p.qty <= 0 || p.qty > b.qtyLeft + 1e-9) throw new HttpError(400, "invalid_qty", `Quantity must be between 0 and ${b.qtyLeft}.`);
  tx.update(batches).set({ qtyLeft: round4(b.qtyLeft - p.qty), updatedAt: nowIso(), syncedAt: null }).where(eq(batches.id, b.id)).run();
  tx.insert(stockMoves)
    .values({ id: newId(), itemId: b.itemId, batchId: b.id, type: p.type, qty: -p.qty, locationId: b.locationId, unitCostUsd: b.unitCostUsd, refType: ctx.refType, refId: ctx.refId, reasonId: p.reasonId ?? null, note: ctx.note, userId: ctx.userId, businessDate: ctx.date })
    .run();
  return { batch: b, costUsd: round4(p.qty * b.unitCostUsd) };
}

/** Undo every stock move written for a reference (used when an order is cancelled). */
export function reverseStock(tx: Q, refType: string, refId: string, ctx: Ctx) {
  const moves = tx.select().from(stockMoves).where(and(eq(stockMoves.refType, refType), eq(stockMoves.refId, refId), isNull(stockMoves.deletedAt))).all();
  for (const m of moves) {
    if (m.batchId) {
      const b = tx.select().from(batches).where(eq(batches.id, m.batchId)).get();
      if (b) tx.update(batches).set({ qtyLeft: round4(b.qtyLeft - m.qty), updatedAt: nowIso(), syncedAt: null }).where(eq(batches.id, b.id)).run();
    }
    tx.insert(stockMoves)
      .values({ id: newId(), itemId: m.itemId, batchId: m.batchId, type: "adjust", qty: -m.qty, locationId: m.locationId, unitCostUsd: m.unitCostUsd, refType, refId, note: "reversed", userId: ctx.userId, businessDate: ctx.date })
      .run();
  }
}

/** Ingredient lines for a product or an option. */
export const recipeOf = (tx: Q, key: { productId?: string; optionId?: string }) =>
  tx
    .select({ itemId: recipes.itemId, qty: recipes.qty, avgCostUsd: items.avgCostUsd })
    .from(recipes)
    .innerJoin(items, eq(recipes.itemId, items.id))
    .where(and(key.productId ? eq(recipes.productId, key.productId) : eq(recipes.optionId, key.optionId!), isNull(recipes.deletedAt)))
    .all();

/** Estimated cost of one unit from the recipe at today's average costs. */
export const recipeCostUsd = (tx: Q, key: { productId?: string; optionId?: string }) => round4(recipeOf(tx, key).reduce((s, r) => s + r.qty * r.avgCostUsd, 0));

/** Every product has a matching stock item (kind "product") for its fridge batches. */
export function ensureProductItem(tx: Q, productId: string) {
  const p = tx.select().from(products).where(eq(products.id, productId)).get()!;
  const existing = tx.select().from(items).where(eq(items.productId, productId)).get();
  if (existing) {
    tx.update(items).set({ nameAr: p.nameAr, nameEn: p.nameEn, active: p.active, updatedAt: nowIso(), syncedAt: null }).where(eq(items.id, existing.id)).run();
    return existing.id;
  }
  const id = newId();
  tx.insert(items).values({ id, kind: "product", productId, nameAr: p.nameAr, nameEn: p.nameEn, unitCode: "pc" }).run();
  return id;
}

/** The first fridge location, used as the default place for finished products. */
export function defaultFridgeLocation(tx: Q) {
  const row = tx
    .select({ id: locations.id })
    .from(locations)
    .innerJoin(warehouses, eq(locations.warehouseId, warehouses.id))
    .where(and(eq(warehouses.kind, "fridge"), isNull(locations.deletedAt), eq(locations.active, true)))
    .orderBy(asc(warehouses.sort), asc(locations.createdAt))
    .get();
  return row?.id ?? null;
}
