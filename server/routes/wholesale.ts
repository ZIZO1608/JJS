import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  batches,
  clients,
  consignmentLines,
  consignments,
  employees,
  items,
  orders,
  paymentMethods,
  productionRuns,
  recurringOrders,
  returnLines,
  returns,
  stockMoves,
  users,
} from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { localDate } from "../lib/biz.js";
import { h, HttpError, notFound, parse } from "../lib/util.js";
import { createOrder } from "../services/orders.js";
import { cancelConsignment, clientAging, createProductionRun, createReturn, deliverConsignment, previewProduction, settleConsignment } from "../services/wholesale.js";

/** Wholesale & distribution: returns, consignment, production runs, route sheets, batch tracing. */
export const wholesaleRouter = Router();

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const lineQty = z.number().int().min(1).max(5000);

/* ---------- returns ---------- */
const returnSchema = z.object({
  clientId: z.string().nullable().optional(),
  orderId: z.string().nullable().optional(),
  repId: z.string().nullable().optional(),
  // give = goes straight to another client (back to the fridge, then out on a new order for them)
  lines: z.array(z.object({ productId: z.string(), qty: lineQty, action: z.enum(["restock", "waste", "give"]), expiresAt: z.string().nullable().optional() })).min(1).max(80),
  settlement: z.enum(["credit", "refund", "none"]),
  boxId: z.string().nullable().optional(),
  note: z.string().max(300).optional(),
  giveTo: z.object({ clientId: z.string(), methodId: z.string().nullable().optional() }).nullable().optional(),
});

wholesaleRouter.post(
  "/returns",
  requirePerm("orders", "edit"),
  h((req, res) => {
    const { giveTo, ...body } = parse(returnSchema, req.body);
    const given = body.lines.filter((l) => l.action === "give");
    if (given.length && !giveTo) throw new HttpError(400, "give_to_required", "Choose the client who gets the returned goods.");
    const fromClient = body.clientId ?? (body.orderId ? (db.select({ c: orders.clientId }).from(orders).where(eq(orders.id, body.orderId)).get()?.c ?? null) : null);
    if (given.length && giveTo!.clientId === fromClient) throw new HttpError(400, "give_to_same", "Choose a different client.");
    const out = db.transaction((tx) => {
      const r = createReturn(tx, { ...body, lines: body.lines.map((l) => ({ ...l, action: l.action === "give" ? ("restock" as const) : l.action })) }, req.user!.id);
      let givenOrder: { id: string; number: number } | null = null;
      if (given.length) {
        const target = tx.select().from(clients).where(and(eq(clients.id, giveTo!.clientId), isNull(clients.deletedAt))).get();
        if (!target) throw new HttpError(400, "client_not_found", "Choose a client that exists.");
        const credit = tx.select().from(paymentMethods).where(and(eq(paymentMethods.systemKey, "credit"), isNull(paymentMethods.deletedAt))).get();
        const o = createOrder(
          tx,
          { clientId: target.id, type: "normal", fulfilment: "delivery", methodId: giveTo!.methodId ?? credit?.id ?? null, paidAmount: giveTo!.methodId ? null : 0, note: `From return R${r.number}`, lines: given.map((l) => ({ productId: l.productId, qty: l.qty, optionIds: [] })) },
          req.user!.id,
        );
        givenOrder = { id: o.id, number: o.number };
        tx.update(returns).set({ note: [body.note, `→ ${target.name} #${o.number}`].filter(Boolean).join(" · "), givenOrderId: o.id }).where(eq(returns.id, r.id)).run();
        tx.update(returnLines).set({ action: "give" }).where(and(eq(returnLines.returnId, r.id), inArray(returnLines.productId, given.map((l) => l.productId)))).run();
        writeAudit(tx, { userId: req.user!.id, action: "create", entity: "order", entityId: o.id, after: { number: o.number, fromReturn: r.number, clientId: target.id } });
      }
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "return", entityId: r.id, after: { number: r.number, total: r.total, currency: r.currency, settlement: body.settlement, given: given.length } });
      return { ...r, givenOrder };
    });
    res.status(201).json({ ...out, return: returnOf(out.id) });
  }),
);

const returnOf = (id: string) => {
  const r = db.select({ r: returns, clientName: clients.name, userName: users.name }).from(returns).leftJoin(clients, eq(returns.clientId, clients.id)).leftJoin(users, eq(returns.userId, users.id)).where(eq(returns.id, id)).get();
  if (!r) return null;
  const orderNumber = r.r.orderId ? (db.select({ n: orders.number }).from(orders).where(eq(orders.id, r.r.orderId)).get()?.n ?? null) : null;
  return { ...r.r, clientName: r.clientName, userName: r.userName, orderNumber, lines: db.select().from(returnLines).where(eq(returnLines.returnId, id)).all() };
};

wholesaleRouter.get(
  "/returns",
  requirePerm("orders", "view"),
  h((req, res) => {
    const q = parse(z.object({ from: z.string().regex(dateRe).optional(), to: z.string().regex(dateRe).optional(), clientId: z.string().optional() }), req.query);
    const conds = [isNull(returns.deletedAt)];
    if (q.from) conds.push(gte(returns.businessDate, q.from));
    if (q.to) conds.push(lte(returns.businessDate, q.to));
    if (q.clientId) conds.push(eq(returns.clientId, q.clientId));
    const ids = db.select({ id: returns.id }).from(returns).where(and(...conds)).orderBy(desc(returns.number)).limit(500).all();
    res.json({ rows: ids.map((x) => returnOf(x.id)) });
  }),
);

wholesaleRouter.get(
  "/returns/:id",
  requirePerm("orders", "view"),
  h((req, res) => {
    const r = returnOf(String(req.params.id));
    if (!r) throw notFound("return");
    res.json({ return: r });
  }),
);

/* ---------- consignment ---------- */
const consignmentOf = (id: string) => {
  const c = db
    .select({ c: consignments, clientName: clients.name, repName: employees.name })
    .from(consignments)
    .innerJoin(clients, eq(consignments.clientId, clients.id))
    .leftJoin(employees, eq(consignments.repId, employees.id))
    .where(eq(consignments.id, id))
    .get();
  if (!c) return null;
  const lines = db.select().from(consignmentLines).where(eq(consignmentLines.consignmentId, id)).all();
  const value = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const orderNumber = c.c.orderId ? (db.select({ n: orders.number }).from(orders).where(eq(orders.id, c.c.orderId)).get()?.n ?? null) : null;
  return { ...c.c, clientName: c.clientName, repName: c.repName, lines, value, qty: lines.reduce((s, l) => s + l.qty, 0), orderNumber };
};

wholesaleRouter.get(
  "/consignments",
  requirePerm("orders", "view"),
  h((req, res) => {
    const q = parse(z.object({ status: z.enum(["open", "settled", "cancelled"]).optional(), clientId: z.string().optional(), repId: z.string().optional() }), req.query);
    const conds = [isNull(consignments.deletedAt)];
    if (q.status) conds.push(eq(consignments.status, q.status));
    if (q.clientId) conds.push(eq(consignments.clientId, q.clientId));
    if (q.repId) conds.push(eq(consignments.repId, q.repId));
    const ids = db.select({ id: consignments.id }).from(consignments).where(and(...conds)).orderBy(desc(consignments.number)).limit(500).all();
    res.json({ rows: ids.map((x) => consignmentOf(x.id)) });
  }),
);

wholesaleRouter.get(
  "/consignments/:id",
  requirePerm("orders", "view"),
  h((req, res) => {
    const c = consignmentOf(String(req.params.id));
    if (!c) throw notFound("consignment");
    res.json({ consignment: c });
  }),
);

wholesaleRouter.post(
  "/consignments",
  requirePerm("orders", "create"),
  h((req, res) => {
    const body = parse(z.object({ clientId: z.string(), repId: z.string().nullable().optional(), note: z.string().max(300).optional(), lines: z.array(z.object({ productId: z.string(), qty: lineQty })).min(1).max(80) }), req.body);
    const out = db.transaction((tx) => {
      const r = deliverConsignment(tx, body, req.user!.id);
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "consignment", entityId: r.id, after: { number: r.number, value: r.value, currency: r.currency } });
      return r;
    });
    res.status(201).json({ ...out, consignment: consignmentOf(out.id) });
  }),
);

wholesaleRouter.post(
  "/consignments/:id/settle",
  requirePerm("orders", "create"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(
      z.object({
        lines: z.array(z.object({ productId: z.string(), returnedQty: z.number().int().min(0), action: z.enum(["restock", "waste"]) })).max(80),
        methodId: z.string().nullable().optional(),
        paidAmount: z.number().min(0).nullable().optional(),
        note: z.string().max(300).optional(),
      }),
      req.body,
    );
    const out = db.transaction((tx) => {
      const r = settleConsignment(tx, id, body, req.user!.id);
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "consignment", entityId: id, after: { settled: true, ...r } });
      return r;
    });
    res.json({ ...out, consignment: consignmentOf(id) });
  }),
);

wholesaleRouter.post(
  "/consignments/:id/cancel",
  requirePerm("orders", "delete"),
  h((req, res) => {
    const id = String(req.params.id);
    db.transaction((tx) => {
      const c = cancelConsignment(tx, id, req.user!.id);
      writeAudit(tx, { userId: req.user!.id, action: "delete", entity: "consignment", entityId: id, before: { number: c.number } });
    });
    res.json({ ok: true });
  }),
);

/* ---------- production runs ---------- */
const runLines = z.array(z.object({ productId: z.string(), qty: lineQty })).min(1).max(60);

wholesaleRouter.post(
  "/production/preview",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const body = parse(z.object({ lines: runLines }), req.body);
    res.json(previewProduction(db, body.lines));
  }),
);

wholesaleRouter.post(
  "/production",
  requirePerm("warehouse", "create"),
  h((req, res) => {
    const body = parse(z.object({ lines: runLines, employeeId: z.string().nullable().optional(), locationId: z.string().nullable().optional(), note: z.string().max(300).optional() }), req.body);
    const out = db.transaction((tx) => {
      const r = createProductionRun(tx, body, req.user!.id);
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "production_run", entityId: r.id, after: { number: r.number, items: r.itemsCount, costUsd: r.costUsd } });
      return r;
    });
    res.status(201).json(out);
  }),
);

const runOf = (id: string) => {
  const r = db.select({ r: productionRuns, employeeName: employees.name, userName: users.name }).from(productionRuns).leftJoin(employees, eq(productionRuns.employeeId, employees.id)).leftJoin(users, eq(productionRuns.userId, users.id)).where(eq(productionRuns.id, id)).get();
  if (!r) return null;
  const bs = db
    .select({ b: batches, nameAr: items.nameAr, nameEn: items.nameEn, productId: items.productId })
    .from(batches)
    .innerJoin(items, eq(batches.itemId, items.id))
    .where(eq(batches.runId, id))
    .all()
    .map((x) => ({ ...x.b, nameAr: x.nameAr, nameEn: x.nameEn, productId: x.productId }));
  return { ...r.r, employeeName: r.employeeName, userName: r.userName, batches: bs };
};

wholesaleRouter.get(
  "/production",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const q = parse(z.object({ from: z.string().regex(dateRe).optional(), to: z.string().regex(dateRe).optional() }), req.query);
    const from = q.from ?? localDate();
    const to = q.to ?? from;
    const ids = db.select({ id: productionRuns.id }).from(productionRuns).where(and(gte(productionRuns.businessDate, from), lte(productionRuns.businessDate, to), isNull(productionRuns.deletedAt))).orderBy(desc(productionRuns.number)).all();
    res.json({ rows: ids.map((x) => runOf(x.id)) });
  }),
);

wholesaleRouter.get(
  "/production/:id",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const r = runOf(String(req.params.id));
    if (!r) throw notFound("production run");
    res.json({ run: r });
  }),
);

/* ---------- batch tracing: which clients received a batch ---------- */
wholesaleRouter.get(
  "/trace/:batchId",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const key = String(req.params.batchId);
    const b = db
      .select({ b: batches, nameAr: items.nameAr, nameEn: items.nameEn })
      .from(batches)
      .innerJoin(items, eq(batches.itemId, items.id))
      .where(sql`${batches.id} = ${key} or upper(${batches.batchCode}) = upper(${key})`)
      .get();
    if (!b) throw notFound("batch");
    const run = b.b.runId ? (db.select({ number: productionRuns.number, employeeName: employees.name, date: productionRuns.businessDate }).from(productionRuns).leftJoin(employees, eq(productionRuns.employeeId, employees.id)).where(eq(productionRuns.id, b.b.runId)).get() ?? null) : null;
    const outMoves = db.select().from(stockMoves).where(and(eq(stockMoves.batchId, b.b.id), isNull(stockMoves.deletedAt), inArray(stockMoves.type, ["sale", "consign"]))).all();
    const orderIds = outMoves.filter((m) => m.refType === "order" && m.refId).map((m) => m.refId!);
    const consIds = outMoves.filter((m) => m.refType === "consignment" && m.refId).map((m) => m.refId!);
    const ord = orderIds.length ? db.select({ o: orders, clientName: clients.name, phone: clients.phone }).from(orders).leftJoin(clients, eq(orders.clientId, clients.id)).where(inArray(orders.id, orderIds)).all() : [];
    const con = consIds.length ? db.select({ c: consignments, clientName: clients.name, phone: clients.phone }).from(consignments).innerJoin(clients, eq(consignments.clientId, clients.id)).where(inArray(consignments.id, consIds)).all() : [];
    const qtyFor = (refId: string) => -outMoves.filter((m) => m.refId === refId).reduce((s, m) => s + m.qty, 0);
    const received = [
      ...ord.map((x) => ({ kind: "order" as const, id: x.o.id, number: x.o.number, date: x.o.businessDate, clientId: x.o.clientId, clientName: x.clientName, phone: x.phone, qty: qtyFor(x.o.id), status: x.o.status })),
      ...con.map((x) => ({ kind: "consignment" as const, id: x.c.id, number: x.c.number, date: x.c.businessDate, clientId: x.c.clientId, clientName: x.clientName, phone: x.phone, qty: qtyFor(x.c.id), status: x.c.status })),
    ];
    res.json({ batch: { ...b.b, nameAr: b.nameAr, nameEn: b.nameEn }, run, received, clientsCount: new Set(received.map((r) => r.clientId ?? "walk-in")).size });
  }),
);

/* ---------- route sheet for a delivery rep ---------- */
wholesaleRouter.get(
  "/route-sheet",
  // the delivery side (route, map) is for managers; members only take orders
  requirePerm("orders", "edit"),
  h((req, res) => {
    const q = parse(z.object({ date: z.string().regex(dateRe).optional(), repId: z.string().optional() }), req.query);
    const date = q.date ?? localDate();
    const dow = new Date(`${date}T12:00:00`).getDay();
    const rep = q.repId ? (db.select().from(employees).where(eq(employees.id, q.repId)).get() ?? null) : null;
    // shops of this rep (or all) that have a standing order today
    const standing = db
      .select({ r: recurringOrders, c: clients })
      .from(recurringOrders)
      .innerJoin(clients, eq(recurringOrders.clientId, clients.id))
      .where(and(eq(recurringOrders.active, true), isNull(recurringOrders.deletedAt), eq(clients.active, true), q.repId ? eq(clients.repId, q.repId) : undefined))
      .all()
      .filter((x) => x.r.days.split(",").map(Number).includes(dow));
    const todays = db
      .select({ o: orders, c: clients })
      .from(orders)
      .innerJoin(clients, eq(orders.clientId, clients.id))
      .where(and(eq(orders.businessDate, date), ne(orders.status, "cancelled"), eq(orders.fulfilment, "delivery"), q.repId ? eq(orders.assignedTo, q.repId) : undefined))
      .orderBy(asc(clients.name))
      .all();
    const openCons = db
      .select({ c: consignments, cl: clients })
      .from(consignments)
      .innerJoin(clients, eq(consignments.clientId, clients.id))
      .where(and(eq(consignments.status, "open"), isNull(consignments.deletedAt), q.repId ? eq(consignments.repId, q.repId) : undefined))
      .all();
    const stops = new Map<string, { clientId: string; name: string; phone: string; address: string; lat: number | null; lng: number | null; areaId: string | null; standing: unknown[]; orders: unknown[]; consignments: unknown[]; balanceUsd: number; overdueDays: number }>();
    const stop = (c: typeof clients.$inferSelect) => {
      let s = stops.get(c.id);
      if (!s) {
        const ag = clientAging(db, c.id, date);
        s = { clientId: c.id, name: c.name, phone: c.phone, address: c.address, lat: c.lat, lng: c.lng, areaId: c.areaId, standing: [], orders: [], consignments: [], balanceUsd: ag.balanceUsd, overdueDays: ag.overdueDays };
        stops.set(c.id, s);
      }
      return s;
    };
    for (const x of standing) stop(x.c).standing.push({ id: x.r.id, lines: JSON.parse(x.r.linesJson), note: x.r.note });
    for (const x of todays) stop(x.c).orders.push({ id: x.o.id, number: x.o.number, total: x.o.total, currency: x.o.currency, paymentStatus: x.o.paymentStatus, status: x.o.status, items: x.o.itemsCount });
    for (const x of openCons) stop(x.cl).consignments.push({ id: x.c.id, number: x.c.number, date: x.c.businessDate });
    res.json({ date, rep: rep ? { id: rep.id, name: rep.name } : null, stops: [...stops.values()].sort((a, b) => (a.areaId ?? "").localeCompare(b.areaId ?? "") || a.name.localeCompare(b.name)) });
  }),
);
