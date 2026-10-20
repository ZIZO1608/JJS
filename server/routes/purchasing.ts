import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { items, locations, purchaseLines, purchases, suppliers } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { assertDayOpen, localDate, nextNumber, rateFor, roundMoney, round4, toUsd } from "../lib/biz.js";
import { crudRouter } from "../lib/crud.js";
import { h, HttpError, newId, notFound, nowIso, parse } from "../lib/util.js";
import { addBoxMove } from "../services/money.js";
import { addStock } from "../services/stock.js";

export const purchasingRouter = Router();

purchasingRouter.use(
  "/suppliers",
  crudRouter({
    table: suppliers,
    module: "purchasing",
    entity: "supplier",
    schema: z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().max(40).default(""), note: z.string().max(300).default(""), active: z.boolean().default(true) }),
  }),
);

const lineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().positive().max(1_000_000),
  unitPrice: z.number().min(0).max(100_000_000),
  locationId: z.string().min(1),
  expiresAt: z.string().nullable().optional(),
});
const purchaseSchema = z.object({
  supplierId: z.string().nullable().optional(),
  currency: z.enum(["USD", "SYP"]),
  lines: z.array(lineSchema).min(1).max(100),
  paid: z.number().min(0).default(0),
  boxId: z.string().nullable().optional(),
  note: z.string().max(300).default(""),
});

const outOf = (id: string) => {
  const p = db.select({ p: purchases, supplierName: suppliers.name }).from(purchases).leftJoin(suppliers, eq(purchases.supplierId, suppliers.id)).where(eq(purchases.id, id)).get();
  if (!p) return null;
  const lines = db
    .select({ line: purchaseLines, nameAr: items.nameAr, nameEn: items.nameEn, unitCode: items.unitCode, locAr: locations.nameAr, locEn: locations.nameEn })
    .from(purchaseLines)
    .innerJoin(items, eq(purchaseLines.itemId, items.id))
    .innerJoin(locations, eq(purchaseLines.locationId, locations.id))
    .where(eq(purchaseLines.purchaseId, id))
    .all();
  return { ...p.p, supplierName: p.supplierName, due: round4(p.p.total - p.p.paid), lines: lines.map((l) => ({ ...l.line, nameAr: l.nameAr, nameEn: l.nameEn, unitCode: l.unitCode, location: { nameAr: l.locAr, nameEn: l.locEn } })) };
};

purchasingRouter.get(
  "/",
  requirePerm("purchasing", "view"),
  h((req, res) => {
    const q = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.query);
    const rows = db
      .select({ p: purchases, supplierName: suppliers.name })
      .from(purchases)
      .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
      .where(and(isNull(purchases.deletedAt), q.from ? gte(purchases.date, q.from) : undefined, q.to ? lte(purchases.date, q.to) : undefined))
      .orderBy(desc(purchases.number))
      .limit(500)
      .all();
    res.json({ rows: rows.map((r) => ({ ...r.p, supplierName: r.supplierName, due: round4(r.p.total - r.p.paid) })) });
  }),
);

purchasingRouter.get(
  "/:id",
  requirePerm("purchasing", "view"),
  h((req, res) => {
    const p = outOf(String(req.params.id));
    if (!p) throw notFound("purchase");
    res.json({ purchase: p });
  }),
);

/** A purchase invoice: stock comes in (one batch per line), average costs update, and any payment leaves a box. */
purchasingRouter.post(
  "/",
  requirePerm("purchasing", "create"),
  h((req, res) => {
    const body = parse(purchaseSchema, req.body);
    const id = newId();
    db.transaction((tx) => {
      const date = localDate();
      assertDayOpen(tx, date);
      const rate = rateFor(body.currency);
      const total = roundMoney(body.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0), body.currency);
      if (body.paid > total + 0.001) throw new HttpError(400, "overpaid", "The paid amount is more than the total.");
      if (body.paid > 0 && !body.boxId) throw new HttpError(400, "box_required", "Choose which box the payment comes out of.");
      const number = nextNumber(tx, purchases, purchases.number);
      tx.insert(purchases)
        .values({ id, number, supplierId: body.supplierId ?? null, date, currency: body.currency, fxRate: rate, total, totalUsd: round4(toUsd(total, body.currency, rate)), paid: body.paid, paidFromBoxId: body.boxId ?? null, note: body.note, userId: req.user!.id })
        .run();
      const ctx = { userId: req.user!.id, date, refType: "purchase", refId: id };
      for (const l of body.lines) {
        const item = tx.select().from(items).where(and(eq(items.id, l.itemId), isNull(items.deletedAt))).get();
        if (!item) throw new HttpError(400, "item_not_found", "A line uses an item that does not exist.");
        const b = addStock(tx, { itemId: l.itemId, locationId: l.locationId, qty: l.qty, unitCostUsd: toUsd(l.unitPrice, body.currency, rate), type: "purchase", expiresAt: l.expiresAt ?? null }, ctx);
        tx.insert(purchaseLines).values({ id: newId(), purchaseId: id, itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, locationId: l.locationId, expiresAt: l.expiresAt ?? null, batchId: b.batchId }).run();
      }
      if (body.paid > 0 && body.boxId) addBoxMove(tx, { boxId: body.boxId, type: "purchase", amount: -body.paid, currency: body.currency, rate, refType: "purchase", refId: id, note: `Purchase #${number}`, userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "purchase", entityId: id, after: { number, total, currency: body.currency, lines: body.lines.length, paid: body.paid } });
    });
    res.status(201).json({ purchase: outOf(id) });
  }),
);

purchasingRouter.post(
  "/:id/pay",
  requirePerm("purchasing", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(z.object({ amount: z.number().positive(), boxId: z.string().min(1) }), req.body);
    db.transaction((tx) => {
      const p = tx.select().from(purchases).where(and(eq(purchases.id, id), isNull(purchases.deletedAt))).get();
      if (!p) throw notFound("purchase");
      if (body.amount > p.total - p.paid + 0.001) throw new HttpError(400, "overpaid", "That is more than what is still due.");
      const date = localDate();
      assertDayOpen(tx, date);
      const rate = rateFor(p.currency);
      tx.update(purchases).set({ paid: round4(p.paid + body.amount), updatedAt: nowIso(), syncedAt: null }).where(eq(purchases.id, id)).run();
      addBoxMove(tx, { boxId: body.boxId, type: "purchase", amount: -body.amount, currency: p.currency, rate, refType: "purchase", refId: id, note: `Purchase #${p.number}`, userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "purchase.payment", entityId: id, after: body });
    });
    res.json({ purchase: outOf(id) });
  }),
);
