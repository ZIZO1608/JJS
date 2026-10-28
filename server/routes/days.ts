import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { batches, businessDays, cashBoxes, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { currentRate, getDay, localDate, round4 } from "../lib/biz.js";
import { h, HttpError, nowIso, parse } from "../lib/util.js";
import { addBoxMove, boxBalance, handOverRepCash, systemBox } from "../services/money.js";
import { takeFromBatch } from "../services/stock.js";
import { periodReport, productionVsSales } from "../services/reports.js";
import { employees } from "../db/schema.js";
import { sql } from "drizzle-orm";

export const daysRouter = Router();
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function dayView(date: string) {
  const day = getDay(db, date);
  const main = systemBox(db, "main_cash");
  const reps = db.select().from(cashBoxes).where(eq(cashBoxes.kind, "rep")).all();
  // The main box over the day, the way JJ's counts it: opening + money in − money out = expected.
  const opening = db.get<{ s: number }>(sql`select coalesce(sum(amount),0) as s from box_moves where box_id = ${main.id} and deleted_at is null and business_date < ${date}`)?.s ?? 0;
  const moves = db.all<{ type: string; amount: number; n: number }>(sql`select type, sum(amount) as amount, count(*) as n from box_moves where box_id = ${main.id} and deleted_at is null and business_date = ${date} group by type`);
  // Each delivery person: cash held, deliveries, returns and road expenses today.
  const repRows = db
    .select()
    .from(employees)
    .where(and(eq(employees.isDeliveryRep, true), eq(employees.active, true)))
    .all()
    .map((e) => {
      const box = reps.find((b) => b.employeeId === e.id);
      const deliveries = db.get<{ n: number; items: number }>(sql`select count(*) as n, coalesce(sum(items_count),0) as items from orders where assigned_to = ${e.id} and business_date = ${date} and status != 'cancelled'`);
      const ret = db.get<{ n: number; usd: number }>(sql`select count(*) as n, coalesce(sum(total_usd),0) as usd from returns where rep_id = ${e.id} and business_date = ${date} and deleted_at is null`);
      const exp = db.get<{ usd: number }>(sql`select coalesce(sum(amount_usd),0) as usd from expenses where employee_id = ${e.id} and date = ${date} and deleted_at is null`);
      const cons = db.get<{ n: number }>(sql`select count(*) as n from consignments where rep_id = ${e.id} and status = 'open' and deleted_at is null`);
      return {
        employeeId: e.id,
        name: e.name,
        boxId: box?.id ?? null,
        cash: box ? round4(boxBalance(db, box.id)) : 0,
        currency: box?.currency ?? main.currency,
        deliveries: deliveries?.n ?? 0,
        items: deliveries?.items ?? 0,
        returns: ret?.n ?? 0,
        returnsUsd: round4(ret?.usd ?? 0),
        expensesUsd: round4(exp?.usd ?? 0),
        openConsignments: cons?.n ?? 0,
      };
    });
  return {
    cashFlow: { currency: main.currency, opening: round4(opening), moves: moves.map((m) => ({ ...m, amount: round4(m.amount) })), expected: round4(opening + moves.reduce((s, m) => s + m.amount, 0)) },
    repSettlement: repRows,
    production: productionVsSales(db, date, date).map(({ itemId: _i, ...r }) => r),
    day: { ...day, totals: day.totalsJson ? JSON.parse(day.totalsJson) : null, closedByName: day.closedBy ? (db.select({ n: users.name }).from(users).where(eq(users.id, day.closedBy)).get()?.n ?? null) : null },
    report: periodReport(db, date, date),
    mainBox: { id: main.id, nameAr: main.nameAr, nameEn: main.nameEn, currency: main.currency, expected: round4(boxBalance(db, main.id)) },
    // ready products still in the fridge: kept for tomorrow, or thrown away at close
    leftovers: db
      .all<{ id: string; batch_code: string; name_ar: string; name_en: string; qty_left: number; expires_at: string | null }>(
        sql`select b.id, b.batch_code, i.name_ar, i.name_en, b.qty_left, b.expires_at from batches b join items i on i.id = b.item_id
            where i.kind = 'product' and b.qty_left > 0 and b.deleted_at is null order by b.expires_at`,
      )
      .map((b) => ({ batchId: b.id, batchCode: b.batch_code, nameAr: b.name_ar, nameEn: b.name_en, qty: b.qty_left, expiresAt: b.expires_at, expired: !!b.expires_at && b.expires_at < nowIso() })),
    reps: reps.map((b) => ({ id: b.id, nameAr: b.nameAr, nameEn: b.nameEn, currency: b.currency, balance: round4(boxBalance(db, b.id)) })).filter((b) => Math.abs(b.balance) > 0.009),
  };
}

daysRouter.get(
  "/",
  requirePerm("daily_close", "view"),
  h((req, res) => {
    const q = parse(z.object({ from: dateParam.optional(), to: dateParam.optional() }), req.query);
    const rows = db
      .select()
      .from(businessDays)
      .where(and(q.from ? gte(businessDays.date, q.from) : undefined, q.to ? lte(businessDays.date, q.to) : undefined))
      .orderBy(desc(businessDays.date))
      .limit(120)
      .all();
    res.json({ rows: rows.map((d) => ({ ...d, totals: d.totalsJson ? JSON.parse(d.totalsJson) : null })) });
  }),
);

daysRouter.get(
  "/:date",
  requirePerm("daily_close", "view"),
  h((req, res) => res.json(dayView(parse(dateParam, req.params.date)))),
);

/** Count the main box, record any difference, freeze the day's numbers and lock the day. */
daysRouter.post(
  "/:date/close",
  requirePerm("daily_close", "create"),
  h((req, res) => {
    const date = parse(dateParam, req.params.date);
    const body = parse(
      z.object({
        counted: z.number().min(0),
        // merged steps: delivery cash received and leftovers thrown away, all in the same lock
        handoverBoxIds: z.array(z.string()).max(50).default([]),
        wasteBatchIds: z.array(z.string()).max(200).default([]),
      }),
      req.body,
    );
    if (date > localDate()) throw new HttpError(400, "future_day", "You cannot close a day that has not started.");
    db.transaction((tx) => {
      const day = getDay(tx, date);
      if (day.status === "closed") throw new HttpError(409, "day_closed", "This day is already closed.");
      if ((body.handoverBoxIds.length || body.wasteBatchIds.length) && date !== localDate()) throw new HttpError(400, "not_today", "Cash and leftovers can only be handled when closing today.");
      for (const boxId of body.handoverBoxIds) {
        const r = handOverRepCash(tx, boxId, req.user!.id, date, currentRate());
        if (r.amount > 0) writeAudit(tx, { userId: req.user!.id, action: "create", entity: "money.handover", entityId: boxId, after: { amount: r.amount, currency: r.currency } });
      }
      for (const batchId of body.wasteBatchIds) {
        const b = tx.select().from(batches).where(and(eq(batches.id, batchId), isNull(batches.deletedAt))).get();
        if (!b || b.qtyLeft <= 0) continue;
        const r = takeFromBatch(tx, { batchId: b.id, qty: b.qtyLeft, type: "waste" }, { userId: req.user!.id, date, refType: "waste", note: "Left over at day close" });
        writeAudit(tx, { userId: req.user!.id, action: "create", entity: "stock.waste", entityId: b.id, after: { batch: b.batchCode, qty: b.qtyLeft, costUsd: r.costUsd, at: "day close" } });
      }
      const main = systemBox(tx, "main_cash");
      const expected = round4(boxBalance(tx, main.id));
      const diff = round4(body.counted - expected);
      if (Math.abs(diff) > 0.001) addBoxMove(tx, { boxId: main.id, type: "count_adjust", amount: diff, currency: main.currency, rate: currentRate(), refType: "day_close", refId: day.id, note: diff < 0 ? "Cash short at close" : "Cash over at close", userId: req.user!.id, date });
      const rate = currentRate();
      const toUsd = (v: number) => (main.currency === "USD" ? v : rate ? v / rate : 0);
      tx.update(businessDays)
        .set({
          status: "closed",
          closedAt: nowIso(),
          closedBy: req.user!.id,
          expectedCashUsd: round4(toUsd(expected)),
          countedCashUsd: round4(toUsd(body.counted)),
          differenceUsd: round4(toUsd(diff)),
          totalsJson: JSON.stringify({ ...periodReport(tx, date, date), cash: { currency: main.currency, expected, counted: body.counted, difference: diff } }),
          updatedAt: nowIso(),
          syncedAt: null,
        })
        .where(eq(businessDays.id, day.id))
        .run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "day.close", entityId: day.id, after: { date, expected, counted: body.counted, difference: diff } });
    });
    res.json(dayView(date));
  }),
);

daysRouter.post(
  "/:date/reopen",
  requirePerm("daily_close", "edit"),
  h((req, res) => {
    const date = parse(dateParam, req.params.date);
    const day = getDay(db, date);
    if (day.status !== "closed") throw new HttpError(409, "day_open", "This day is not closed.");
    db.update(businessDays).set({ status: "open", reopenedAt: nowIso(), reopenedBy: req.user!.id, updatedAt: nowIso(), syncedAt: null }).where(eq(businessDays.id, day.id)).run();
    writeAudit(db, { userId: req.user!.id, action: "edit", entity: "day.reopen", entityId: day.id, after: { date } });
    res.json(dayView(date));
  }),
);
