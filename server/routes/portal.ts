import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { categories, clientAccounts, clientPrices, clientSessions, clients, optionGroupLinks, optionGroups, options, orderLines, orderRequests, orders, priceListItems, products, subscriptionPlans, subscriptionRequests, subscriptions } from "../db/schema.js";
import { checkLoginLock, checkPassword, clearLoginFailures, hashPassword, recordLoginFailure } from "../lib/auth.js";
import { createClientSession, destroyClientSession, loadClient, requireClient } from "../lib/clientAuth.js";
import { localDate } from "../lib/biz.js";
import { getSetting } from "../lib/settings.js";
import { h, HttpError, notFound, nowIso, parse } from "../lib/util.js";
import { loyaltyStatus, subscriptionStatus } from "../services/clients.js";
import { clientBalanceUsd } from "../services/money.js";
import { listNotifications, markRead, unreadCount } from "../services/notifications.js";
import { createOrderRequest, createSubscriptionRequest, portalQuote } from "../services/portal.js";
import { receiptOf } from "./orders.js";

/**
 * The client portal API. Every query is scoped by req.portalClient.clientId taken from the
 * session cookie; ids in the URL are only ever looked up together with it.
 */
export const portalRouter = Router();

const lockKey = (username: string) => `client:${username.toLowerCase()}`;

portalRouter.post(
  "/login",
  h((req, res) => {
    const { username, password } = parse(z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(100) }), req.body);
    checkLoginLock(lockKey(username));
    const a = db.select().from(clientAccounts).where(and(eq(clientAccounts.username, username.toLowerCase()), isNull(clientAccounts.deletedAt))).get();
    if (!a || !checkPassword(password, a.passwordHash)) {
      recordLoginFailure(lockKey(username));
      throw new HttpError(401, "wrong_credentials", "The username or password is wrong.");
    }
    const client = loadClient(a.id);
    if (!client) throw new HttpError(403, "account_inactive", "This account is stopped. Contact the shop.");
    clearLoginFailures(lockKey(username));
    db.update(clientAccounts).set({ lastLoginAt: nowIso() }).where(eq(clientAccounts.id, a.id)).run();
    createClientSession(res, a.id);
    res.json({ client });
  }),
);

portalRouter.post(
  "/logout",
  h((req, res) => {
    destroyClientSession(req, res);
    res.json({ ok: true });
  }),
);

/** Public: business name and logo for the login screen. */
portalRouter.get(
  "/info",
  h((_req, res) => {
    const b = getSetting("business");
    res.json({ business: { nameAr: b.nameAr, nameEn: b.nameEn, logo: b.logo } });
  }),
);

portalRouter.use(requireClient);

portalRouter.get(
  "/me",
  h((req, res) => res.json({ client: req.portalClient })),
);

portalRouter.put(
  "/me/language",
  h((req, res) => {
    const { language } = parse(z.object({ language: z.enum(["ar", "en"]) }), req.body);
    db.update(clients).set({ receiptLanguage: language, updatedAt: nowIso(), syncedAt: null }).where(eq(clients.id, req.portalClient!.clientId)).run();
    res.json({ client: loadClient(req.portalClient!.accountId) });
  }),
);

portalRouter.put(
  "/me/password",
  h((req, res) => {
    const body = parse(z.object({ current: z.string().min(1), next: z.string().min(6).max(100) }), req.body);
    const a = db.select().from(clientAccounts).where(eq(clientAccounts.id, req.portalClient!.accountId)).get()!;
    if (!checkPassword(body.current, a.passwordHash)) throw new HttpError(400, "wrong_password", "The current password is wrong.");
    db.transaction((tx) => {
      tx.update(clientAccounts).set({ passwordHash: hashPassword(body.next), mustChangePassword: false, updatedAt: nowIso(), syncedAt: null }).where(eq(clientAccounts.id, a.id)).run();
      // Other phones logged in with the old password are signed out.
      tx.delete(clientSessions).where(eq(clientSessions.accountId, a.id)).run();
    });
    createClientSession(res, a.id);
    res.json({ client: loadClient(a.id) });
  }),
);

const requestOut = (r: typeof orderRequests.$inferSelect, order?: typeof orders.$inferSelect | null) => ({
  id: r.id,
  number: r.number,
  status: r.status,
  fulfilment: r.fulfilment,
  paymentChoice: r.paymentChoice,
  note: r.note,
  quotedTotal: r.quotedTotal,
  currency: r.currency,
  itemsCount: r.itemsCount,
  declineReason: r.declineReason,
  decidedAt: r.decidedAt,
  createdAt: r.createdAt,
  order: order ? { id: order.id, number: order.number, status: order.status, total: order.total, currency: order.currency, paymentStatus: order.paymentStatus, updatedAt: order.updatedAt } : null,
});

const ordersById = (ids: (string | null)[]) => {
  const list = ids.filter((x): x is string => !!x);
  return new Map((list.length ? db.select().from(orders).where(inArray(orders.id, list)).all() : []).map((o) => [o.id, o]));
};

const myRequests = (clientId: string, limit: number) => {
  const rows = db.select().from(orderRequests).where(and(eq(orderRequests.clientId, clientId), isNull(orderRequests.deletedAt))).orderBy(desc(orderRequests.number)).limit(limit).all();
  const byId = ordersById(rows.map((r) => r.orderId));
  return rows.map((r) => requestOut(r, r.orderId ? byId.get(r.orderId) : null));
};

const subscriptionOut = (clientId: string) => {
  const s = subscriptionStatus(db, clientId, localDate());
  if (!s) return null;
  return { planId: s.planId, nameAr: s.plan.nameAr, nameEn: s.plan.nameEn, monthlyFee: s.plan.monthlyFee, currency: s.plan.currency, discountPct: s.plan.discountPct, includedItems: s.plan.includedItems, usedIncluded: s.usedIncluded, availableIncluded: s.availableIncluded, startDate: s.startDate, endDate: s.endDate, autoRenew: s.autoRenew };
};

portalRouter.get(
  "/home",
  h((req, res) => {
    const clientId = req.portalClient!.clientId;
    const loy = loyaltyStatus(db, clientId, localDate());
    const month = localDate().slice(0, 7);
    const monthOrders = db
      .select({ n: orders.id, items: orders.itemsCount, totalUsd: orders.totalUsd, status: orders.status, date: orders.businessDate })
      .from(orders)
      .where(and(eq(orders.clientId, clientId), isNull(orders.deletedAt)))
      .all()
      .filter((o) => o.status !== "cancelled" && o.date.startsWith(month));
    res.json({
      client: req.portalClient,
      balanceUsd: clientBalanceUsd(db, clientId),
      currency: getSetting("currency.default"),
      subscription: subscriptionOut(clientId),
      pendingSubscriptionRequest: !!db.select({ id: subscriptionRequests.id }).from(subscriptionRequests).where(and(eq(subscriptionRequests.clientId, clientId), eq(subscriptionRequests.status, "pending"))).get(),
      loyalty: { enabled: loy.enabled, buyQty: loy.buyQty, freeQty: loy.freeQty, progress: loy.progress, available: loy.available },
      month: { orders: monthOrders.length, items: monthOrders.reduce((s, o) => s + o.items, 0) },
      requests: myRequests(clientId, 5),
      unread: unreadCount(db, { clientId }),
    });
  }),
);

/** The menu with this client's own prices (special price → price list → menu). No costs. */
portalRouter.get(
  "/menu",
  h((req, res) => {
    const c = db.select().from(clients).where(eq(clients.id, req.portalClient!.clientId)).get()!;
    const cats = db.select().from(categories).where(and(isNull(categories.deletedAt), eq(categories.active, true))).orderBy(asc(categories.sort), asc(categories.nameEn)).all();
    const prods = db.select().from(products).where(and(isNull(products.deletedAt), eq(products.active, true))).orderBy(asc(products.sort), asc(products.nameEn)).all();
    const listPrices = c.priceListId ? db.select().from(priceListItems).where(and(eq(priceListItems.listId, c.priceListId), isNull(priceListItems.deletedAt))).all() : [];
    const own = db.select().from(clientPrices).where(and(eq(clientPrices.clientId, c.id), isNull(clientPrices.deletedAt))).all();
    const links = db.select().from(optionGroupLinks).where(isNull(optionGroupLinks.deletedAt)).all();
    const groupIds = [...new Set(links.map((l) => l.groupId))];
    const groups = groupIds.length ? db.select().from(optionGroups).where(and(inArray(optionGroups.id, groupIds), isNull(optionGroups.deletedAt))).orderBy(asc(optionGroups.sort)).all() : [];
    const opts = groupIds.length ? db.select().from(options).where(and(inArray(options.groupId, groupIds), isNull(options.deletedAt), eq(options.active, true))).orderBy(asc(options.sort)).all() : [];
    res.json({
      categories: cats.filter((cat) => prods.some((p) => p.categoryId === cat.id)).map((cat) => ({ id: cat.id, nameAr: cat.nameAr, nameEn: cat.nameEn })),
      products: prods.map((p) => {
        const sp = own.find((x) => x.productId === p.id) ?? listPrices.find((x) => x.productId === p.id);
        return {
          id: p.id,
          categoryId: p.categoryId,
          nameAr: p.nameAr,
          nameEn: p.nameEn,
          allergens: p.allergens,
          price: sp?.price ?? p.price,
          currency: sp?.currency ?? p.currency,
          special: !!sp,
          photo: p.photo ? `/api/portal/products/${p.id}/photo` : "",
          groupIds: [...new Set(links.filter((l) => l.productId === p.id || l.categoryId === p.categoryId).map((l) => l.groupId))].filter((g) => groups.some((x) => x.id === g)),
        };
      }),
      groups: groups.map((g) => ({
        id: g.id,
        nameAr: g.nameAr,
        nameEn: g.nameEn,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        options: opts.filter((o) => o.groupId === g.id).map((o) => ({ id: o.id, nameAr: o.nameAr, nameEn: o.nameEn, priceDelta: o.priceDelta, currency: o.currency })),
      })),
      deliveryFee: getSetting("orders").defaultDeliveryFee,
      currency: getSetting("currency.default"),
    });
  }),
);

portalRouter.get(
  "/products/:id/photo",
  h((req, res) => {
    const p = db.select({ photo: products.photo }).from(products).where(and(eq(products.id, String(req.params.id)), eq(products.active, true), isNull(products.deletedAt))).get();
    const m = p?.photo.match(/^data:(image\/[a-z+]+);base64,(.*)$/);
    if (!m) throw notFound("photo");
    res.setHeader("Content-Type", m[1]!);
    res.setHeader("Cache-Control", "max-age=300");
    res.send(Buffer.from(m[2]!, "base64"));
  }),
);

const linesSchema = z.array(z.object({ productId: z.string(), qty: z.number().int().min(1).max(1000), optionIds: z.array(z.string()).max(20).default([]) })).max(80);
const quoteSchema = z.object({ fulfilment: z.enum(["pickup", "delivery"]).default("pickup"), lines: linesSchema });

portalRouter.post(
  "/quote",
  h((req, res) => {
    const body = parse(quoteSchema, req.body);
    if (!body.lines.length) return res.json({ empty: true });
    res.json(db.transaction((tx) => portalQuote(tx, req.portalClient!.clientId, body)));
  }),
);

portalRouter.post(
  "/order-requests",
  h((req, res) => {
    const body = parse(quoteSchema.extend({ paymentChoice: z.enum(["on_account", "on_delivery"]), note: z.string().trim().max(250).default("") }), req.body);
    const out = db.transaction((tx) => createOrderRequest(tx, req.portalClient!.clientId, body));
    res.status(201).json(out);
  }),
);

portalRouter.get(
  "/order-requests",
  h((req, res) => res.json({ rows: myRequests(req.portalClient!.clientId, 100) })),
);

const ownRequest = (clientId: string, id: string) => {
  const r = db.select().from(orderRequests).where(and(eq(orderRequests.id, id), eq(orderRequests.clientId, clientId), isNull(orderRequests.deletedAt))).get();
  if (!r) throw notFound("request");
  return r;
};

portalRouter.get(
  "/order-requests/:id",
  h((req, res) => {
    const r = ownRequest(req.portalClient!.clientId, String(req.params.id));
    const order = r.orderId ? (db.select().from(orders).where(eq(orders.id, r.orderId)).get() ?? null) : null;
    // Accepted → the real invoice lines; otherwise price the request as it would be now.
    let lines: { nameAr: string; nameEn: string; qty: number; freeQty: number; unitPrice: number; lineTotal: number; options: { nameAr: string; nameEn: string }[] }[] = [];
    let totals: { subtotal: number; discount: number; taxTotal: number; deliveryFee: number; total: number; currency: string } | null = null;
    if (order) {
      lines = db.select().from(orderLines).where(eq(orderLines.orderId, order.id)).all().map((l) => ({ nameAr: l.nameAr, nameEn: l.nameEn, qty: l.qty, freeQty: l.freeQty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, options: JSON.parse(l.optionsJson) }));
      totals = { subtotal: order.subtotal, discount: order.discount, taxTotal: order.taxTotal, deliveryFee: order.deliveryFee, total: order.total, currency: order.currency };
    } else {
      const raw = JSON.parse(r.linesJson) as { productId: string; qty: number; optionIds: string[] }[];
      const names = new Map(db.select({ id: products.id, nameAr: products.nameAr, nameEn: products.nameEn }).from(products).where(inArray(products.id, raw.map((l) => l.productId).concat(["-"]))).all().map((p) => [p.id, p]));
      const optNames = new Map(db.select({ id: options.id, nameAr: options.nameAr, nameEn: options.nameEn }).from(options).where(inArray(options.id, raw.flatMap((l) => l.optionIds).concat(["-"]))).all().map((o) => [o.id, o]));
      lines = raw.map((l) => ({ nameAr: names.get(l.productId)?.nameAr ?? "—", nameEn: names.get(l.productId)?.nameEn ?? "—", qty: l.qty, freeQty: 0, unitPrice: 0, lineTotal: 0, options: l.optionIds.map((o) => optNames.get(o) ?? { nameAr: "", nameEn: "" }) }));
    }
    res.json({ request: { ...requestOut(r, order), lines, totals } });
  }),
);

portalRouter.post(
  "/order-requests/:id/cancel",
  h((req, res) => {
    const r = ownRequest(req.portalClient!.clientId, String(req.params.id));
    if (r.status !== "pending") throw new HttpError(409, "not_pending", "Only a request still waiting can be cancelled.");
    db.update(orderRequests).set({ status: "cancelled", updatedAt: nowIso(), syncedAt: null }).where(eq(orderRequests.id, r.id)).run();
    res.json({ ok: true });
  }),
);

portalRouter.get(
  "/orders/:id/receipt",
  h((req, res) => {
    const o = db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, String(req.params.id)), eq(orders.clientId, req.portalClient!.clientId))).get();
    if (!o) throw notFound("order");
    const r = receiptOf(o.id);
    res.json({ receipt: { ...r, order: { ...r.order, costUsd: undefined, userName: undefined } } });
  }),
);

/* ---------- subscription ---------- */
portalRouter.get(
  "/subscription",
  h((req, res) => {
    const clientId = req.portalClient!.clientId;
    const plans = db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.active, true), isNull(subscriptionPlans.deletedAt))).orderBy(asc(subscriptionPlans.monthlyFee)).all();
    const reqs = db.select().from(subscriptionRequests).where(and(eq(subscriptionRequests.clientId, clientId), isNull(subscriptionRequests.deletedAt))).orderBy(desc(subscriptionRequests.createdAt)).limit(10).all();
    const history = db
      .select({ s: subscriptions, nameAr: subscriptionPlans.nameAr, nameEn: subscriptionPlans.nameEn })
      .from(subscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
      .where(and(eq(subscriptions.clientId, clientId), isNull(subscriptions.deletedAt)))
      .orderBy(desc(subscriptions.startDate))
      .limit(12)
      .all();
    res.json({
      current: subscriptionOut(clientId),
      plans: plans.map((p) => ({ id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, monthlyFee: p.monthlyFee, currency: p.currency, discountPct: p.discountPct, includedItems: p.includedItems })),
      requests: reqs.map((r) => ({ id: r.id, planId: r.planId, status: r.status, declineReason: r.declineReason, createdAt: r.createdAt, decidedAt: r.decidedAt })),
      history: history.map((x) => ({ id: x.s.id, nameAr: x.nameAr, nameEn: x.nameEn, startDate: x.s.startDate, endDate: x.s.endDate, status: x.s.status })),
    });
  }),
);

portalRouter.post(
  "/subscription-requests",
  h((req, res) => {
    const body = parse(z.object({ planId: z.string(), note: z.string().trim().max(250).default("") }), req.body);
    res.status(201).json(db.transaction((tx) => createSubscriptionRequest(tx, req.portalClient!.clientId, body)));
  }),
);

portalRouter.post(
  "/subscription-requests/:id/cancel",
  h((req, res) => {
    const r = db.select().from(subscriptionRequests).where(and(eq(subscriptionRequests.id, String(req.params.id)), eq(subscriptionRequests.clientId, req.portalClient!.clientId))).get();
    if (!r) throw notFound("request");
    if (r.status !== "pending") throw new HttpError(409, "not_pending", "Only a request still waiting can be cancelled.");
    db.update(subscriptionRequests).set({ status: "cancelled", updatedAt: nowIso(), syncedAt: null }).where(eq(subscriptionRequests.id, r.id)).run();
    res.json({ ok: true });
  }),
);

/* ---------- notifications ---------- */
portalRouter.get(
  "/notifications",
  h((req, res) => res.json({ rows: listNotifications(db, { clientId: req.portalClient!.clientId }), unread: unreadCount(db, { clientId: req.portalClient!.clientId }) })),
);
portalRouter.get(
  "/notifications/unread-count",
  h((req, res) => res.json({ unread: unreadCount(db, { clientId: req.portalClient!.clientId }) })),
);
portalRouter.post(
  "/notifications/read",
  h((req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(200).default([]) }), req.body ?? {});
    markRead(db, { clientId: req.portalClient!.clientId }, ids);
    res.json({ ok: true });
  }),
);
