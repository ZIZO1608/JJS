import { and, asc, count, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { boxMoves, cashBoxes, employees, paymentMethods, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { can, requireAuth, requirePerm } from "../lib/auth.js";
import { assertDayOpen, currentRate, localDate } from "../lib/biz.js";
import { crudRouter } from "../lib/crud.js";
import { h, HttpError, parse } from "../lib/util.js";
import { addBoxMove, boxBalance, getBox, systemBox } from "../services/money.js";

export const moneyRouter = Router();
const names = { nameAr: z.string().trim().min(1).max(60), nameEn: z.string().trim().min(1).max(60) };

const boxOut = (b: typeof cashBoxes.$inferSelect) => ({ ...b, balance: boxBalance(db, b.id), hasOpening: !!db.select({ id: boxMoves.id }).from(boxMoves).where(and(eq(boxMoves.boxId, b.id), eq(boxMoves.type, "opening"), isNull(boxMoves.deletedAt))).get() });

moneyRouter.get(
  "/boxes",
  requireAuth,
  h((req, res) => {
    const rows = db.select().from(cashBoxes).where(isNull(cashBoxes.deletedAt)).orderBy(asc(cashBoxes.createdAt)).all();
    // Balances are money information: only roles that close the day or manage settings see them.
    const seeBalances = can(req.user, "daily_close", "view") || can(req.user, "settings", "view");
    res.json({ rows: rows.map((b) => (seeBalances ? boxOut(b) : { ...b, balance: null })) });
  }),
);

const boxSchema = z.object({ ...names, kind: z.enum(["cash", "wallet", "rep", "bank"]), currency: z.enum(["USD", "SYP"]), employeeId: z.string().nullable().optional(), active: z.boolean().default(true) });
moneyRouter.use(
  "/boxes",
  crudRouter({
    table: cashBoxes,
    module: "settings",
    entity: "cash_box",
    schema: boxSchema,
    map: boxOut,
    beforeSave: (tx, body, before) => {
      if (before && before.currency !== body.currency) {
        const n = tx.select({ n: count() }).from(boxMoves).where(eq(boxMoves.boxId, before.id)).get()?.n ?? 0;
        if (n) throw new HttpError(409, "box_has_moves", "This box already has money movements, so its currency cannot change.");
      }
    },
    beforeDelete: (tx, row) => {
      if (row.systemKey) throw new HttpError(409, "system_box", "The main cash box and Sham Cash box cannot be deleted.");
      if (Math.abs(boxBalance(tx, row.id)) > 0.001) throw new HttpError(409, "box_not_empty", "Empty this box first (transfer its money).");
    },
  }),
);

moneyRouter.get(
  "/methods",
  requireAuth,
  h((_req, res) => res.json({ rows: db.select().from(paymentMethods).where(isNull(paymentMethods.deletedAt)).orderBy(asc(paymentMethods.sort)).all() })),
);
moneyRouter.use(
  "/methods",
  crudRouter({
    table: paymentMethods,
    module: "settings",
    entity: "payment_method",
    schema: z
      .object({ ...names, kind: z.enum(["box", "credit", "salary"]), boxId: z.string().nullable().optional(), sort: z.number().int().min(0).default(0), active: z.boolean().default(true) })
      .refine((m) => m.kind !== "box" || !!m.boxId, { message: "Choose the box this method pays into", path: ["boxId"] }),
    beforeDelete: (_tx, row) => {
      if (row.systemKey) throw new HttpError(409, "system_method", "Built-in payment methods can be hidden but not deleted.");
    },
  }),
);

moneyRouter.get(
  "/boxes/:id/moves",
  requirePerm("daily_close", "view"),
  h((req, res) => {
    const q = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.query);
    const box = getBox(db, String(req.params.id));
    const rows = db
      .select({ m: boxMoves, userName: users.name })
      .from(boxMoves)
      .leftJoin(users, eq(boxMoves.userId, users.id))
      .where(and(eq(boxMoves.boxId, box.id), isNull(boxMoves.deletedAt), q.from ? gte(boxMoves.businessDate, q.from) : undefined, q.to ? lte(boxMoves.businessDate, q.to) : undefined))
      .orderBy(desc(boxMoves.createdAt))
      .limit(500)
      .all();
    res.json({ box: boxOut(box), rows: rows.map((r) => ({ ...r.m, userName: r.userName })) });
  }),
);

moneyRouter.post(
  "/transfer",
  requirePerm("daily_close", "create"),
  h((req, res) => {
    const body = parse(z.object({ fromBoxId: z.string(), toBoxId: z.string(), amount: z.number().positive(), note: z.string().max(200).default("") }), req.body);
    if (body.fromBoxId === body.toBoxId) throw new HttpError(400, "same_box", "Choose two different boxes.");
    db.transaction((tx) => {
      const date = localDate();
      assertDayOpen(tx, date);
      const from = getBox(tx, body.fromBoxId);
      const rate = currentRate();
      if (body.amount > boxBalance(tx, from.id) + 0.001) throw new HttpError(409, "not_enough", "There is not that much money in the box.");
      addBoxMove(tx, { boxId: from.id, type: "transfer", amount: -body.amount, currency: from.currency, rate, refType: "transfer", note: body.note, userId: req.user!.id, date });
      addBoxMove(tx, { boxId: body.toBoxId, type: "transfer", amount: body.amount, currency: from.currency, rate, refType: "transfer", note: body.note, userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "money.transfer", after: body });
    });
    res.json({ ok: true });
  }),
);

/** The delivery person hands all the cash they collected to the main box. */
moneyRouter.post(
  "/handover",
  requirePerm("daily_close", "create"),
  h((req, res) => {
    const body = parse(z.object({ boxId: z.string() }), req.body);
    const out = db.transaction((tx) => {
      const date = localDate();
      assertDayOpen(tx, date);
      const rep = getBox(tx, body.boxId);
      if (rep.kind !== "rep") throw new HttpError(400, "not_rep_box", "This is not a delivery person's box.");
      const amount = boxBalance(tx, rep.id);
      if (amount <= 0) return { amount: 0 };
      const main = systemBox(tx, "main_cash");
      const rate = currentRate();
      addBoxMove(tx, { boxId: rep.id, type: "handover", amount: -amount, currency: rep.currency, rate, refType: "handover", userId: req.user!.id, date });
      addBoxMove(tx, { boxId: main.id, type: "handover", amount, currency: rep.currency, rate, refType: "handover", userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "money.handover", entityId: rep.id, after: { amount, currency: rep.currency } });
      return { amount };
    });
    res.json(out);
  }),
);

/** Set a box's starting balance once (when the system is first used). */
moneyRouter.post(
  "/opening",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const body = parse(z.object({ boxId: z.string(), amount: z.number() }), req.body);
    db.transaction((tx) => {
      const box = getBox(tx, body.boxId);
      const n = tx.select({ n: count() }).from(boxMoves).where(and(eq(boxMoves.boxId, box.id), eq(boxMoves.type, "opening"))).get()?.n ?? 0;
      if (n) throw new HttpError(409, "opening_exists", "This box already has an opening balance.");
      addBoxMove(tx, { boxId: box.id, type: "opening", amount: body.amount, currency: box.currency, rate: currentRate(), refType: "opening", userId: req.user!.id, date: localDate() });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "money.opening", entityId: box.id, after: body });
    });
    res.json({ ok: true });
  }),
);

/** The owner takes money out of a box for personal use (kept apart from expenses). */
moneyRouter.post(
  "/withdraw",
  requirePerm("daily_close", "edit"),
  h((req, res) => {
    const body = parse(z.object({ boxId: z.string(), amount: z.number().positive(), person: z.string().trim().max(80).default(""), note: z.string().max(200).default("") }), req.body);
    const out = db.transaction((tx) => {
      const box = getBox(tx, body.boxId);
      const date = localDate();
      assertDayOpen(tx, date);
      const m = addBoxMove(tx, { boxId: box.id, type: "withdrawal", amount: -body.amount, currency: box.currency, rate: currentRate(), refType: "withdrawal", note: [body.person, body.note].filter(Boolean).join(" · "), userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "money.withdrawal", entityId: m.id, after: body });
      return m;
    });
    res.status(201).json({ id: out.id });
  }),
);

/** Personal withdrawals in a period. */
moneyRouter.get(
  "/withdrawals",
  requirePerm("daily_close", "edit"),
  h((req, res) => {
    const q = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.query);
    const rows = db
      .select({ m: boxMoves, boxAr: cashBoxes.nameAr, boxEn: cashBoxes.nameEn })
      .from(boxMoves)
      .innerJoin(cashBoxes, eq(boxMoves.boxId, cashBoxes.id))
      .where(and(eq(boxMoves.type, "withdrawal"), isNull(boxMoves.deletedAt), q.from ? gte(boxMoves.businessDate, q.from) : undefined, q.to ? lte(boxMoves.businessDate, q.to) : undefined))
      .orderBy(desc(boxMoves.createdAt))
      .all()
      .map((x) => ({ ...x.m, box: { nameAr: x.boxAr, nameEn: x.boxEn } }));
    res.json({ rows, totalUsd: rows.reduce((s, r) => s - r.amountUsd, 0) });
  }),
);

/** Delivery people and their boxes (for assigning orders). */
moneyRouter.get(
  "/reps",
  requireAuth,
  h((_req, res) => {
    const reps = db.select().from(employees).where(and(eq(employees.isDeliveryRep, true), eq(employees.active, true), isNull(employees.deletedAt))).all();
    res.json({ rows: reps.map((e) => ({ id: e.id, name: e.name, boxId: db.select({ id: cashBoxes.id }).from(cashBoxes).where(and(eq(cashBoxes.employeeId, e.id), isNull(cashBoxes.deletedAt))).get()?.id ?? null })) });
  }),
);

