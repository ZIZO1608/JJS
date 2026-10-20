import { and, asc, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db, type Tx } from "../db/client.js";
import { advances, cashBoxes, clients, employees, orders, payrollRuns, payslips, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { assertDayOpen, currentRate, localDate, monthEnd, rateFor, round4, toUsd } from "../lib/biz.js";
import { getSetting } from "../lib/settings.js";
import { crudRouter } from "../lib/crud.js";
import { h, HttpError, newId, notFound, nowIso, parse } from "../lib/util.js";
import { addBoxMove } from "../services/money.js";

export const peopleRouter = Router();

/** A delivery person gets their own cash box for the money they collect. */
function ensureRepBox(tx: Tx, e: typeof employees.$inferSelect) {
  const box = tx.select().from(cashBoxes).where(and(eq(cashBoxes.employeeId, e.id), eq(cashBoxes.kind, "rep"), isNull(cashBoxes.deletedAt))).get();
  if (e.isDeliveryRep && !box) {
    tx.insert(cashBoxes).values({ id: newId(), nameAr: `نقد مع ${e.name}`, nameEn: `Cash with ${e.name}`, kind: "rep", currency: getSetting("currency.default"), employeeId: e.id }).run();
  }
  if (box && box.active !== (e.isDeliveryRep && e.active)) tx.update(cashBoxes).set({ active: e.isDeliveryRep && e.active, updatedAt: nowIso(), syncedAt: null }).where(eq(cashBoxes.id, box.id)).run();
}

peopleRouter.use(
  "/employees",
  crudRouter({
    table: employees,
    module: "people",
    entity: "employee",
    schema: z.object({
      name: z.string().trim().min(1).max(80),
      phone: z.string().trim().max(40).default(""),
      jobTitle: z.string().trim().max(60).default(""),
      userId: z.string().nullable().optional(),
      payModel: z.enum(["fixed", "commission", "both"]),
      baseSalary: z.number().min(0).default(0),
      currency: z.enum(["USD", "SYP"]),
      commissionPerClientUsd: z.number().min(0).default(0),
      commissionPct: z.number().min(0).max(100).default(0),
      staffDiscountPct: z.number().min(0).max(100).default(30),
      isDeliveryRep: z.boolean().default(false),
      active: z.boolean().default(true),
    }),
    orderBy: [asc(employees.name)],
    afterSave: (tx, row) => ensureRepBox(tx, row),
    map: (e) => ({ ...e, userName: e.userId ? (db.select({ n: users.name }).from(users).where(eq(users.id, e.userId)).get()?.n ?? null) : null }),
  }),
);

/* ---------- advances (سلف) ---------- */
peopleRouter.get(
  "/advances",
  requirePerm("people", "view"),
  h((req, res) => {
    const rows = db
      .select({ a: advances, name: employees.name })
      .from(advances)
      .innerJoin(employees, eq(advances.employeeId, employees.id))
      .where(and(isNull(advances.deletedAt), req.query.open === "1" ? sql`${advances.remainingUsd} > 0.001` : undefined))
      .orderBy(desc(advances.date))
      .limit(300)
      .all();
    res.json({ rows: rows.map((r) => ({ ...r.a, employeeName: r.name })) });
  }),
);

peopleRouter.post(
  "/advances",
  requirePerm("people", "create"),
  h((req, res) => {
    const body = parse(z.object({ employeeId: z.string(), amount: z.number().positive(), currency: z.enum(["USD", "SYP"]), boxId: z.string().nullable().optional(), note: z.string().max(200).default("") }), req.body);
    const id = newId();
    db.transaction((tx) => {
      const date = localDate();
      assertDayOpen(tx, date);
      if (!tx.select().from(employees).where(eq(employees.id, body.employeeId)).get()) throw notFound("employee");
      const rate = rateFor(body.currency);
      const usd = round4(toUsd(body.amount, body.currency, rate));
      tx.insert(advances).values({ id, employeeId: body.employeeId, date, amount: body.amount, currency: body.currency, fxRate: rate, amountUsd: usd, remainingUsd: usd, boxId: body.boxId ?? null, note: body.note }).run();
      if (body.boxId) addBoxMove(tx, { boxId: body.boxId, type: "advance", amount: -body.amount, currency: body.currency, rate, refType: "advance", refId: id, note: body.note, userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "advance", entityId: id, after: body });
    });
    res.status(201).json({ id });
  }),
);

/* ---------- payroll ---------- */
const monthParam = z.string().regex(/^\d{4}-\d{2}$/);

/** What each employee earns this month: base + commission − advances − staff purchases. */
function computePayroll(tx: Tx | typeof db, month: string) {
  const from = `${month}-01`;
  const to = monthEnd(from);
  const rate = currentRate();
  return tx
    .select()
    .from(employees)
    .where(and(isNull(employees.deletedAt), eq(employees.active, true)))
    .orderBy(asc(employees.name))
    .all()
    .map((e) => {
      const base = e.payModel === "commission" ? 0 : e.currency === "USD" ? e.baseSalary : rate ? e.baseSalary / rate : 0;
      const delivered = tx
        .select({ usd: sql<number>`coalesce(sum(${orders.totalUsd}),0)`, n: sql<number>`count(*)` })
        .from(orders)
        .where(and(eq(orders.assignedTo, e.id), ne(orders.status, "cancelled"), ne(orders.type, "trial"), gte(orders.businessDate, from), lte(orders.businessDate, to)))
        .get()!;
      // clients converted this month whose free trial this person delivered
      const convertedClients =
        tx.get<{ n: number }>(sql`select count(*) as n from ${clients} c where c.converted_at >= ${from} and c.converted_at <= ${to + "~"}
          and exists (select 1 from orders o where o.client_id = c.id and o.type = 'trial' and o.assigned_to = ${e.id} and o.status != 'cancelled')`)?.n ?? 0;
      const commission = e.payModel === "fixed" ? 0 : delivered.usd * (e.commissionPct / 100) + convertedClients * e.commissionPerClientUsd;
      const staff = tx
        .select({ usd: sql<number>`coalesce(sum(${orders.totalUsd}),0)` })
        .from(orders)
        .where(and(eq(orders.employeeId, e.id), eq(orders.paymentStatus, "salary"), ne(orders.status, "cancelled"), gte(orders.businessDate, from), lte(orders.businessDate, to)))
        .get()!.usd;
      const openAdv = tx.select().from(advances).where(and(eq(advances.employeeId, e.id), isNull(advances.deletedAt), sql`${advances.remainingUsd} > 0.001`)).orderBy(asc(advances.date)).all();
      const advTotal = openAdv.reduce((s, a) => s + a.remainingUsd, 0);
      const gross = base + commission - staff;
      const advDeducted = Math.max(0, Math.min(advTotal, gross));
      return {
        employeeId: e.id,
        name: e.name,
        payModel: e.payModel,
        currency: e.currency,
        baseUsd: round4(base),
        deliveredSalesUsd: round4(delivered.usd),
        deliveredOrders: delivered.n,
        convertedClients,
        commissionUsd: round4(commission),
        staffPurchasesUsd: round4(staff),
        openAdvancesUsd: round4(advTotal),
        advancesUsd: round4(advDeducted),
        netUsd: round4(Math.max(0, gross - advDeducted)),
        advances: openAdv,
      };
    });
}

peopleRouter.get(
  "/payroll/:month",
  requirePerm("people", "view"),
  h((req, res) => {
    const month = parse(monthParam, req.params.month);
    const run = db.select().from(payrollRuns).where(eq(payrollRuns.month, month)).get();
    if (run?.status === "paid") {
      const slips = db.select({ s: payslips, name: employees.name }).from(payslips).innerJoin(employees, eq(payslips.employeeId, employees.id)).where(eq(payslips.runId, run.id)).all();
      return res.json({ month, status: "paid", run, rows: slips.map((x) => ({ ...x.s, name: x.name, details: JSON.parse(x.s.detailsJson) })) });
    }
    res.json({ month, status: "preview", rows: computePayroll(db, month).map(({ advances: _a, ...r }) => r) });
  }),
);

peopleRouter.post(
  "/payroll/:month/pay",
  requirePerm("people", "edit"),
  h((req, res) => {
    const month = parse(monthParam, req.params.month);
    const body = parse(z.object({ boxId: z.string() }), req.body);
    db.transaction((tx) => {
      const date = localDate();
      assertDayOpen(tx, date);
      const existing = tx.select().from(payrollRuns).where(eq(payrollRuns.month, month)).get();
      if (existing?.status === "paid") throw new HttpError(409, "already_paid", "Salaries for this month are already paid.");
      const runId = existing?.id ?? newId();
      if (!existing) tx.insert(payrollRuns).values({ id: runId, month }).run();
      const rate = currentRate();
      for (const r of computePayroll(tx, month)) {
        tx.insert(payslips)
          .values({ id: newId(), runId, employeeId: r.employeeId, baseUsd: r.baseUsd, commissionUsd: r.commissionUsd, advancesUsd: r.advancesUsd, staffPurchasesUsd: r.staffPurchasesUsd, netUsd: r.netUsd, detailsJson: JSON.stringify({ deliveredSalesUsd: r.deliveredSalesUsd, deliveredOrders: r.deliveredOrders, convertedClients: r.convertedClients }) })
          .run();
        // settle advances oldest first
        let left = r.advancesUsd;
        for (const a of r.advances) {
          if (left <= 0.0001) break;
          const take = Math.min(left, a.remainingUsd);
          tx.update(advances).set({ remainingUsd: round4(a.remainingUsd - take), updatedAt: nowIso(), syncedAt: null }).where(eq(advances.id, a.id)).run();
          left -= take;
        }
        if (r.netUsd > 0) addBoxMove(tx, { boxId: body.boxId, type: "salary", amount: -r.netUsd, currency: "USD", rate, refType: "payroll", refId: runId, note: `${r.name} ${month}`, userId: req.user!.id, date });
      }
      tx.update(payrollRuns).set({ status: "paid", paidAt: nowIso(), boxId: body.boxId, updatedAt: nowIso(), syncedAt: null }).where(eq(payrollRuns.id, runId)).run();
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "payroll", entityId: runId, after: { month } });
    });
    res.json({ ok: true });
  }),
);
