import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { assets, boxMoves, cashBoxes, employees, expenses, lookups, recurringExpenses, users } from "../db/schema.js";
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
  /** paid: money left a box now · due: owed, to be paid later */
  status: z.enum(["paid", "due"]).default("paid"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paidBy: z.string().trim().max(80).default(""),
  beneficiary: z.string().trim().max(80).default(""),
  photo: z.string().max(1_500_000).default(""),
  employeeId: z.string().nullable().optional(),
});

/* ---------- recurring (monthly) expenses ---------- */
expensesRouter.use(
  "/recurring",
  crudRouter({
    table: recurringExpenses,
    module: "expenses",
    entity: "recurring_expense",
    schema: z.object({
      categoryId: z.string().nullable().optional(),
      itemId: z.string().nullable().optional(),
      amount: z.number().positive(),
      currency: z.enum(["USD", "SYP"]),
      dayOfMonth: z.number().int().min(1).max(28),
      beneficiary: z.string().trim().max(80).default(""),
      note: z.string().max(300).default(""),
      active: z.boolean().default(true),
    }),
  }),
);

/**
 * On or after its day each month, a recurring expense becomes a "due" expense (once per month).
 * Run at start and every hour.
 */
export function generateRecurringExpenses(today = localDate()) {
  const month = monthOf(today);
  const day = Number(today.slice(8, 10));
  let made = 0;
  db.transaction((tx) => {
    for (const r of tx.select().from(recurringExpenses).where(and(isNull(recurringExpenses.deletedAt), eq(recurringExpenses.active, true))).all()) {
      if (r.lastMonth === month || day < r.dayOfMonth) continue;
      const rate = r.currency === "SYP" ? (() => { try { return rateFor("SYP"); } catch { return null; } })() : null;
      if (r.currency === "SYP" && !rate) continue; // wait until a rate exists
      const date = `${month}-${String(r.dayOfMonth).padStart(2, "0")}`;
      tx.insert(expenses)
        .values({ id: newId(), date, categoryId: r.categoryId, itemId: r.itemId, amount: r.amount, currency: r.currency, fxRate: rate, amountUsd: round4(toUsd(r.amount, r.currency, rate)), note: r.note, status: "due", dueDate: date, beneficiary: r.beneficiary, recurringId: r.id, userId: null })
        .run();
      tx.update(recurringExpenses).set({ lastMonth: month, updatedAt: nowIso(), syncedAt: null }).where(eq(recurringExpenses.id, r.id)).run();
      made++;
    }
  });
  return made;
}

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
    const q = parse(z.object({ from: z.string().optional(), to: z.string().optional(), status: z.enum(["paid", "due"]).optional() }), req.query);
    const rows = listSelect()
      .where(and(isNull(expenses.deletedAt), q.status === "due" ? undefined : gte(expenses.date, q.from ?? `${monthOf(today)}-01`), q.status === "due" ? undefined : lte(expenses.date, q.to ?? today), q.status ? eq(expenses.status, q.status) : undefined))
      .orderBy(desc(expenses.date), desc(expenses.createdAt))
      .all();
    res.json({
      rows: rows.map((r) => {
        const it = itemName(r.e.itemId);
        const emp = r.e.employeeId ? (db.select({ n: employees.name }).from(employees).where(eq(employees.id, r.e.employeeId)).get()?.n ?? null) : null;
        return { ...r.e, photo: r.e.photo ? "yes" : "", category: r.catAr ? { nameAr: r.catAr, nameEn: r.catEn } : null, item: it ? { nameAr: it.ar, nameEn: it.en } : null, box: r.boxAr ? { nameAr: r.boxAr, nameEn: r.boxEn } : null, userName: r.userName, employeeName: emp };
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
      const paid = body.status === "paid";
      tx.insert(expenses)
        .values({
          id, date, categoryId: body.categoryId ?? null, itemId: body.itemId ?? null, amount: body.amount, currency: body.currency, fxRate: rate, amountUsd: round4(toUsd(body.amount, body.currency, rate)),
          boxId: paid ? (body.boxId ?? null) : null, assetId: body.assetId ?? null, note: body.note, userId: req.user!.id,
          status: body.status, dueDate: paid ? null : (body.dueDate ?? date), paidDate: paid ? date : null, paidBy: body.paidBy, beneficiary: body.beneficiary, photo: body.photo, employeeId: body.employeeId ?? null,
        })
        .run();
      if (paid && body.boxId) addBoxMove(tx, { boxId: body.boxId, type: "expense", amount: -body.amount, currency: body.currency, rate, refType: "expense", refId: id, note: body.note, userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "expense", entityId: id, after: body });
    });
    res.status(201).json({ id });
  }),
);

/** Create this month's due expenses now (also runs by itself every hour). */
expensesRouter.post(
  "/recurring/run",
  requirePerm("expenses", "create"),
  h((_req, res) => res.json({ created: generateRecurringExpenses() })),
);

/** Pay an expense that was recorded as due. */
expensesRouter.post(
  "/:id/pay",
  requirePerm("expenses", "create"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(z.object({ boxId: z.string().nullable().optional(), paidBy: z.string().trim().max(80).default("") }), req.body);
    db.transaction((tx) => {
      const e = tx.select().from(expenses).where(and(eq(expenses.id, id), isNull(expenses.deletedAt))).get();
      if (!e) throw notFound("expense");
      if (e.status === "paid") throw new HttpError(409, "already_paid", "This expense is already paid.");
      const date = localDate();
      assertDayOpen(tx, date);
      tx.update(expenses).set({ status: "paid", paidDate: date, boxId: body.boxId ?? null, paidBy: body.paidBy || e.paidBy, updatedAt: nowIso(), syncedAt: null }).where(eq(expenses.id, id)).run();
      if (body.boxId) addBoxMove(tx, { boxId: body.boxId, type: "expense", amount: -e.amount, currency: e.currency, rate: rateFor(e.currency), refType: "expense", refId: id, note: e.note, userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "expense.payment", entityId: id, after: body });
    });
    res.json({ ok: true });
  }),
);

/** The receipt photo of an expense. */
expensesRouter.get(
  "/:id/photo",
  requirePerm("expenses", "view"),
  h((req, res) => {
    const e = db.select({ photo: expenses.photo }).from(expenses).where(eq(expenses.id, String(req.params.id))).get();
    if (!e?.photo) throw notFound("photo");
    res.json({ photo: e.photo });
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
