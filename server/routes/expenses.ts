import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { assets, boxMoves, cashBoxes, expenses, lookups, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { assertDayOpen, localDate, monthOf, rateFor, round4, toUsd } from "../lib/biz.js";
import { crudRouter } from "../lib/crud.js";
import { h, HttpError, newId, notFound, nowIso, parse } from "../lib/util.js";
import { addBoxMove } from "../services/money.js";

export const expensesRouter = Router();
export const assetsRouter = Router();

const expenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoryId: z.string().nullable().optional(),
  itemId: z.string().nullable().optional(),
  amount: z.number().positive().max(1_000_000_000),
  currency: z.enum(["USD", "SYP"]),
  boxId: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  note: z.string().max(300).default(""),
});

const listSelect = () =>
  db
    .select({ e: expenses, catAr: lookups.nameAr, catEn: lookups.nameEn, boxAr: cashBoxes.nameAr, boxEn: cashBoxes.nameEn, userName: users.name })
    .from(expenses)
    .leftJoin(lookups, eq(expenses.categoryId, lookups.id))
    .leftJoin(cashBoxes, eq(expenses.boxId, cashBoxes.id))
    .leftJoin(users, eq(expenses.userId, users.id));

const itemName = (id: string | null) => (id ? (db.select({ ar: lookups.nameAr, en: lookups.nameEn }).from(lookups).where(eq(lookups.id, id)).get() ?? null) : null);

expensesRouter.get(
  "/",
  requirePerm("expenses", "view"),
  h((req, res) => {
    const today = localDate();
    const q = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.query);
    const rows = listSelect()
      .where(and(isNull(expenses.deletedAt), gte(expenses.date, q.from ?? `${monthOf(today)}-01`), lte(expenses.date, q.to ?? today)))
      .orderBy(desc(expenses.date), desc(expenses.createdAt))
      .all();
    res.json({
      rows: rows.map((r) => {
        const it = itemName(r.e.itemId);
        return { ...r.e, category: r.catAr ? { nameAr: r.catAr, nameEn: r.catEn } : null, item: it ? { nameAr: it.ar, nameEn: it.en } : null, box: r.boxAr ? { nameAr: r.boxAr, nameEn: r.boxEn } : null, userName: r.userName };
      }),
    });
  }),
);

expensesRouter.post(
  "/",
  requirePerm("expenses", "create"),
  h((req, res) => {
    const body = parse(expenseSchema, req.body);
    const id = newId();
    db.transaction((tx) => {
      const date = body.date ?? localDate();
      assertDayOpen(tx, date);
      const rate = rateFor(body.currency);
      tx.insert(expenses)
        .values({ id, date, categoryId: body.categoryId ?? null, itemId: body.itemId ?? null, amount: body.amount, currency: body.currency, fxRate: rate, amountUsd: round4(toUsd(body.amount, body.currency, rate)), boxId: body.boxId ?? null, assetId: body.assetId ?? null, note: body.note, userId: req.user!.id })
        .run();
      if (body.boxId) addBoxMove(tx, { boxId: body.boxId, type: "expense", amount: -body.amount, currency: body.currency, rate, refType: "expense", refId: id, note: body.note, userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "expense", entityId: id, after: body });
    });
    res.status(201).json({ id });
  }),
);

expensesRouter.delete(
  "/:id",
  requirePerm("expenses", "delete"),
  h((req, res) => {
    const id = String(req.params.id);
    db.transaction((tx) => {
      const e = tx.select().from(expenses).where(and(eq(expenses.id, id), isNull(expenses.deletedAt))).get();
      if (!e) throw notFound("expense");
      assertDayOpen(tx, e.date);
      tx.update(expenses).set({ deletedAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(eq(expenses.id, id)).run();
      const mv = tx.select().from(boxMoves).where(and(eq(boxMoves.refType, "expense"), eq(boxMoves.refId, id), isNull(boxMoves.deletedAt))).get();
      if (mv) tx.update(boxMoves).set({ deletedAt: nowIso(), syncedAt: null }).where(eq(boxMoves.id, mv.id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "delete", entity: "expense", entityId: id, before: e });
    });
    res.json({ ok: true });
  }),
);

/* ---------- assets ---------- */
const monthsBetween = (from: string, to: string) => {
  const [a, b] = [from, to].map((d) => d.split("-").map(Number) as [number, number, number]);
  return Math.max(0, (b![0] - a![0]) * 12 + (b![1] - a![1]) + 1);
};
function assetOut(a: typeof assets.$inferSelect) {
  const monthlyUsd = round4((a.priceUsd - a.salvageUsd) / Math.max(1, a.lifeMonths));
  const used = Math.min(a.lifeMonths, monthsBetween(a.purchaseDate, localDate()));
  const accumulatedUsd = round4(monthlyUsd * used);
  return { ...a, monthlyUsd, monthsUsed: used, accumulatedUsd, bookValueUsd: round4(a.priceUsd - accumulatedUsd) };
}

assetsRouter.use(
  "/",
  crudRouter({
    table: assets,
    module: "assets",
    entity: "asset",
    schema: z.object({
      nameAr: z.string().trim().min(1).max(80),
      nameEn: z.string().trim().min(1).max(80),
      price: z.number().positive(),
      currency: z.enum(["USD", "SYP"]),
      purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lifeMonths: z.number().int().min(1).max(600),
      salvageUsd: z.number().min(0).default(0),
      note: z.string().max(300).default(""),
      active: z.boolean().default(true),
    }),
    map: assetOut,
    beforeSave: (_tx, body) => {
      const rate = rateFor(body.currency);
      const priceUsd = round4(toUsd(body.price, body.currency, rate));
      if (body.salvageUsd > priceUsd) throw new HttpError(400, "invalid_input", "The value at the end cannot be above the price.");
      return { fxRate: rate, priceUsd };
    },
  }),
);
