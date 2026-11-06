import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { clients, employees, orderLines, orders, paymentMethods, payments, recurringOrders, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { can, requirePerm, type AuthUser } from "../lib/auth.js";
import { localDate, round4 } from "../lib/biz.js";
import { getSetting } from "../lib/settings.js";
import { h, HttpError, notFound, nowIso, parse } from "../lib/util.js";
import { loyaltyStatus } from "../services/clients.js";
import { clientBalanceUsd } from "../services/money.js";
import { assertOrderQtys, assignDelivery, cancelOrder, createOrder, deliverOrder, owedLookup, priceOrder } from "../services/orders.js";
import { notifyDeliveryAssigned, notifyOrderStatus } from "../services/portal.js";

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
  manualDiscountAmount: z.number().min(0).max(1_000_000_000).optional(),
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

/**
 * The deliveries screen: orders still to hand over (open) or handed over today (done). No costs here:
 * whoever delivers needs the client, the address and what is left to collect.
 */
ordersRouter.get(
  "/deliveries",
  requirePerm("orders", "edit"),
  h((req, res) => {
    const q = parse(z.object({ status: z.enum(["open", "done"]).default("open") }), req.query);
    const mine = db.select({ id: employees.id }).from(employees).where(and(eq(employees.userId, req.user!.id), isNull(employees.deletedAt))).get();
    const startOfToday = new Date(`${localDate()}T00:00:00`).toISOString();
    const rows = db
      .select({ o: orders, clientName: clients.name, clientPhone: clients.phone, clientAddress: clients.address, assignedName: employees.name, assignedPhone: employees.phone })
      .from(orders)
      .leftJoin(clients, eq(orders.clientId, clients.id))
      .leftJoin(employees, eq(orders.assignedTo, employees.id))
      .where(and(isNull(orders.deletedAt), ne(orders.type, "internal"), q.status === "open" ? eq(orders.status, "confirmed") : and(eq(orders.status, "delivered"), gte(orders.deliveredAt, startOfToday))))
      .orderBy(q.status === "open" ? asc(orders.number) : desc(orders.deliveredAt))
      .limit(200)
      .all();
    const lines = rows.length ? db.select({ orderId: orderLines.orderId, nameAr: orderLines.nameAr, nameEn: orderLines.nameEn, qty: orderLines.qty }).from(orderLines).where(inArray(orderLines.orderId, rows.map((r) => r.o.id))).all() : [];
    const owed = owedLookup(db);
    res.json({
      myEmployeeId: mine?.id ?? null,
      rows: rows.map((r) => ({
        id: r.o.id,
        number: r.o.number,
        businessDate: r.o.businessDate,
        createdAt: r.o.createdAt,
        fulfilment: r.o.fulfilment,
        status: r.o.status,
        paymentStatus: r.o.paymentStatus,
        total: r.o.total,
        currency: r.o.currency,
        paidAmount: r.o.paidAmount,
        remaining: owed(r.o),
        deliveredAt: r.o.deliveredAt,
        deliveryCollected: r.o.deliveryCollected,
        note: r.o.note,
        source: r.o.source,
        clientId: r.o.clientId,
        clientName: r.clientName,
        clientPhone: r.clientPhone,
        clientAddress: r.clientAddress,
        assignedTo: r.o.assignedTo,
        assignedName: r.assignedName,
        assignedPhone: r.assignedPhone,
        lines: lines.filter((l) => l.orderId === r.o.id),
      })),
    });
  }),
);

/** Live price preview while the order is being built. */
ordersRouter.post(
  "/quote",
  requirePerm("orders", "create"),
  h((req, res) => {
    const body = parse(inputSchema, req.body);
    if (!body.lines.length) return res.json({ empty: true });
    assertOrderQtys(body.lines);
    res.json(db.transaction((tx) => priceOrder(tx, body)));
  }),
);

ordersRouter.post(
  "/",
  requirePerm("orders", "create"),
  h((req, res) => {
    const body = parse(inputSchema, req.body);
    assertOrderQtys(body.lines);
    if ((body.manualDiscountPct || body.manualDiscountAmount) && !req.user!.permissions.has("orders:edit")) throw new HttpError(403, "forbidden", "Your role cannot give a manual discount.");
    const out = db.transaction((tx) => {
      const r = createOrder(tx, body, req.user!.id);
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "order", entityId: r.id, after: { number: r.number, total: r.priced.total, currency: r.priced.currency, type: body.type, items: r.priced.itemsCount } });
      return r;
    });
    res.status(201).json({ id: out.id, number: out.number, receipt: receiptOf(out.id) });
  }),
);

/** How long whoever cannot edit orders may still take back their own mistake. */
const OWN_CANCEL_MINUTES = 30;

/** Cancelling puts stock back and wipes cash or debt, so without orders:edit it covers only your own unpaid, undelivered order, right after taking it. */
function mayCancel(user: AuthUser | undefined, o: typeof orders.$inferSelect) {
  if (!can(user, "orders", "delete")) return false;
  if (can(user, "orders", "edit")) return true;
  return o.userId === user?.id && o.status === "confirmed" && o.paidAmount <= 0 && Date.now() - Date.parse(o.createdAt) < OWN_CANCEL_MINUTES * 60_000;
}

ordersRouter.get(
  "/:id",
  requirePerm("orders", "view"),
  h((req, res) => {
    const r = listSelect().where(eq(orders.id, String(req.params.id))).get();
    if (!r) throw notFound("order");
    const lines = db.select().from(orderLines).where(eq(orderLines.orderId, r.o.id)).all();
    const pays = db.select().from(payments).where(and(eq(payments.orderId, r.o.id), isNull(payments.deletedAt))).all();
    res.json({ order: { ...listOut(r), lines: lines.map((l) => ({ ...l, options: JSON.parse(l.optionsJson) })), payments: pays, taxes: JSON.parse(r.o.taxesJson), canCancel: mayCancel(req.user, r.o) } });
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
      const order = tx.select().from(orders).where(eq(orders.id, id)).get();
      if (order && !mayCancel(req.user, order)) throw new HttpError(403, "cancel_needs_manager", "Only a manager can cancel this order.");
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
    const body = parse(
      z.object({
        assignedTo: z.string().nullable().optional(),
        collection: z
          .object({ mode: z.enum(["full", "part", "none"]), amount: z.number().positive().max(1_000_000_000).optional(), currency: z.enum(["USD", "SYP"]).optional(), methodId: z.string().nullable().optional() })
          .optional(),
      }),
      req.body ?? {},
    );
    const out = db.transaction((tx) => {
      const r = deliverOrder(tx, id, body, req.user!.id);
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "order", entityId: id, after: { status: "delivered", collected: r.collected, stillOwed: r.stillOwed, currency: r.currency } });
      notifyOrderStatus(tx, id, "delivered");
      return r;
    });
    res.json({ ok: true, collected: out.collected, stillOwed: out.stillOwed, currency: out.currency });
  }),
);

/** Admin or manager picks who brings the order; a client who ordered from the portal is told who and how to reach them. */
ordersRouter.post(
  "/:id/assign",
  requirePerm("orders", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const { assignedTo } = parse(z.object({ assignedTo: z.string().nullable() }), req.body);
    db.transaction((tx) => {
      const { changed } = assignDelivery(tx, id, assignedTo);
      if (!changed) return;
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "order", entityId: id, after: { assignedTo } });
      if (assignedTo) notifyDeliveryAssigned(tx, id, assignedTo);
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
