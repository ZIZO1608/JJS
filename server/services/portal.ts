import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { formatMoney, type Currency } from "../../shared/money.js";
import { clientAccounts, clients, employees, orderReports, orderRequests, orders, paymentMethods, subscriptionPlans, subscriptionRequests } from "../db/schema.js";
import { localDate, nextNumber, rateFor, roundMoney, type Q } from "../lib/biz.js";
import { getSetting } from "../lib/settings.js";
import { HttpError, newId, notFound, nowIso, parse } from "../lib/util.js";
import { startSubscription, subscriptionStatus } from "./clients.js";
import { notifyClient, notifyStaff } from "./notifications.js";
import { createOrder, priceOrder, type OrderInput } from "./orders.js";

export type RequestLine = { productId: string; qty: number; optionIds: string[] };

/** The client's view of a price: never cost, never other clients' data. */
export function portalQuote(tx: Q, clientId: string, p: { fulfilment: "pickup" | "delivery"; lines: RequestLine[] }) {
  const q = priceOrder(tx, toOrderInput(clientId, p));
  return {
    currency: q.currency,
    lines: q.lines.map((l) => ({ productId: l.productId, nameAr: l.nameAr, nameEn: l.nameEn, qty: l.qty, freeQty: l.freeQty, options: l.options, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
    subtotal: q.subtotal,
    discount: q.discount,
    discountPct: q.discountPct,
    freeItems: q.freeItems,
    taxes: q.taxes.map((t) => ({ nameAr: t.nameAr, nameEn: t.nameEn, amount: t.amount })),
    taxTotal: q.taxTotal,
    deliveryFee: q.deliveryFee,
    total: q.total,
    itemsCount: q.itemsCount,
  };
}

const toOrderInput = (clientId: string, p: { fulfilment: "pickup" | "delivery"; lines: RequestLine[]; note?: string }): OrderInput => ({
  clientId,
  type: "normal",
  fulfilment: p.fulfilment,
  lines: p.lines,
  note: p.note,
});

const clientName = (tx: Q, clientId: string) => tx.select({ n: clients.name }).from(clients).where(eq(clients.id, clientId)).get()?.n ?? "";

/** Off when the shop prices this client's orders by hand: the portal then shows no prices at all. */
export const showsPrices = (tx: Q, clientId: string) => accountOf(tx, clientId)?.showPrices !== false;

export function createOrderRequest(tx: Q, clientId: string, p: { fulfilment: "pickup" | "delivery"; paymentChoice: "on_account" | "on_delivery"; note: string; lines: RequestLine[] }) {
  if (!p.lines.length) throw new HttpError(400, "empty_order", "Add at least one item.");
  // Priced either way: this also checks the products and add-ons are still available.
  const q = portalQuote(tx, clientId, p);
  const needsPrice = !showsPrices(tx, clientId);
  const id = newId();
  const number = nextNumber(tx, orderRequests, orderRequests.number);
  tx.insert(orderRequests)
    .values({ id, number, clientId, fulfilment: p.fulfilment, paymentChoice: p.paymentChoice, note: p.note, linesJson: JSON.stringify(p.lines), quotedTotal: needsPrice ? 0 : q.total, currency: q.currency, itemsCount: q.itemsCount, needsPrice })
    .run();
  const name = clientName(tx, clientId);
  notifyStaff(
    tx,
    needsPrice
      ? {
          kind: "price_request",
          titleAr: `💰 ${name} بدو أسعار`,
          titleEn: `💰 ${name} is asking for prices`,
          bodyAr: `طلب #${number} · ${q.itemsCount} قطعة · حط الأسعار وابعتها`,
          bodyEn: `Request #${number} · ${q.itemsCount} items · set the prices and send them`,
          link: `/requests?id=${id}`,
          refId: id,
        }
      : {
          kind: "order_request",
          titleAr: `طلب جديد من ${name}`,
          titleEn: `New order from ${name}`,
          bodyAr: `طلب #${number} · ${q.itemsCount} قطعة · ${formatMoney(q.total, q.currency, "ar")}`,
          bodyEn: `Request #${number} · ${q.itemsCount} items · ${formatMoney(q.total, q.currency, "en")}`,
          link: `/requests?id=${id}`,
          refId: id,
        },
  );
  return { id, number, needsPrice, quote: needsPrice ? null : q };
}

type RequestRow = typeof orderRequests.$inferSelect;
const requestRow = (tx: Q, id: string): RequestRow => {
  const r = tx.select().from(orderRequests).where(and(eq(orderRequests.id, id), isNull(orderRequests.deletedAt))).get();
  if (!r) throw notFound("request");
  return r;
};
const answered = () => new HttpError(409, "not_pending", "This request was already answered.");

/* ---------- price requests: the shop sends prices, the client approves ---------- */
/** Exactly what the client saw and approved. The order is made from these numbers. */
export interface QuoteSnapshot {
  prices: number[];
  deliveryFee: number;
  rate: number | null;
  currency: Currency;
  lines: { productId: string; nameAr: string; nameEn: string; qty: number; basePrice: number; unitPrice: number; lineTotal: number; options: { nameAr: string; nameEn: string; priceDelta: number }[] }[];
  subtotal: number;
  taxes: { nameAr: string; nameEn: string; amount: number }[];
  taxTotal: number;
  total: number;
  itemsCount: number;
}

export const quoteOf = (r: RequestRow): QuoteSnapshot | null => (r.quoteJson ? (JSON.parse(r.quoteJson) as QuoteSnapshot) : null);
const linesOf = (r: RequestRow) => JSON.parse(r.linesJson) as RequestLine[];

/** Starting prices for the staff form: what this client would pay today (their price, price list or menu). */
export function suggestedQuote(tx: Q, r: RequestRow) {
  const q = priceOrder(tx, toOrderInput(r.clientId, { fulfilment: r.fulfilment, lines: linesOf(r) }));
  return {
    currency: q.currency,
    deliveryFee: r.fulfilment === "delivery" ? q.deliveryFee : 0,
    lines: q.lines.map((l) => ({ basePrice: l.basePrice, optionsDelta: roundMoney(l.unitPrice - l.basePrice, q.currency) })),
  };
}

const quoteBodySchema = (n: number) =>
  z.object({
    prices: z.array(z.number().finite().min(0).max(1e9)).length(n, "Give a price for every item."),
    deliveryFee: z.number().finite().min(0).max(1e9).default(0),
  });

/** Prices a request at the shop's numbers without saving anything (the live preview, and what is sent). */
export function buildQuote(tx: Q, r: RequestRow, body: unknown): QuoteSnapshot {
  const lines = linesOf(r);
  const p = parse(quoteBodySchema(lines.length), body);
  const currency = getSetting("currency.default");
  const deliveryFee = r.fulfilment === "delivery" ? p.deliveryFee : 0;
  const q = priceOrder(tx, toOrderInput(r.clientId, { fulfilment: r.fulfilment, lines }), localDate(), { presetPrices: p.prices, presetCurrency: currency, presetDeliveryFee: deliveryFee });
  return {
    prices: q.lines.map((l) => l.basePrice),
    deliveryFee: q.deliveryFee,
    rate: q.rate,
    currency: q.currency,
    lines: q.lines.map((l) => ({ productId: l.productId, nameAr: l.nameAr, nameEn: l.nameEn, qty: l.qty, basePrice: l.basePrice, unitPrice: l.unitPrice, lineTotal: l.lineTotal, options: l.options.map((o) => ({ nameAr: o.nameAr, nameEn: o.nameEn, priceDelta: o.priceDelta })) })),
    subtotal: q.subtotal,
    taxes: q.taxes.map((t) => ({ nameAr: t.nameAr, nameEn: t.nameEn, amount: t.amount })),
    taxTotal: q.taxTotal,
    total: q.total,
    itemsCount: q.itemsCount,
  };
}

/** A request the shop may price. One already priced can be priced again until the client approves. */
export function quotableRequest(tx: Q, id: string) {
  const r = requestRow(tx, id);
  if (!r.needsPrice) throw new HttpError(409, "has_prices", "This client sees prices: accept or decline the request instead.");
  if (r.status !== "pending" && r.status !== "quoted") throw answered();
  return r;
}

export function sendQuote(tx: Q, id: string, userId: string, body: unknown) {
  const r = quotableRequest(tx, id);
  const q = buildQuote(tx, r, body);
  const again = r.status === "quoted";
  tx.update(orderRequests)
    .set({ status: "quoted", quotedTotal: q.total, currency: q.currency, quoteJson: JSON.stringify(q), quotedBy: userId, quotedAt: nowIso(), clientReply: "", updatedAt: nowIso(), syncedAt: null })
    .where(eq(orderRequests.id, id))
    .run();
  notifyClient(tx, r.clientId, {
    kind: "order_quoted",
    titleAr: again ? `💰 أسعار جديدة لطلبك #${r.number}` : `💰 أسعار طلبك #${r.number} جاهزة`,
    titleEn: again ? `💰 New prices for your order #${r.number}` : `💰 Prices for your order #${r.number} are ready`,
    bodyAr: `الإجمالي ${formatMoney(q.total, q.currency, "ar")} · افتح الطلب ووافق ليبدأ التحضير`,
    bodyEn: `Total ${formatMoney(q.total, q.currency, "en")} · open it and approve to get it made`,
    link: `/portal/orders/${id}`,
    refId: id,
  });
  return { request: r, quote: q };
}

const orderInputOf = (tx: Q, r: RequestRow): OrderInput => {
  const creditMethod = tx.select().from(paymentMethods).where(and(eq(paymentMethods.kind, "credit"), eq(paymentMethods.active, true), isNull(paymentMethods.deletedAt))).orderBy(asc(paymentMethods.sort)).get();
  if (!creditMethod) throw new HttpError(409, "no_credit_method", "Add an active “On credit” payment method first (Settings → Money).");
  const payNote = r.paymentChoice === "on_delivery" ? "💵 الدفع عند الاستلام / Pay on delivery" : "";
  const note = [payNote, r.note].filter(Boolean).join(" · ").slice(0, 300);
  return { ...toOrderInput(r.clientId, { fulfilment: r.fulfilment, lines: linesOf(r), note }), methodId: creditMethod.id, paidAmount: 0 };
};

/** Makes the real order from the approved prices: stock, the client's account and the receipt in one go. */
function placeQuotedOrder(tx: Q, r: RequestRow, userId: string) {
  const q = quoteOf(r);
  if (!q) throw new HttpError(409, "no_quote", "This request has no prices yet.");
  const order = createOrder(tx, { ...orderInputOf(tx, r), deliveryFee: q.deliveryFee }, userId, {
    source: "portal",
    presetPrices: q.prices,
    presetCurrency: q.currency,
    presetRate: q.rate,
    presetDeliveryFee: q.deliveryFee,
  });
  tx.update(orderRequests).set({ status: "accepted", decidedBy: userId, decidedAt: nowIso(), orderId: order.id, quotedTotal: order.priced.total, updatedAt: nowIso(), syncedAt: null }).where(eq(orderRequests.id, r.id)).run();
  return order;
}

/** The client said yes. The order is made right away; if it can't be (day closed, credit limit…) staff finish it. */
export function approveQuote(tx: Q, clientId: string, id: string) {
  const r = requestRow(tx, id);
  if (r.clientId !== clientId) throw notFound("request");
  if (r.status !== "quoted") throw new HttpError(409, "not_quoted", "These prices are not waiting for your answer any more.");
  tx.update(orderRequests).set({ status: "approved", approvedAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(eq(orderRequests.id, id)).run();
  const name = clientName(tx, clientId);
  const total = (lang: "ar" | "en") => formatMoney(r.quotedTotal, r.currency, lang);
  let order: ReturnType<typeof createOrder> | null = null;
  let problem = "";
  try {
    // A savepoint: if making the order fails, the client's approval above is still kept.
    order = tx.transaction((sp) => placeQuotedOrder(sp, r, r.quotedBy!));
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    problem = e.message;
  }
  notifyStaff(
    tx,
    order
      ? {
          kind: "quote_approved",
          titleAr: `✅ ${name} وافق على الأسعار`,
          titleEn: `✅ ${name} approved the prices`,
          bodyAr: `طلب #${r.number} صار فاتورة #${order.number} · ${total("ar")}`,
          bodyEn: `Request #${r.number} is now invoice #${order.number} · ${total("en")}`,
          link: `/requests?id=${id}`,
          refId: id,
        }
      : {
          kind: "quote_approved",
          titleAr: `✅ ${name} وافق على الأسعار — كمّل الطلب`,
          titleEn: `✅ ${name} approved the prices — finish the order`,
          bodyAr: `طلب #${r.number} · ما انعمل تلقائياً: ${problem}`,
          bodyEn: `Request #${r.number} · not placed automatically: ${problem}`,
          link: `/requests?id=${id}`,
          refId: id,
        },
  );
  return { placed: !!order, orderNumber: order?.number ?? null };
}

/** The client said no to the prices: the request closes and staff are told why. */
export function rejectQuote(tx: Q, clientId: string, id: string, reason: string) {
  const r = requestRow(tx, id);
  if (r.clientId !== clientId) throw notFound("request");
  if (r.status !== "quoted") throw new HttpError(409, "not_quoted", "These prices are not waiting for your answer any more.");
  tx.update(orderRequests).set({ status: "cancelled", clientReply: reason, decidedAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(eq(orderRequests.id, id)).run();
  const name = clientName(tx, clientId);
  notifyStaff(tx, {
    kind: "quote_rejected",
    titleAr: `❌ ${name} ما وافق على الأسعار`,
    titleEn: `❌ ${name} turned down the prices`,
    bodyAr: `طلب #${r.number}${reason ? ` · ${reason}` : ""}`,
    bodyEn: `Request #${r.number}${reason ? ` · ${reason}` : ""}`,
    link: `/requests?id=${id}`,
    refId: id,
  });
}

/** Staff accept: the request becomes a real order (stock, client account, receipt) in one go. */
export function acceptOrderRequest(tx: Q, id: string, userId: string) {
  const r = requestRow(tx, id);
  let order: ReturnType<typeof createOrder>;
  if (r.status === "approved") order = placeQuotedOrder(tx, r, userId);
  else if (r.status !== "pending") throw answered();
  else if (r.needsPrice) throw new HttpError(409, "needs_price", "Send this client the prices first: they approve them before it becomes an order.");
  else {
    order = createOrder(tx, orderInputOf(tx, r), userId, { source: "portal" });
    tx.update(orderRequests).set({ status: "accepted", decidedBy: userId, decidedAt: nowIso(), orderId: order.id, updatedAt: nowIso(), syncedAt: null }).where(eq(orderRequests.id, id)).run();
  }
  notifyClient(tx, r.clientId, {
    kind: "order_accepted",
    titleAr: `تم قبول طلبك #${r.number} ✅`,
    titleEn: `Your order #${r.number} was accepted ✅`,
    bodyAr: `الفاتورة #${order.number} · ${formatMoney(order.priced.total, order.priced.currency, "ar")}`,
    bodyEn: `Invoice #${order.number} · ${formatMoney(order.priced.total, order.priced.currency, "en")}`,
    link: `/portal/orders/${id}`,
    refId: id,
  });
  return { request: r, order };
}

export function declineOrderRequest(tx: Q, id: string, userId: string, reason: string) {
  const r = requestRow(tx, id);
  if (r.status !== "pending" && r.status !== "quoted" && r.status !== "approved") throw answered();
  tx.update(orderRequests).set({ status: "declined", decidedBy: userId, decidedAt: nowIso(), declineReason: reason, updatedAt: nowIso(), syncedAt: null }).where(eq(orderRequests.id, id)).run();
  notifyClient(tx, r.clientId, {
    kind: "order_declined",
    titleAr: `تعذّر قبول طلبك #${r.number}`,
    titleEn: `Your order #${r.number} was declined`,
    bodyAr: reason,
    bodyEn: reason,
    link: `/portal/orders/${id}`,
    refId: id,
  });
  return r;
}

/** Called when staff deliver or cancel an order that came from the portal. */
export function notifyOrderStatus(tx: Q, orderId: string, status: "delivered" | "cancelled", reason = "") {
  const r = tx.select().from(orderRequests).where(eq(orderRequests.orderId, orderId)).get();
  if (!r) return;
  notifyClient(tx, r.clientId, status === "delivered"
    ? { kind: "order_delivered", titleAr: `تم تسليم طلبك #${r.number} 🎉`, titleEn: `Your order #${r.number} was delivered 🎉`, link: `/portal/orders/${r.id}`, refId: r.id }
    : { kind: "order_cancelled", titleAr: `أُلغي طلبك #${r.number}`, titleEn: `Your order #${r.number} was cancelled`, bodyAr: reason, bodyEn: reason, link: `/portal/orders/${r.id}`, refId: r.id });
}

/** Tells a portal client who is bringing their order, with the phone number to reach them. */
export function notifyDeliveryAssigned(tx: Q, orderId: string, employeeId: string) {
  const r = tx.select().from(orderRequests).where(eq(orderRequests.orderId, orderId)).get();
  const e = tx.select({ name: employees.name, phone: employees.phone }).from(employees).where(eq(employees.id, employeeId)).get();
  if (!r || !e) return;
  notifyClient(tx, r.clientId, {
    kind: "order_assigned",
    titleAr: `${e.name} رح يوصّل طلبك #${r.number} 🛵`,
    titleEn: `${e.name} will deliver your order #${r.number} 🛵`,
    bodyAr: e.phone ? `رقمه: ${e.phone}` : "",
    bodyEn: e.phone ? `Phone: ${e.phone}` : "",
    link: `/portal/orders/${r.id}`,
    refId: r.id,
  });
}

/** Who is bringing this order, for the client's own order page. Nothing once it is cancelled or for a pickup. */
export function deliveryPersonOf(tx: Q, orderId: string | null) {
  if (!orderId) return null;
  const o = tx.select({ assignedTo: orders.assignedTo, fulfilment: orders.fulfilment, status: orders.status }).from(orders).where(eq(orders.id, orderId)).get();
  if (!o?.assignedTo || o.fulfilment !== "delivery" || o.status === "cancelled") return null;
  const e = tx.select({ name: employees.name, phone: employees.phone }).from(employees).where(eq(employees.id, o.assignedTo)).get();
  return e ? { name: e.name, phone: e.phone } : null;
}

/* ---------- what clients report about their orders ---------- */
/** A client can have a few reports open on one order at a time, so a stuck button cannot flood the staff bell. */
const MAX_OPEN_REPORTS = 3;

const REPORT_CATEGORY: Record<(typeof orderReports.$inferInsert)["category"], { ar: string; en: string }> = {
  late: { ar: "الطلب تأخر", en: "Order is late" },
  missing: { ar: "في شي ناقص", en: "Something is missing" },
  wrong: { ar: "الطلب غلط", en: "Wrong order" },
  quality: { ar: "مشكلة بالجودة", en: "Quality problem" },
  payment: { ar: "مشكلة بالحساب", en: "Payment problem" },
  other: { ar: "شي تاني", en: "Something else" },
};

export function createOrderReport(tx: Q, clientId: string, requestId: string, p: { category: (typeof orderReports.$inferInsert)["category"]; message: string }) {
  const r = tx.select().from(orderRequests).where(and(eq(orderRequests.id, requestId), eq(orderRequests.clientId, clientId), isNull(orderRequests.deletedAt))).get();
  if (!r) throw notFound("request");
  const open = tx.select({ id: orderReports.id }).from(orderReports).where(and(eq(orderReports.requestId, r.id), eq(orderReports.status, "open"), isNull(orderReports.deletedAt))).all();
  if (open.length >= MAX_OPEN_REPORTS) throw new HttpError(409, "too_many_reports", "The shop is still looking at your earlier reports on this order.");
  const id = newId();
  tx.insert(orderReports).values({ id, requestId: r.id, clientId, category: p.category, message: p.message }).run();
  const name = clientName(tx, clientId);
  const cat = REPORT_CATEGORY[p.category];
  notifyStaff(tx, {
    kind: "order_report",
    titleAr: `⚠️ بلاغ من ${name}`,
    titleEn: `⚠️ Report from ${name}`,
    bodyAr: `طلب #${r.number} · ${cat.ar} · ${p.message}`.slice(0, 200),
    bodyEn: `Order #${r.number} · ${cat.en} · ${p.message}`.slice(0, 200),
    link: `/requests?tab=reports&id=${id}`,
    refId: id,
  });
  return { id };
}

export function resolveOrderReport(tx: Q, id: string, userId: string, reply: string) {
  const rep = tx.select().from(orderReports).where(and(eq(orderReports.id, id), isNull(orderReports.deletedAt))).get();
  if (!rep) throw notFound("report");
  if (rep.status !== "open") throw new HttpError(409, "report_closed", "This report was already answered.");
  tx.update(orderReports).set({ status: "resolved", reply, resolvedBy: userId, resolvedAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(eq(orderReports.id, id)).run();
  const r = tx.select({ number: orderRequests.number }).from(orderRequests).where(eq(orderRequests.id, rep.requestId)).get();
  notifyClient(tx, rep.clientId, {
    kind: "report_answered",
    titleAr: `رد المحل على بلاغك للطلب #${r?.number ?? ""}`,
    titleEn: `The shop answered your report on order #${r?.number ?? ""}`,
    bodyAr: reply,
    bodyEn: reply,
    link: `/portal/orders/${rep.requestId}`,
    refId: rep.requestId,
  });
}

/* ---------- subscriptions ---------- */
export function createSubscriptionRequest(tx: Q, clientId: string, p: { planId: string; note: string }) {
  const plan = tx.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.id, p.planId), eq(subscriptionPlans.active, true), isNull(subscriptionPlans.deletedAt))).get();
  if (!plan) throw notFound("plan");
  if (subscriptionStatus(tx, clientId, localDate())) throw new HttpError(409, "has_subscription", "You already have an active subscription.");
  const open = tx.select({ id: subscriptionRequests.id }).from(subscriptionRequests).where(and(eq(subscriptionRequests.clientId, clientId), eq(subscriptionRequests.status, "pending"))).get();
  if (open) throw new HttpError(409, "request_pending", "You already have a subscription request waiting.");
  const id = newId();
  tx.insert(subscriptionRequests).values({ id, clientId, planId: plan.id, note: p.note }).run();
  const name = clientName(tx, clientId);
  notifyStaff(tx, {
    kind: "sub_request",
    titleAr: `طلب اشتراك من ${name}`,
    titleEn: `Subscription request from ${name}`,
    bodyAr: `${plan.nameAr} · ${formatMoney(plan.monthlyFee, plan.currency, "ar")} شهرياً`,
    bodyEn: `${plan.nameEn} · ${formatMoney(plan.monthlyFee, plan.currency, "en")} / month`,
    link: `/requests?tab=subscriptions&id=${id}`,
    refId: id,
  });
  return { id };
}

const pendingSubRequest = (tx: Q, id: string) => {
  const r = tx.select().from(subscriptionRequests).where(and(eq(subscriptionRequests.id, id), isNull(subscriptionRequests.deletedAt))).get();
  if (!r) throw notFound("request");
  if (r.status !== "pending") throw new HttpError(409, "not_pending", "This request was already answered.");
  return r;
};

export function acceptSubscriptionRequest(tx: Q, id: string, userId: string) {
  const r = pendingSubRequest(tx, id);
  const plan = tx.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.id, r.planId), isNull(subscriptionPlans.deletedAt))).get();
  if (!plan) throw notFound("plan");
  const today = localDate();
  if (subscriptionStatus(tx, r.clientId, today)) throw new HttpError(409, "has_subscription", "This client already has an active subscription.");
  const sub = startSubscription(tx, { clientId: r.clientId, planId: plan.id, startDate: today, userId, rate: rateFor(plan.currency), today });
  tx.update(subscriptionRequests).set({ status: "accepted", decidedBy: userId, decidedAt: nowIso(), subscriptionId: sub.id, updatedAt: nowIso(), syncedAt: null }).where(eq(subscriptionRequests.id, id)).run();
  notifyClient(tx, r.clientId, {
    kind: "sub_accepted",
    titleAr: `تم تفعيل اشتراكك: ${plan.nameAr} ✅`,
    titleEn: `Your ${plan.nameEn} subscription is active ✅`,
    bodyAr: `حتى ${sub.endDate}`,
    bodyEn: `Until ${sub.endDate}`,
    link: "/portal/subscription",
    refId: id,
  });
  return { request: r, subscription: sub };
}

export function declineSubscriptionRequest(tx: Q, id: string, userId: string, reason: string) {
  const r = pendingSubRequest(tx, id);
  tx.update(subscriptionRequests).set({ status: "declined", decidedBy: userId, decidedAt: nowIso(), declineReason: reason, updatedAt: nowIso(), syncedAt: null }).where(eq(subscriptionRequests.id, id)).run();
  notifyClient(tx, r.clientId, { kind: "sub_declined", titleAr: "تعذّر قبول طلب الاشتراك", titleEn: "Your subscription request was declined", bodyAr: reason, bodyEn: reason, link: "/portal/subscription", refId: id });
  return r;
}

export const accountOf = (tx: Q, clientId: string) => tx.select().from(clientAccounts).where(and(eq(clientAccounts.clientId, clientId), isNull(clientAccounts.deletedAt))).get();
