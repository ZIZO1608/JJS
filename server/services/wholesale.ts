import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Currency } from "../../shared/money.js";
import {
  clientMoves,
  clients,
  consignmentLines,
  consignments,
  items,
  lookups,
  orderLines,
  orders,
  paymentMethods,
  productionRuns,
  products,
  purchases,
  returnLines,
  returns,
  suppliers,
} from "../db/schema.js";
import { assertDayOpen, currentRate, localDate, nextNumber, rateFor, roundMoney, round4, toUsd, type Q } from "../lib/biz.js";
import { getSetting } from "../lib/settings.js";
import { HttpError, newId, nowIso } from "../lib/util.js";
import { addBoxMove, addClientMove, clientBalanceUsd } from "./money.js";
import { createOrder, priceOrder } from "./orders.js";
import { ensureProductItem, itemQty, produceBatch, recipeCostUsd, recipeOf, returnProductStock, reverseStock, takeProductStock } from "./stock.js";

const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 864e5);

/* =====================================================================
   Client ageing: who is late paying
   ===================================================================== */

/**
 * Payments settle the oldest charges first. What is still unpaid, and since when?
 * overdueDays counts past the client's payment terms.
 */
export function clientAging(tx: Q, clientId: string, today = localDate()) {
  const c = tx.select().from(clients).where(eq(clients.id, clientId)).get();
  const moves = tx.select().from(clientMoves).where(and(eq(clientMoves.clientId, clientId), isNull(clientMoves.deletedAt))).orderBy(asc(clientMoves.createdAt)).all();
  const open: { date: string; usd: number }[] = [];
  let credit = 0;
  for (const m of moves) {
    if (m.amountUsd < 0) {
      let owed = -m.amountUsd;
      const use = Math.min(credit, owed);
      credit -= use;
      owed -= use;
      if (owed > 0.0001) open.push({ date: m.businessDate, usd: owed });
    } else {
      let pay = m.amountUsd;
      while (pay > 0.0001 && open.length) {
        const first = open[0]!;
        const use = Math.min(pay, first.usd);
        first.usd -= use;
        pay -= use;
        if (first.usd <= 0.0001) open.shift();
      }
      credit += pay;
    }
  }
  const balanceUsd = clientBalanceUsd(tx, clientId);
  const oldest = open[0]?.date ?? null;
  const days = oldest ? daysBetween(oldest, today) : 0;
  const terms = c?.paymentTermsDays ?? 0;
  return { balanceUsd, oldestUnpaidDate: oldest, daysOutstanding: days, termsDays: terms, overdueDays: oldest && balanceUsd < -0.009 ? Math.max(0, days - terms) : 0 };
}

/* =====================================================================
   Returns
   ===================================================================== */

export interface ReturnInput {
  clientId?: string | null;
  orderId?: string | null;
  consignmentId?: string | null;
  repId?: string | null;
  lines: { productId: string; qty: number; action: "restock" | "waste"; expiresAt?: string | null }[];
  settlement: "credit" | "refund" | "none";
  boxId?: string | null;
  note?: string;
}

/** Goods come back from a client: stock back or written off, and the client is credited or refunded. */
export function createReturn(tx: Q, input: ReturnInput, userId: string) {
  const date = localDate();
  assertDayOpen(tx, date);
  if (!input.lines.length) throw new HttpError(400, "empty_return", "Add at least one returned item.");
  let currency: Currency = getSetting("currency.default");
  let rate: number | null = null;
  let clientId = input.clientId ?? null;
  const priceOf = new Map<string, { unit: number; costUsd: number; nameAr: string; nameEn: string }>();

  if (input.orderId) {
    const o = tx.select().from(orders).where(and(eq(orders.id, input.orderId), isNull(orders.deletedAt))).get();
    if (!o || o.status === "cancelled") throw new HttpError(400, "order_not_found", "Choose a valid invoice.");
    currency = o.currency;
    rate = o.fxRate;
    clientId = clientId ?? o.clientId;
    const ratio = o.subtotal > 0 ? 1 - o.discount / o.subtotal : 1;
    for (const l of tx.select().from(orderLines).where(eq(orderLines.orderId, o.id)).all()) {
      const already = tx.get<{ q: number }>(sql`select coalesce(sum(rl.qty),0) as q from return_lines rl join returns r on r.id = rl.return_id where r.order_id = ${o.id} and rl.product_id = ${l.productId} and r.deleted_at is null`)?.q ?? 0;
      priceOf.set(l.productId, { unit: roundMoney((l.lineTotal / l.qty) * ratio, currency), costUsd: l.unitCostUsd, nameAr: l.nameAr, nameEn: l.nameEn });
      const wanted = input.lines.filter((x) => x.productId === l.productId).reduce((s, x) => s + x.qty, 0);
      if (wanted > l.qty - already) throw new HttpError(400, "return_too_many", `Only ${l.qty - already} of ${l.nameEn} can still be returned from this invoice.`);
    }
  } else if (input.consignmentId) {
    const c = tx.select().from(consignments).where(eq(consignments.id, input.consignmentId)).get();
    if (!c) throw new HttpError(400, "consignment_not_found", "Consignment not found.");
    currency = c.currency;
    rate = c.fxRate;
    clientId = c.clientId;
    for (const l of tx.select().from(consignmentLines).where(eq(consignmentLines.consignmentId, c.id)).all())
      priceOf.set(l.productId, { unit: l.unitPrice, costUsd: l.unitCostUsd, nameAr: l.nameAr, nameEn: l.nameEn });
  } else {
    // A return with no invoice: priced at what this client pays today.
    const q = priceOrder(tx, { clientId, type: "normal", fulfilment: "pickup", useLoyalty: false, lines: input.lines.map((l) => ({ productId: l.productId, qty: l.qty, optionIds: [] })) });
    currency = q.currency;
    rate = q.rate;
    q.lines.forEach((l) => priceOf.set(l.productId, { unit: roundMoney(l.unitPrice * (1 - q.discountPct / 100), currency), costUsd: recipeCostUsd(tx, { productId: l.productId }), nameAr: l.nameAr, nameEn: l.nameEn }));
  }
  if (input.settlement === "credit" && !clientId) throw new HttpError(400, "client_required", "Choose the client to credit.");
  if (input.settlement === "refund" && !input.boxId) throw new HttpError(400, "box_required", "Choose the box the refund comes from.");
  rate = rate ?? rateFor(currency);

  const id = newId();
  const number = nextNumber(tx, returns, returns.number);
  const ctx = { userId, date, refType: "return", refId: id };
  const reasonId = tx.select({ id: lookups.id }).from(lookups).where(and(eq(lookups.listType, "waste_reason"), eq(lookups.nameEn, "Returned by client"), isNull(lookups.deletedAt))).get()?.id ?? null;
  let total = 0;
  let cost = 0;
  const rows: (typeof returnLines.$inferInsert)[] = [];
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new HttpError(400, "invalid_qty", "Quantities must be whole numbers.");
    const p = priceOf.get(l.productId);
    if (!p) throw new HttpError(400, "not_on_invoice", "One of the returned items is not on that invoice.");
    const r = returnProductStock(tx, { productId: l.productId, qty: l.qty, unitCostUsd: p.costUsd, action: l.action, expiresAt: l.expiresAt, reasonId }, ctx);
    const lineTotal = roundMoney(p.unit * l.qty, currency);
    total += lineTotal;
    cost += p.costUsd * l.qty;
    rows.push({ id: newId(), returnId: id, productId: l.productId, nameAr: p.nameAr, nameEn: p.nameEn, qty: l.qty, unitPrice: p.unit, lineTotal, unitCostUsd: p.costUsd, action: l.action, batchId: r.batchId });
  }
  total = roundMoney(total, currency);
  const totalUsd = round4(toUsd(total, currency, rate));
  tx.insert(returns)
    .values({ id, number, businessDate: date, clientId, orderId: input.orderId ?? null, consignmentId: input.consignmentId ?? null, currency, fxRate: rate, total, totalUsd, costUsd: round4(cost), settlement: input.settlement, boxId: input.boxId ?? null, repId: input.repId ?? null, note: input.note ?? "", userId })
    .run();
  for (const r of rows) tx.insert(returnLines).values(r).run();
  if (input.settlement === "credit" && clientId && total > 0) addClientMove(tx, { clientId, type: "return", amount: total, currency, rate, orderId: input.orderId ?? undefined, note: `Return R${number}`, userId, date });
  if (input.settlement === "refund" && input.boxId && total > 0) addBoxMove(tx, { boxId: input.boxId, type: "refund", amount: -total, currency, rate, refType: "return", refId: id, note: `Return R${number}`, userId, date });
  return { id, number, total, totalUsd, currency };
}

/* =====================================================================
   Consignment (goods left with a shop; it pays for what it sold)
   ===================================================================== */

export function deliverConsignment(tx: Q, input: { clientId: string; repId?: string | null; note?: string; lines: { productId: string; qty: number }[] }, userId: string) {
  const date = localDate();
  assertDayOpen(tx, date);
  if (!input.lines.length) throw new HttpError(400, "empty_order", "Add at least one item.");
  const client = tx.select().from(clients).where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt))).get();
  if (!client) throw new HttpError(400, "client_unavailable", "Choose an active client.");
  // Agreed price = what this client pays today, after their discount.
  const q = priceOrder(tx, { clientId: client.id, type: "normal", fulfilment: "delivery", useLoyalty: false, lines: input.lines.map((l) => ({ ...l, optionIds: [] })) });
  const id = newId();
  const number = nextNumber(tx, consignments, consignments.number);
  const ctx = { userId, date, refType: "consignment", refId: id };
  tx.insert(consignments).values({ id, number, businessDate: date, clientId: client.id, repId: input.repId ?? null, status: "open", currency: q.currency, fxRate: q.rate, note: input.note ?? "", userId }).run();
  let valueTotal = 0;
  q.lines.forEach((l) => {
    const unit = roundMoney(l.unitPrice * (1 - q.discountPct / 100), q.currency);
    const { costUsd } = takeProductStock(tx, { productId: l.productId, qty: l.qty, type: "consign" }, ctx);
    tx.insert(consignmentLines).values({ id: newId(), consignmentId: id, productId: l.productId, nameAr: l.nameAr, nameEn: l.nameEn, qty: l.qty, unitPrice: unit, unitCostUsd: round4(costUsd / l.qty) }).run();
    valueTotal += unit * l.qty;
  });
  return { id, number, value: roundMoney(valueTotal, q.currency), currency: q.currency };
}

/**
 * The rep counts what is left at the shop. Returned goods come back (fridge or waste),
 * the sold part becomes an invoice at the agreed prices, paid now or on account.
 */
export function settleConsignment(
  tx: Q,
  id: string,
  input: { lines: { productId: string; returnedQty: number; action: "restock" | "waste" }[]; methodId?: string | null; paidAmount?: number | null; note?: string },
  userId: string,
) {
  const c = tx.select().from(consignments).where(and(eq(consignments.id, id), isNull(consignments.deletedAt))).get();
  if (!c) throw new HttpError(404, "not_found", "Consignment not found");
  if (c.status !== "open") throw new HttpError(409, "consignment_closed", "This consignment is already settled or cancelled.");
  const lines = tx.select().from(consignmentLines).where(eq(consignmentLines.consignmentId, id)).all();
  const returnsIn: ReturnInput["lines"] = [];
  const sold: { productId: string; qty: number; unit: number; cost: number }[] = [];
  for (const l of lines) {
    const r = input.lines.find((x) => x.productId === l.productId);
    const back = r?.returnedQty ?? 0;
    if (back < 0 || back > l.qty || !Number.isInteger(back)) throw new HttpError(400, "invalid_qty", `Returned ${l.nameEn} must be between 0 and ${l.qty}.`);
    if (back > 0) returnsIn.push({ productId: l.productId, qty: back, action: r?.action ?? getSetting("orders").defaultReturnAction });
    tx.update(consignmentLines).set({ returnedQty: back, updatedAt: nowIso(), syncedAt: null }).where(eq(consignmentLines.id, l.id)).run();
    if (l.qty - back > 0) sold.push({ productId: l.productId, qty: l.qty - back, unit: l.unitPrice, cost: l.unitCostUsd });
  }
  let returnId: string | null = null;
  if (returnsIn.length) returnId = createReturn(tx, { consignmentId: id, repId: c.repId, lines: returnsIn, settlement: "none", note: `Consignment C${c.number}` }, userId).id;
  let orderId: string | null = null;
  let orderNumber: number | null = null;
  if (sold.length) {
    const methodId = input.methodId ?? tx.select({ id: paymentMethods.id }).from(paymentMethods).where(eq(paymentMethods.systemKey, "credit")).get()?.id ?? null;
    const r = createOrder(
      tx,
      { clientId: c.clientId, type: "normal", fulfilment: "delivery", assignedTo: c.repId, methodId, paidAmount: input.paidAmount, note: input.note ?? `Consignment C${c.number}`, lines: sold.map((s) => ({ productId: s.productId, qty: s.qty, optionIds: [] })) },
      userId,
      { presetPrices: sold.map((s) => s.unit), presetCosts: sold.map((s) => s.cost), presetCurrency: c.currency, presetRate: c.fxRate, consignmentId: id },
    );
    orderId = r.id;
    orderNumber = r.number;
  }
  tx.update(consignments).set({ status: "settled", settledAt: nowIso(), orderId, returnId, updatedAt: nowIso(), syncedAt: null }).where(eq(consignments.id, id)).run();
  return { orderId, orderNumber, returnId, soldQty: sold.reduce((s, x) => s + x.qty, 0), returnedQty: returnsIn.reduce((s, x) => s + x.qty, 0) };
}

export function cancelConsignment(tx: Q, id: string, userId: string) {
  const c = tx.select().from(consignments).where(eq(consignments.id, id)).get();
  if (!c) throw new HttpError(404, "not_found", "Consignment not found");
  if (c.status !== "open") throw new HttpError(409, "consignment_closed", "Only an open consignment can be cancelled.");
  assertDayOpen(tx, c.businessDate);
  reverseStock(tx, "consignment", id, { userId, date: c.businessDate });
  tx.update(consignments).set({ status: "cancelled", updatedAt: nowIso(), syncedAt: null }).where(eq(consignments.id, id)).run();
  return c;
}

/* =====================================================================
   Production runs (the morning batch)
   ===================================================================== */

/** What a run needs before it is confirmed: ingredients needed vs in stock, and the cost. */
export function previewProduction(tx: Q, lines: { productId: string; qty: number }[]) {
  const need = new Map<string, number>();
  let totalCost = 0;
  const prods = lines.map((l) => {
    const p = tx.select().from(products).where(and(eq(products.id, l.productId), isNull(products.deletedAt))).get();
    if (!p) throw new HttpError(400, "product_unavailable", "One of the products does not exist.");
    for (const r of recipeOf(tx, { productId: p.id })) need.set(r.itemId, (need.get(r.itemId) ?? 0) + r.qty * l.qty);
    const unit = recipeCostUsd(tx, { productId: p.id });
    totalCost += unit * l.qty;
    return { productId: p.id, nameAr: p.nameAr, nameEn: p.nameEn, qty: l.qty, unitCostUsd: unit, costUsd: round4(unit * l.qty) };
  });
  const materials = [...need.entries()].map(([itemId, qty]) => {
    const it = tx.select().from(items).where(eq(items.id, itemId)).get()!;
    const have = round4(itemQty(tx, itemId));
    return { itemId, nameAr: it.nameAr, nameEn: it.nameEn, kind: it.kind, unitCode: it.unitCode, need: round4(qty), have, short: round4(Math.max(0, qty - have)), costUsd: round4(qty * it.avgCostUsd) };
  });
  return { products: prods, materials, itemsCount: lines.reduce((s, l) => s + l.qty, 0), costUsd: round4(totalCost), shortages: materials.filter((m) => m.short > 0).length };
}

export function createProductionRun(tx: Q, input: { lines: { productId: string; qty: number }[]; employeeId?: string | null; locationId?: string | null; note?: string }, userId: string) {
  const date = localDate();
  assertDayOpen(tx, date);
  if (!input.lines.length) throw new HttpError(400, "empty_run", "Add at least one product.");
  const id = newId();
  const number = nextNumber(tx, productionRuns, productionRuns.number);
  tx.insert(productionRuns).values({ id, number, businessDate: date, employeeId: input.employeeId ?? null, note: input.note ?? "", userId }).run();
  let cost = 0;
  let count = 0;
  const made = input.lines.map((l) => {
    const r = produceBatch(tx, { productId: l.productId, qty: l.qty, locationId: input.locationId, runId: id }, { userId, date, refType: "production_run", refId: id });
    cost += r.costUsd;
    count += l.qty;
    return { productId: l.productId, nameAr: r.product.nameAr, nameEn: r.product.nameEn, qty: l.qty, batchId: r.batchId, batchCode: r.batchCode, costUsd: r.costUsd };
  });
  tx.update(productionRuns).set({ costUsd: round4(cost), itemsCount: count }).where(eq(productionRuns.id, id)).run();
  return { id, number, batches: made, costUsd: round4(cost), itemsCount: count };
}

/* =====================================================================
   Suppliers: what we owe
   ===================================================================== */

export function supplierDue(tx: Q, supplierId: string, today = localDate()) {
  const s = tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).get();
  const openingDueUsd = round4(Math.max(0, (s?.openingUsd ?? 0) - (s?.openingPaidUsd ?? 0)));
  const list = tx.select().from(purchases).where(and(eq(purchases.supplierId, supplierId), isNull(purchases.deletedAt))).orderBy(asc(purchases.date), asc(purchases.number)).all();
  let purchasesDueUsd = 0;
  let overdueUsd = 0;
  const open = list
    .filter((p) => p.total - p.paid > 0.001)
    .map((p) => {
      const dueUsd = round4((p.total - p.paid) * (p.total > 0 ? p.totalUsd / p.total : 0));
      purchasesDueUsd += dueUsd;
      const dueDate = p.dueDate ?? (s?.paymentTermsDays ? addDaysStr(p.date, s.paymentTermsDays) : p.date);
      const late = dueDate < today;
      if (late) overdueUsd += dueUsd;
      return { id: p.id, number: p.number, date: p.date, supplierRef: p.supplierRef, currency: p.currency, total: p.total, paid: p.paid, due: round4(p.total - p.paid), dueUsd, dueDate, late };
    });
  return { openingDueUsd, purchasesDueUsd: round4(purchasesDueUsd), totalDueUsd: round4(openingDueUsd + purchasesDueUsd), overdueUsd: round4(overdueUsd), open };
}

const addDaysStr = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return localDate(x);
};

/** Pay a supplier without picking invoices: the opening balance first, then the oldest invoices. */
export function paySupplier(tx: Q, supplierId: string, p: { amount: number; currency: Currency; boxId: string; note?: string }, userId: string) {
  const date = localDate();
  assertDayOpen(tx, date);
  const s = tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).get();
  if (!s) throw new HttpError(404, "not_found", "Supplier not found");
  const due = supplierDue(tx, supplierId);
  const rate = rateFor(p.currency, ...due.open.map((o) => o.currency), s.openingCurrency);
  let leftUsd = round4(toUsd(p.amount, p.currency, rate));
  if (leftUsd > due.totalDueUsd + 0.01) throw new HttpError(400, "overpaid", "That is more than what we owe this supplier.");
  if (due.openingDueUsd > 0 && leftUsd > 0) {
    const use = Math.min(leftUsd, due.openingDueUsd);
    tx.update(suppliers).set({ openingPaidUsd: round4(s.openingPaidUsd + use), updatedAt: nowIso(), syncedAt: null }).where(eq(suppliers.id, s.id)).run();
    leftUsd -= use;
  }
  for (const o of due.open) {
    if (leftUsd <= 0.0001) break;
    const useUsd = Math.min(leftUsd, o.dueUsd);
    const pr = tx.select().from(purchases).where(eq(purchases.id, o.id)).get()!;
    const inCcy = useUsd >= o.dueUsd - 0.0001 ? o.due : roundMoney(useUsd * (pr.total / pr.totalUsd), pr.currency);
    tx.update(purchases).set({ paid: round4(pr.paid + inCcy), updatedAt: nowIso(), syncedAt: null }).where(eq(purchases.id, o.id)).run();
    leftUsd -= useUsd;
  }
  addBoxMove(tx, { boxId: p.boxId, type: "purchase", amount: -p.amount, currency: p.currency, rate, refType: "supplier", refId: supplierId, note: p.note || `Payment to ${s.name}`, userId, date });
  return supplierDue(tx, supplierId);
}

/* =====================================================================
   Helpers shared by routes
   ===================================================================== */

/** Value of goods still sitting at consignment shops (at agreed prices), in USD. */
export function consignmentOpenValueUsd(tx: Q) {
  const r = tx.get<{ v: number }>(
    sql`select coalesce(sum(case when c.currency = 'USD' then cl.unit_price * cl.qty else cl.unit_price * cl.qty / c.fx_rate end),0) as v from consignment_lines cl join consignments c on c.id = cl.consignment_id where c.status = 'open' and c.deleted_at is null`,
  );
  return round4(r?.v ?? 0);
}

export const productItemId = (tx: Q, productId: string) => ensureProductItem(tx, productId);
export { currentRate };
