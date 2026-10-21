import { and, asc, count, desc, eq, gte, isNull, lt, lte, max, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { categories, clientMoves, clientPrices, clientTiers, clients, consignments, employees, lookups, orderLines, orders, payments, priceListItems, priceLists, products, recurringOrders, returns, salesCalls, subscriptionPlans, subscriptions, users } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { addMonths, assertDayOpen, localDate, monthStart, rateFor, round4, toUsd } from "../lib/biz.js";
import { crudRouter } from "../lib/crud.js";
import { h, HttpError, newId, notFound, nowIso, parse } from "../lib/util.js";
import { loyaltyStatus, startSubscription, subscriptionStatus } from "../services/clients.js";
import { addBoxMove, addClientMove, clientBalanceUsd, getMethod } from "../services/money.js";
import { clientAging } from "../services/wholesale.js";
import { getSetting } from "../lib/settings.js";

export const clientsRouter = Router();
const names = { nameAr: z.string().trim().min(1).max(60), nameEn: z.string().trim().min(1).max(60) };

/* ---------- price lists (distributor, big shop, small shop…) ---------- */
clientsRouter.use(
  "/price-lists",
  crudRouter({
    table: priceLists,
    module: "clients",
    entity: "price_list",
    schema: z.object({ ...names, active: z.boolean().default(true) }),
    map: (r) => ({ ...r, clients: db.select({ n: count() }).from(clients).where(and(eq(clients.priceListId, r.id), isNull(clients.deletedAt))).get()?.n ?? 0, items: db.select({ n: count() }).from(priceListItems).where(and(eq(priceListItems.listId, r.id), isNull(priceListItems.deletedAt))).get()?.n ?? 0 }),
    beforeDelete: (tx, row) => {
      const n = tx.select({ n: count() }).from(clients).where(and(eq(clients.priceListId, row.id), isNull(clients.deletedAt))).get()?.n ?? 0;
      if (n) throw new HttpError(409, "in_use", `${n} client(s) use this price list.`);
    },
  }),
);
clientsRouter.get(
  "/price-lists/:id/items",
  requirePerm("clients", "view"),
  h((req, res) => {
    const rows = db
      .select({ i: priceListItems, nameAr: products.nameAr, nameEn: products.nameEn, menuPrice: products.price, menuCurrency: products.currency })
      .from(priceListItems)
      .innerJoin(products, eq(priceListItems.productId, products.id))
      .where(and(eq(priceListItems.listId, String(req.params.id)), isNull(priceListItems.deletedAt)))
      .all()
      .map((x) => ({ ...x.i, nameAr: x.nameAr, nameEn: x.nameEn, menuPrice: x.menuPrice, menuCurrency: x.menuCurrency }));
    res.json({ rows });
  }),
);
clientsRouter.put(
  "/price-lists/:id/items",
  requirePerm("clients", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    if (!db.select().from(priceLists).where(and(eq(priceLists.id, id), isNull(priceLists.deletedAt))).get()) throw notFound("price list");
    const list = parse(z.array(z.object({ productId: z.string(), price: z.number().min(0), currency: z.enum(["USD", "SYP"]) })).max(500), req.body.items ?? []);
    db.transaction((tx) => {
      const before = tx.select().from(priceListItems).where(and(eq(priceListItems.listId, id), isNull(priceListItems.deletedAt))).all();
      tx.update(priceListItems).set({ deletedAt: nowIso(), syncedAt: null }).where(and(eq(priceListItems.listId, id), isNull(priceListItems.deletedAt))).run();
      for (const p of list) tx.insert(priceListItems).values({ id: newId(), listId: id, ...p }).run();
      // every price change is kept in the audit log (who, when, old → new)
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "price_list.items", entityId: id, before: before.map((b) => ({ productId: b.productId, price: b.price, currency: b.currency })), after: list });
    });
    res.json({ ok: true });
  }),
);

clientsRouter.use(
  "/tiers",
  crudRouter({
    table: clientTiers,
    module: "clients",
    entity: "client_tier",
    schema: z.object({ ...names, discountPct: z.number().min(0).max(100), sort: z.number().int().min(0).default(0) }),
    beforeDelete: (tx, row) => {
      const n = tx.select({ n: count() }).from(clients).where(and(eq(clients.tierId, row.id), isNull(clients.deletedAt))).get()?.n ?? 0;
      if (n) throw new HttpError(409, "in_use", `${n} client(s) are in this tier.`);
    },
  }),
);

clientsRouter.use(
  "/plans",
  crudRouter({
    table: subscriptionPlans,
    module: "clients",
    entity: "subscription_plan",
    schema: z.object({ ...names, monthlyFee: z.number().min(0), currency: z.enum(["USD", "SYP"]), discountPct: z.number().min(0).max(100).default(0), includedItems: z.number().int().min(0).default(0), active: z.boolean().default(true) }),
  }),
);

clientsRouter.use(
  "/calls",
  crudRouter({
    table: salesCalls,
    module: "clients",
    entity: "sales_call",
    schema: z.object({
      employeeId: z.string().nullable().optional(),
      clientId: z.string().nullable().optional(),
      prospectName: z.string().trim().max(80).default(""),
      phone: z.string().trim().max(40).default(""),
      date: z.string().min(10).max(10),
      result: z.enum(["no_answer", "interested", "not_interested", "trial_given", "converted", "follow_up"]),
      nextFollowUp: z.string().nullable().optional(),
      note: z.string().max(400).default(""),
    }),
    orderBy: [desc(salesCalls.date), desc(salesCalls.createdAt)],
    map: (r) => ({
      ...r,
      clientName: r.clientId ? (db.select({ n: clients.name }).from(clients).where(eq(clients.id, r.clientId)).get()?.n ?? null) : null,
      employeeName: r.employeeId ? (db.select({ n: employees.name }).from(employees).where(eq(employees.id, r.employeeId)).get()?.n ?? null) : null,
    }),
  }),
);

/* ---------- clients ---------- */
const clientSchema = z.object({
  type: z.enum(["business", "individual"]),
  name: z.string().trim().min(1).max(80),
  contactPerson: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(40).default(""),
  address: z.string().trim().max(200).default(""),
  tierId: z.string().nullable().optional(),
  tagId: z.string().nullable().optional(),
  receiptLanguage: z.enum(["ar", "en"]).default("ar"),
  creditLimitUsd: z.number().min(0).default(0),
  creditBlock: z.boolean().default(false),
  note: z.string().max(400).default(""),
  active: z.boolean().default(true),
  areaId: z.string().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  priceListId: z.string().nullable().optional(),
  consignment: z.boolean().default(false),
  repId: z.string().nullable().optional(),
});
/** On a new client only: what they already owed (+) or had prepaid (−) before the system. */
const openingSchema = z.object({ openingBalance: z.number().default(0), openingCurrency: z.enum(["USD", "SYP"]).optional() });
const nullables = (b: z.infer<typeof clientSchema>) => ({
  tierId: b.tierId ?? null,
  tagId: b.tagId ?? null,
  areaId: b.areaId ?? null,
  priceListId: b.priceListId ?? null,
  repId: b.repId ?? null,
  paymentTermsDays: b.paymentTermsDays ?? getSetting("orders").defaultPaymentTermsDays,
});

const lastOrderDate = (clientId: string) => db.select({ d: max(orders.businessDate) }).from(orders).where(and(eq(orders.clientId, clientId), ne(orders.status, "cancelled"))).get()?.d ?? null;

function summary(c: typeof clients.$inferSelect) {
  const today = localDate();
  const loy = loyaltyStatus(db, c.id, today);
  const sub = subscriptionStatus(db, c.id, today);
  return {
    ...c,
    balanceUsd: clientBalanceUsd(db, c.id),
    loyalty: { count: loy.count, progress: loy.progress, buyQty: loy.buyQty, available: loy.available, enabled: loy.enabled },
    subscription: sub ? { planNameAr: sub.plan.nameAr, planNameEn: sub.plan.nameEn, endDate: sub.endDate, availableIncluded: sub.availableIncluded } : null,
    lastOrderDate: lastOrderDate(c.id),
    aging: clientAging(db, c.id, today),
  };
}

clientsRouter.get(
  "/",
  requirePerm("clients", "view"),
  h((_req, res) => {
    const rows = db.select().from(clients).where(isNull(clients.deletedAt)).orderBy(asc(clients.name)).all();
    res.json({ rows: rows.map(summary) });
  }),
);

clientsRouter.post(
  "/",
  requirePerm("clients", "create"),
  h((req, res) => {
    const body = parse(clientSchema, req.body);
    const opening = parse(openingSchema, req.body);
    const id = newId();
    db.transaction((tx) => {
      tx.insert(clients).values({ id, ...body, ...nullables(body) }).run();
      if (opening.openingBalance) {
        const cur = opening.openingCurrency ?? getSetting("currency.default");
        addClientMove(tx, { clientId: id, type: "opening", amount: -opening.openingBalance, currency: cur, rate: rateFor(cur), note: "Opening balance", userId: req.user!.id, date: localDate() });
      }
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "client", entityId: id, after: { ...body, ...opening } });
    });
    res.status(201).json({ row: summary(db.select().from(clients).where(eq(clients.id, id)).get()!) });
  }),
);

clientsRouter.put(
  "/:id",
  requirePerm("clients", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const before = db.select().from(clients).where(and(eq(clients.id, id), isNull(clients.deletedAt))).get();
    if (!before) throw notFound("client");
    const body = parse(clientSchema, req.body);
    db.transaction((tx) => {
      tx.update(clients).set({ ...body, ...nullables(body), paymentTermsDays: body.paymentTermsDays ?? before.paymentTermsDays, updatedAt: nowIso(), syncedAt: null }).where(eq(clients.id, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "client", entityId: id, before, after: body });
    });
    res.json({ row: summary(db.select().from(clients).where(eq(clients.id, id)).get()!) });
  }),
);

/** Client card: box, analytics, subscription, special prices, recurring orders. */
clientsRouter.get(
  "/:id",
  requirePerm("clients", "view"),
  h((req, res) => {
    const id = String(req.params.id);
    const c = db.select().from(clients).where(and(eq(clients.id, id), isNull(clients.deletedAt))).get();
    if (!c) throw notFound("client");
    const today = localDate();
    const mStart = monthStart(today);
    const live = and(eq(orders.clientId, id), ne(orders.status, "cancelled"), isNull(orders.deletedAt));
    const byCategory = db
      .select({ categoryId: categories.id, nameAr: categories.nameAr, nameEn: categories.nameEn, qty: sql<number>`sum(${orderLines.qty})` })
      .from(orderLines)
      .innerJoin(orders, eq(orderLines.orderId, orders.id))
      .innerJoin(products, eq(orderLines.productId, products.id))
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(and(live, gte(orders.businessDate, mStart)))
      .groupBy(categories.id)
      .all();
    const topProducts = db
      .select({ productId: orderLines.productId, nameAr: orderLines.nameAr, nameEn: orderLines.nameEn, qty: sql<number>`sum(${orderLines.qty})` })
      .from(orderLines)
      .innerJoin(orders, eq(orderLines.orderId, orders.id))
      .where(and(live, gte(orders.businessDate, addMonths(today, -3))))
      .groupBy(orderLines.productId)
      .orderBy(desc(sql`sum(${orderLines.qty})`))
      .limit(5)
      .all();
    const monthly = db
      .select({ month: sql<string>`substr(${orders.businessDate},1,7)`, orders: count(), items: sql<number>`sum(${orders.itemsCount})`, totalUsd: sql<number>`sum(${orders.totalUsd})` })
      .from(orders)
      .where(and(live, gte(orders.businessDate, addMonths(mStart, -5))))
      .groupBy(sql`substr(${orders.businessDate},1,7)`)
      .orderBy(asc(sql`substr(${orders.businessDate},1,7)`))
      .all();
    const totals = db.select({ n: count(), sum: sql<number>`coalesce(sum(${orders.totalUsd}),0)` }).from(orders).where(live).get()!;
    const moves = db
      .select({ m: clientMoves, userName: users.name })
      .from(clientMoves)
      .leftJoin(users, eq(clientMoves.userId, users.id))
      .where(and(eq(clientMoves.clientId, id), isNull(clientMoves.deletedAt)))
      .orderBy(desc(clientMoves.createdAt))
      .limit(100)
      .all();
    const subs = db
      .select({ s: subscriptions, p: subscriptionPlans })
      .from(subscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
      .where(and(eq(subscriptions.clientId, id), isNull(subscriptions.deletedAt)))
      .orderBy(desc(subscriptions.startDate))
      .limit(12)
      .all();
    const trials = db.select({ n: count() }).from(orders).where(and(eq(orders.clientId, id), eq(orders.type, "trial"), ne(orders.status, "cancelled"))).get()?.n ?? 0;
    const paidUsd = db.select({ s: sql<number>`coalesce(sum(${payments.amountUsd}),0)` }).from(payments).where(and(eq(payments.clientId, id), isNull(payments.deletedAt))).get()?.s ?? 0;
    const returnsUsd = db.select({ s: sql<number>`coalesce(sum(${returns.totalUsd}),0)` }).from(returns).where(and(eq(returns.clientId, id), isNull(returns.deletedAt))).get()?.s ?? 0;
    res.json({
      totals: { salesUsd: round4(totals.sum), paidUsd: round4(paidUsd), returnsUsd: round4(returnsUsd) },
      area: c.areaId ? (db.select().from(lookups).where(eq(lookups.id, c.areaId)).get() ?? null) : null,
      priceList: c.priceListId ? (db.select().from(priceLists).where(eq(priceLists.id, c.priceListId)).get() ?? null) : null,
      rep: c.repId ? (db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.id, c.repId)).get() ?? null) : null,
      returns: db.select().from(returns).where(and(eq(returns.clientId, id), isNull(returns.deletedAt))).orderBy(desc(returns.number)).limit(30).all(),
      consignments: db.select().from(consignments).where(and(eq(consignments.clientId, id), isNull(consignments.deletedAt))).orderBy(desc(consignments.number)).limit(30).all(),
      client: summary(c),
      loyalty: loyaltyStatus(db, id, today),
      analytics: { byCategory, topProducts, monthly, ordersCount: totals.n, avgOrderUsd: totals.n ? round4(totals.sum / totals.n) : 0, lastOrderDate: lastOrderDate(id), trials, converted: !!c.convertedAt },
      moves: moves.map((m) => ({ ...m.m, userName: m.userName })),
      subscriptions: subs.map((x) => ({ ...x.s, plan: x.p })),
      prices: db
        .select({ cp: clientPrices, nameAr: products.nameAr, nameEn: products.nameEn })
        .from(clientPrices)
        .innerJoin(products, eq(clientPrices.productId, products.id))
        .where(and(eq(clientPrices.clientId, id), isNull(clientPrices.deletedAt)))
        .all()
        .map((x) => ({ ...x.cp, nameAr: x.nameAr, nameEn: x.nameEn })),
      recurring: db
        .select()
        .from(recurringOrders)
        .where(and(eq(recurringOrders.clientId, id), isNull(recurringOrders.deletedAt)))
        .all()
        .map((r) => ({ ...r, lines: JSON.parse(r.linesJson) })),
    });
  }),
);

/** Money from the client into a box: pays their debt or tops up a prepaid balance. */
clientsRouter.post(
  "/:id/payments",
  requirePerm("clients", "create"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(z.object({ amount: z.number().positive(), currency: z.enum(["USD", "SYP"]), methodId: z.string(), kind: z.enum(["client_payment", "topup"]).default("client_payment"), note: z.string().max(200).default("") }), req.body);
    const out = db.transaction((tx) => {
      const c = tx.select().from(clients).where(and(eq(clients.id, id), isNull(clients.deletedAt))).get();
      if (!c) throw notFound("client");
      const date = localDate();
      assertDayOpen(tx, date);
      const method = getMethod(tx, body.methodId);
      if (method.kind !== "box" || !method.boxId) throw new HttpError(400, "method_not_box", "Choose cash, Sham Cash or another box method.");
      const rate = rateFor(body.currency);
      const pid = newId();
      tx.insert(payments).values({ id: pid, kind: body.kind, clientId: id, methodId: method.id, boxId: method.boxId, amount: body.amount, currency: body.currency, fxRate: rate, amountUsd: round4(toUsd(body.amount, body.currency, rate)), note: body.note, userId: req.user!.id, businessDate: date }).run();
      addBoxMove(tx, { boxId: method.boxId, type: body.kind === "topup" ? "topup" : "client_payment", amount: body.amount, currency: body.currency, rate, refType: "payment", refId: pid, note: c.name, userId: req.user!.id, date });
      addClientMove(tx, { clientId: id, type: body.kind === "topup" ? "topup" : "payment", amount: body.amount, currency: body.currency, rate, paymentId: pid, note: body.note, userId: req.user!.id, date });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "client.payment", entityId: pid, after: { client: c.name, ...body } });
      return { paymentId: pid, balanceUsd: clientBalanceUsd(tx, id) };
    });
    res.status(201).json(out);
  }),
);

/** Admin correction of a client box (always logged). */
clientsRouter.post(
  "/:id/adjust",
  requirePerm("clients", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(z.object({ amount: z.number().refine((v) => v !== 0, "Cannot be zero"), currency: z.enum(["USD", "SYP"]), note: z.string().trim().min(3).max(200) }), req.body);
    const balanceUsd = db.transaction((tx) => {
      if (!tx.select().from(clients).where(eq(clients.id, id)).get()) throw notFound("client");
      const rate = rateFor(body.currency);
      addClientMove(tx, { clientId: id, type: "adjust", amount: body.amount, currency: body.currency, rate, note: body.note, userId: req.user!.id, date: localDate() });
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "client.adjust", entityId: id, after: body });
      return clientBalanceUsd(tx, id);
    });
    res.json({ balanceUsd });
  }),
);

/**
 * The card shown the moment a shop is picked on a new invoice: last order, debt, late or not,
 * the prices agreed with them, and what they bought this month.
 */
clientsRouter.get(
  "/:id/snapshot",
  requirePerm("orders", "create"),
  h((req, res) => {
    const id = String(req.params.id);
    const c = db.select().from(clients).where(and(eq(clients.id, id), isNull(clients.deletedAt))).get();
    if (!c) throw notFound("client");
    const today = localDate();
    const last = db.select().from(orders).where(and(eq(orders.clientId, id), ne(orders.status, "cancelled"), isNull(orders.deletedAt))).orderBy(desc(orders.number)).get();
    const month = db
      .select({ n: count(), usd: sql<number>`coalesce(sum(${orders.totalUsd}),0)`, items: sql<number>`coalesce(sum(${orders.itemsCount}),0)` })
      .from(orders)
      .where(and(eq(orders.clientId, id), ne(orders.status, "cancelled"), gte(orders.businessDate, monthStart(today))))
      .get()!;
    const listPrices = c.priceListId ? db.select().from(priceListItems).where(and(eq(priceListItems.listId, c.priceListId), isNull(priceListItems.deletedAt))).all() : [];
    const own = db.select().from(clientPrices).where(and(eq(clientPrices.clientId, id), isNull(clientPrices.deletedAt))).all();
    const agreed = db
      .select({ id: products.id, nameAr: products.nameAr, nameEn: products.nameEn, price: products.price, currency: products.currency })
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.active, true)))
      .all()
      .map((p) => {
        const o = own.find((x) => x.productId === p.id);
        const l = listPrices.find((x) => x.productId === p.id);
        const src = o ? "client" : l ? "list" : "menu";
        return { productId: p.id, nameAr: p.nameAr, nameEn: p.nameEn, price: o?.price ?? l?.price ?? p.price, currency: o?.currency ?? l?.currency ?? p.currency, from: src };
      })
      .filter((p) => p.from !== "menu");
    const tier = c.tierId ? db.select().from(clientTiers).where(eq(clientTiers.id, c.tierId)).get() : null;
    res.json({
      client: { id: c.id, name: c.name, phone: c.phone, creditLimitUsd: c.creditLimitUsd, creditBlock: c.creditBlock, consignment: c.consignment, paymentTermsDays: c.paymentTermsDays },
      lastOrder: last ? { id: last.id, number: last.number, date: last.businessDate, total: last.total, currency: last.currency, items: last.itemsCount } : null,
      aging: clientAging(db, id, today),
      month: { orders: month.n, salesUsd: round4(month.usd), items: month.items },
      tier: tier ? { nameAr: tier.nameAr, nameEn: tier.nameEn, discountPct: tier.discountPct } : null,
      agreedPrices: agreed,
      openConsignments: db.select({ n: count() }).from(consignments).where(and(eq(consignments.clientId, id), eq(consignments.status, "open"))).get()?.n ?? 0,
    });
  }),
);

clientsRouter.get(
  "/:id/statement",
  requirePerm("clients", "view"),
  h((req, res) => {
    const id = String(req.params.id);
    const q = parse(z.object({ from: z.string(), to: z.string() }), req.query);
    const c = db.select().from(clients).where(eq(clients.id, id)).get();
    if (!c) throw notFound("client");
    const opening = db.select({ s: sql<number>`coalesce(sum(${clientMoves.amountUsd}),0)` }).from(clientMoves).where(and(eq(clientMoves.clientId, id), isNull(clientMoves.deletedAt), lt(clientMoves.businessDate, q.from))).get()?.s ?? 0;
    const rows = db
      .select()
      .from(clientMoves)
      .where(and(eq(clientMoves.clientId, id), isNull(clientMoves.deletedAt), gte(clientMoves.businessDate, q.from), lte(clientMoves.businessDate, q.to)))
      .orderBy(asc(clientMoves.createdAt))
      .all();
    let run = opening;
    const lines = rows.map((m) => {
      run = round4(run + m.amountUsd);
      return { ...m, balanceUsd: run };
    });
    const ordersInRange = db
      .select({ number: orders.number, date: orders.businessDate, total: orders.total, currency: orders.currency, itemsCount: orders.itemsCount, id: orders.id })
      .from(orders)
      .where(and(eq(orders.clientId, id), ne(orders.status, "cancelled"), gte(orders.businessDate, q.from), lte(orders.businessDate, q.to)))
      .orderBy(asc(orders.number))
      .all();
    const returnsInRange = db.select().from(returns).where(and(eq(returns.clientId, id), isNull(returns.deletedAt), gte(returns.businessDate, q.from), lte(returns.businessDate, q.to))).orderBy(asc(returns.number)).all();
    res.json({ client: c, from: q.from, to: q.to, openingUsd: round4(opening), closingUsd: round4(run), lines, orders: ordersInRange, returns: returnsInRange, aging: clientAging(db, id) });
  }),
);

clientsRouter.put(
  "/:id/prices",
  requirePerm("clients", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const list = parse(z.array(z.object({ productId: z.string(), price: z.number().min(0), currency: z.enum(["USD", "SYP"]) })).max(200), req.body.prices ?? []);
    db.transaction((tx) => {
      tx.update(clientPrices).set({ deletedAt: nowIso(), syncedAt: null }).where(and(eq(clientPrices.clientId, id), isNull(clientPrices.deletedAt))).run();
      for (const p of list) tx.insert(clientPrices).values({ id: newId(), clientId: id, ...p }).run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "client.prices", entityId: id, after: list });
    });
    res.json({ ok: true });
  }),
);

clientsRouter.post(
  "/:id/subscribe",
  requirePerm("clients", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(z.object({ planId: z.string(), startDate: z.string().min(10).max(10).optional(), autoRenew: z.boolean().default(true) }), req.body);
    const out = db.transaction((tx) => {
      const plan = tx.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.id, body.planId), isNull(subscriptionPlans.deletedAt))).get();
      if (!plan) throw notFound("plan");
      const start = body.startDate ?? localDate();
      if (subscriptionStatus(tx, id, start)) throw new HttpError(409, "has_subscription", "This client already has an active subscription for that date.");
      const r = startSubscription(tx, { clientId: id, planId: plan.id, startDate: start, userId: req.user!.id, rate: rateFor(plan.currency), today: localDate(), autoRenew: body.autoRenew });
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "subscription", entityId: r.id, after: { client: id, plan: plan.nameEn, start, end: r.endDate } });
      return r;
    });
    res.status(201).json(out);
  }),
);

clientsRouter.post(
  "/subscriptions/:sid/cancel",
  requirePerm("clients", "edit"),
  h((req, res) => {
    const sid = String(req.params.sid);
    const s = db.select().from(subscriptions).where(eq(subscriptions.id, sid)).get();
    if (!s) throw notFound("subscription");
    db.update(subscriptions).set({ status: "cancelled", autoRenew: false, updatedAt: nowIso(), syncedAt: null }).where(eq(subscriptions.id, sid)).run();
    writeAudit(db, { userId: req.user!.id, action: "edit", entity: "subscription", entityId: sid, after: { status: "cancelled" } });
    res.json({ ok: true });
  }),
);

/* ---------- recurring orders ---------- */
const recurringSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().min(1).max(1000), optionIds: z.array(z.string()).default([]) })).min(1).max(50),
  note: z.string().max(200).default(""),
  active: z.boolean().default(true),
});

clientsRouter.post(
  "/:id/recurring",
  requirePerm("clients", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(recurringSchema, req.body);
    const rid = newId();
    db.insert(recurringOrders).values({ id: rid, clientId: id, days: body.days.join(","), linesJson: JSON.stringify(body.lines), note: body.note, active: body.active }).run();
    writeAudit(db, { userId: req.user!.id, action: "create", entity: "recurring_order", entityId: rid, after: body });
    res.status(201).json({ id: rid });
  }),
);
clientsRouter.put(
  "/recurring/:rid",
  requirePerm("clients", "edit"),
  h((req, res) => {
    const rid = String(req.params.rid);
    const body = parse(recurringSchema, req.body);
    db.update(recurringOrders).set({ days: body.days.join(","), linesJson: JSON.stringify(body.lines), note: body.note, active: body.active, updatedAt: nowIso(), syncedAt: null }).where(eq(recurringOrders.id, rid)).run();
    writeAudit(db, { userId: req.user!.id, action: "edit", entity: "recurring_order", entityId: rid, after: body });
    res.json({ ok: true });
  }),
);
clientsRouter.delete(
  "/recurring/:rid",
  requirePerm("clients", "edit"),
  h((req, res) => {
    const rid = String(req.params.rid);
    db.update(recurringOrders).set({ deletedAt: nowIso(), syncedAt: null }).where(eq(recurringOrders.id, rid)).run();
    writeAudit(db, { userId: req.user!.id, action: "delete", entity: "recurring_order", entityId: rid });
    res.json({ ok: true });
  }),
);
