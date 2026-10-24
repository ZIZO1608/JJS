import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { clients, employees, orderLines, orders, paymentMethods, payments, recurringOrders, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { localDate, round4 } from "../lib/biz.js";
import { getSetting } from "../lib/settings.js";
import { h, HttpError, notFound, nowIso, parse } from "../lib/util.js";
import { loyaltyStatus } from "../services/clients.js";
import { clientBalanceUsd } from "../services/money.js";
import { cancelOrder, createOrder, priceOrder } from "../services/orders.js";
import { notifyOrderStatus } from "../services/portal.js";

export const ordersRouter = Router();

const inputSchema = z.object({
  clientId: z.string().nullable().optional(),
  type: z.enum(["normal", "trial", "staff", "internal"]).default("normal"),
  employeeId: z.string().nullable().optional(),
  fulfilment: z.enum(["pickup", "delivery"]).default("pickup"),
  deliveryFee: z.number().min(0).nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  methodId: z.string().nullable().optional(),
  manualDiscountPct: z.number().min(0).max(100).optional(),
  useLoyalty: z.boolean().optional(),
  paidAmount: z.number().min(0).nullable().optional(),
  note: z.string().max(300).optional(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().min(1).max(1000), optionIds: z.array(z.string()).max(20).default([]) })).max(80),
});

const listSelect = () =>
  db
    .select({ o: orders, clientName: clients.name, methodAr: paymentMethods.nameAr, methodEn: paymentMethods.nameEn, userName: users.name, employeeName: employees.name })
    .from(orders)
    .leftJoin(clients, eq(orders.clientId, clients.id))
    .leftJoin(paymentMethods, eq(orders.methodId, paymentMethods.id))
    .leftJoin(users, eq(orders.userId, users.id))
    .leftJoin(employees, eq(orders.assignedTo, employees.id));

const listOut = (r: Awaited<ReturnType<ReturnType<typeof listSelect>["all"]>>[number]) => ({
  ...r.o,
  clientName: r.clientName,
  method: r.methodAr ? { nameAr: r.methodAr, nameEn: r.methodEn } : null,
  userName: r.userName,
  assignedName: r.employeeName,
});

ordersRouter.get(
  "/",
  requirePerm("orders", "view"),
  h((req, res) => {
    const q = parse(z.object({ date: z.string().optional(), clientId: z.string().optional(), status: z.string().optional() }), req.query);
    const rows = listSelect()
      .where(and(isNull(orders.deletedAt), q.clientId ? eq(orders.clientId, q.clientId) : eq(orders.businessDate, q.date ?? localDate()), q.status ? eq(orders.status, q.status as "confirmed") : undefined))
      .orderBy(desc(orders.number))
      .limit(500)
      .all();
    res.json({ rows: rows.map(listOut) });
  }),
);

/** Live price preview while the order is being built. */
ordersRouter.post(
  "/quote",
  requirePerm("orders", "create"),
  h((req, res) => {
    const body = parse(inputSchema, req.body);
    if (!body.lines.length) return res.json({ empty: true });
    res.json(db.transaction((tx) => priceOrder(tx, body)));
  }),
);

ordersRouter.post(
  "/",
  requirePerm("orders", "create"),
  h((req, res) => {
    const body = parse(inputSchema, req.body);
    if (body.manualDiscountPct && !req.user!.permissions.has("orders:edit")) throw new HttpError(403, "forbidden", "Your role cannot give a manual discount.");
    const out = db.transaction((tx) => {
      const r = createOrder(tx, body, req.user!.id);
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "order", entityId: r.id, after: { number: r.number, total: r.priced.total, currency: r.priced.currency, type: body.type, items: r.priced.itemsCount } });
      return r;
    });
    res.status(201).json({ id: out.id, number: out.number, receipt: receiptOf(out.id) });
  }),
);

ordersRouter.get(
  "/:id",
  requirePerm("orders", "view"),
  h((req, res) => {
    const r = listSelect().where(eq(orders.id, String(req.params.id))).get();
    if (!r) throw notFound("order");
    const lines = db.select().from(orderLines).where(eq(orderLines.orderId, r.o.id)).all();
    const pays = db.select().from(payments).where(and(eq(payments.orderId, r.o.id), isNull(payments.deletedAt))).all();
    res.json({ order: { ...listOut(r), lines: lines.map((l) => ({ ...l, options: JSON.parse(l.optionsJson) })), payments: pays, taxes: JSON.parse(r.o.taxesJson) } });
  }),
);

ordersRouter.get(
  "/:id/receipt",
  requirePerm("orders", "view"),
  h((req, res) => res.json({ receipt: receiptOf(String(req.params.id)) })),
);

ordersRouter.post(
  "/:id/cancel",
  requirePerm("orders", "delete"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(z.object({ reason: z.string().trim().max(200).default("") }), req.body ?? {});
    db.transaction((tx) => {
      const o = cancelOrder(tx, id, req.user!.id, body.reason);
      writeAudit(tx, { userId: req.user!.id, action: "delete", entity: "order", entityId: id, before: { number: o.number, total: o.total }, after: { reason: body.reason } });
      notifyOrderStatus(tx, id, "cancelled", body.reason);
    });
    res.json({ ok: true });
  }),
);

ordersRouter.post(
  "/:id/deliver",
  requirePerm("orders", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(z.object({ assignedTo: z.string().nullable().optional() }), req.body);
    const o = db.select().from(orders).where(eq(orders.id, id)).get();
    if (!o) throw notFound("order");
    if (o.status === "cancelled") throw new HttpError(409, "cancelled", "This order was cancelled.");
    db.transaction((tx) => {
      tx.update(orders)
        .set({ status: "delivered", assignedTo: body.assignedTo ?? o.assignedTo, updatedAt: nowIso(), syncedAt: null })
        .where(eq(orders.id, id))
        .run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "order", entityId: id, after: { status: "delivered" } });
      if (o.status !== "delivered") notifyOrderStatus(tx, id, "delivered");
    });
    res.json({ ok: true });
  }),
);

/** Regular clients due today (by weekday) and whether they already ordered. */
ordersRouter.get(
  "/recurring/due",
  requirePerm("orders", "view"),
  h((req, res) => {
    const date = String(req.query.date ?? localDate());
    const dow = new Date(`${date}T12:00:00`).getDay();
    const rows = db
      .select({ r: recurringOrders, clientName: clients.name })
      .from(recurringOrders)
      .innerJoin(clients, eq(recurringOrders.clientId, clients.id))
      .where(and(eq(recurringOrders.active, true), isNull(recurringOrders.deletedAt), eq(clients.active, true)))
      .orderBy(asc(clients.name))
      .all()
      .filter((x) => x.r.days.split(",").map(Number).includes(dow));
    res.json({
      rows: rows.map((x) => ({
        ...x.r,
        clientName: x.clientName,
        lines: JSON.parse(x.r.linesJson),
        orderedToday: !!db.select({ id: orders.id }).from(orders).where(and(eq(orders.clientId, x.r.clientId), eq(orders.businessDate, date), ne(orders.status, "cancelled"))).get(),
      })),
    });
  }),
);

/** Everything a printed receipt needs. */
export function receiptOf(orderId: string) {
  const r = listSelect().where(eq(orders.id, orderId)).get();
  if (!r) throw notFound("order");
  const o = r.o;
  const lines = db.select().from(orderLines).where(eq(orderLines.orderId, o.id)).all();
  const client = o.clientId ? db.select().from(clients).where(eq(clients.id, o.clientId)).get() : null;
  // Account before and after this invoice (moves written before it, then its own moves).
  let account: { beforeUsd: number; afterUsd: number; nowUsd: number } | null = null;
  if (client) {
    const before = db.get<{ s: number }>(sql`select coalesce(sum(amount_usd),0) as s from client_moves where client_id = ${client.id} and deleted_at is null and created_at < ${o.createdAt} and (order_id is null or order_id != ${o.id})`)?.s ?? 0;
    const own = db.get<{ s: number }>(sql`select coalesce(sum(amount_usd),0) as s from client_moves where order_id = ${o.id} and deleted_at is null`)?.s ?? 0;
    account = { beforeUsd: round4(before), afterUsd: round4(before + own), nowUsd: clientBalanceUsd(db, client.id) };
  }
  const remaining = o.paymentStatus === "credit" ? o.total : o.paymentStatus === "partial" ? round4(o.total - o.paidAmount) : 0;
  return {
    payment: { paid: o.paymentStatus === "paid" ? o.total : o.paidAmount, remaining },
    account,
    business: getSetting("business"),
    printing: getSetting("printing"),
    order: { ...listOut(r), taxes: JSON.parse(o.taxesJson) },
    lines: lines.map((l) => ({ ...l, options: JSON.parse(l.optionsJson) })),
    client: client ? { name: client.name, phone: client.phone, address: client.address, contactPerson: client.contactPerson, language: client.receiptLanguage, balanceUsd: clientBalanceUsd(db, client.id) } : null,
    loyalty: client && o.type === "normal" ? loyaltyStatus(db, client.id, o.businessDate) : null,
  };
}
