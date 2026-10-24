import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { clients, options, orderRequests, orders, products, subscriptionPlans, subscriptionRequests, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, requirePerm } from "../lib/auth.js";
import { h, parse } from "../lib/util.js";
import { clientBalanceUsd } from "../services/money.js";
import { listNotifications, markRead, unreadCount } from "../services/notifications.js";
import { acceptOrderRequest, acceptSubscriptionRequest, declineOrderRequest, declineSubscriptionRequest, type RequestLine } from "../services/portal.js";

/** Staff side of the client portal: the requests inbox. */
export const requestsRouter = Router();

const statusQuery = z.object({ status: z.enum(["pending", "accepted", "declined", "cancelled", "all"]).default("pending") });

requestsRouter.get(
  "/counts",
  requireAuth,
  h((_req, res) => {
    const pendingOrders = db.select({ n: count() }).from(orderRequests).where(and(eq(orderRequests.status, "pending"), isNull(orderRequests.deletedAt))).get()?.n ?? 0;
    const pendingSubscriptions = db.select({ n: count() }).from(subscriptionRequests).where(and(eq(subscriptionRequests.status, "pending"), isNull(subscriptionRequests.deletedAt))).get()?.n ?? 0;
    res.json({ orders: pendingOrders, subscriptions: pendingSubscriptions });
  }),
);

requestsRouter.get(
  "/orders",
  requirePerm("orders", "view"),
  h((req, res) => {
    const q = parse(statusQuery, req.query);
    const rows = db
      .select({ r: orderRequests, clientName: clients.name, clientPhone: clients.phone, decidedByName: users.name })
      .from(orderRequests)
      .innerJoin(clients, eq(orderRequests.clientId, clients.id))
      .leftJoin(users, eq(orderRequests.decidedBy, users.id))
      .where(and(isNull(orderRequests.deletedAt), q.status === "all" ? undefined : eq(orderRequests.status, q.status)))
      .orderBy(q.status === "pending" ? orderRequests.number : desc(orderRequests.number))
      .limit(200)
      .all();
    const lines = rows.map((x) => JSON.parse(x.r.linesJson) as RequestLine[]);
    const productIds = [...new Set(lines.flat().map((l) => l.productId))];
    const optionIds = [...new Set(lines.flat().flatMap((l) => l.optionIds))];
    const prodNames = new Map((productIds.length ? db.select({ id: products.id, nameAr: products.nameAr, nameEn: products.nameEn }).from(products).where(inArray(products.id, productIds)).all() : []).map((p) => [p.id, p]));
    const optNames = new Map((optionIds.length ? db.select({ id: options.id, nameAr: options.nameAr, nameEn: options.nameEn }).from(options).where(inArray(options.id, optionIds)).all() : []).map((o) => [o.id, o]));
    const orderIds = rows.map((x) => x.r.orderId).filter((x): x is string => !!x);
    const linked = new Map((orderIds.length ? db.select({ id: orders.id, number: orders.number, status: orders.status }).from(orders).where(inArray(orders.id, orderIds)).all() : []).map((o) => [o.id, o]));
    res.json({
      rows: rows.map((x, i) => ({
        ...x.r,
        clientName: x.clientName,
        clientPhone: x.clientPhone,
        decidedByName: x.decidedByName,
        balanceUsd: x.r.status === "pending" ? clientBalanceUsd(db, x.r.clientId) : null,
        order: x.r.orderId ? (linked.get(x.r.orderId) ?? null) : null,
        lines: lines[i]!.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          nameAr: prodNames.get(l.productId)?.nameAr ?? "—",
          nameEn: prodNames.get(l.productId)?.nameEn ?? "—",
          options: l.optionIds.map((o) => optNames.get(o) ?? { id: o, nameAr: "", nameEn: "" }),
        })),
      })),
    });
  }),
);

requestsRouter.post(
  "/orders/:id/accept",
  requirePerm("orders", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const out = db.transaction((tx) => {
      const r = acceptOrderRequest(tx, id, req.user!.id);
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "order", entityId: r.order.id, after: { fromRequest: r.request.number, number: r.order.number, total: r.order.priced.total, currency: r.order.priced.currency, source: "portal" } });
      return r.order;
    });
    res.json({ orderId: out.id, number: out.number });
  }),
);

requestsRouter.post(
  "/orders/:id/decline",
  requirePerm("orders", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(2).max(200) }), req.body);
    db.transaction((tx) => {
      const r = declineOrderRequest(tx, id, req.user!.id, reason);
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "order_request", entityId: id, after: { number: r.number, status: "declined", reason } });
    });
    res.json({ ok: true });
  }),
);

requestsRouter.get(
  "/subscriptions",
  requirePerm("clients", "view"),
  h((req, res) => {
    const q = parse(statusQuery, req.query);
    const rows = db
      .select({ r: subscriptionRequests, clientName: clients.name, clientPhone: clients.phone, plan: subscriptionPlans, decidedByName: users.name })
      .from(subscriptionRequests)
      .innerJoin(clients, eq(subscriptionRequests.clientId, clients.id))
      .innerJoin(subscriptionPlans, eq(subscriptionRequests.planId, subscriptionPlans.id))
      .leftJoin(users, eq(subscriptionRequests.decidedBy, users.id))
      .where(and(isNull(subscriptionRequests.deletedAt), q.status === "all" ? undefined : eq(subscriptionRequests.status, q.status)))
      .orderBy(desc(subscriptionRequests.createdAt))
      .limit(200)
      .all();
    res.json({ rows: rows.map((x) => ({ ...x.r, clientName: x.clientName, clientPhone: x.clientPhone, decidedByName: x.decidedByName, plan: { nameAr: x.plan.nameAr, nameEn: x.plan.nameEn, monthlyFee: x.plan.monthlyFee, currency: x.plan.currency, includedItems: x.plan.includedItems, discountPct: x.plan.discountPct } })) });
  }),
);

requestsRouter.post(
  "/subscriptions/:id/accept",
  requirePerm("clients", "create"),
  h((req, res) => {
    const id = String(req.params.id);
    const out = db.transaction((tx) => {
      const r = acceptSubscriptionRequest(tx, id, req.user!.id);
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "subscription", entityId: r.subscription.id, after: { client: r.request.clientId, plan: r.request.planId, fromRequest: id, end: r.subscription.endDate } });
      return r.subscription;
    });
    res.json(out);
  }),
);

requestsRouter.post(
  "/subscriptions/:id/decline",
  requirePerm("clients", "create"),
  h((req, res) => {
    const id = String(req.params.id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(2).max(200) }), req.body);
    db.transaction((tx) => {
      declineSubscriptionRequest(tx, id, req.user!.id, reason);
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "subscription_request", entityId: id, after: { status: "declined", reason } });
    });
    res.json({ ok: true });
  }),
);

/* ---------- the staff bell ---------- */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.get(
  "/",
  h((req, res) => res.json({ rows: listNotifications(db, { userId: req.user!.id }), unread: unreadCount(db, { userId: req.user!.id }) })),
);
notificationsRouter.get(
  "/unread-count",
  h((req, res) => res.json({ unread: unreadCount(db, { userId: req.user!.id }) })),
);
notificationsRouter.post(
  "/read",
  h((req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(200).default([]) }), req.body ?? {});
    markRead(db, { userId: req.user!.id }, ids);
    res.json({ ok: true });
  }),
);
