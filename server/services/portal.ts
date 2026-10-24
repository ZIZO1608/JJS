import { and, asc, eq, isNull } from "drizzle-orm";
import { formatMoney } from "../../shared/money.js";
import { clientAccounts, clients, orderRequests, paymentMethods, subscriptionPlans, subscriptionRequests } from "../db/schema.js";
import { localDate, nextNumber, rateFor, type Q } from "../lib/biz.js";
import { HttpError, newId, notFound, nowIso } from "../lib/util.js";
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

export function createOrderRequest(tx: Q, clientId: string, p: { fulfilment: "pickup" | "delivery"; paymentChoice: "on_account" | "on_delivery"; note: string; lines: RequestLine[] }) {
  if (!p.lines.length) throw new HttpError(400, "empty_order", "Add at least one item.");
  const q = portalQuote(tx, clientId, p);
  const id = newId();
  const number = nextNumber(tx, orderRequests, orderRequests.number);
  tx.insert(orderRequests)
    .values({ id, number, clientId, fulfilment: p.fulfilment, paymentChoice: p.paymentChoice, note: p.note, linesJson: JSON.stringify(p.lines), quotedTotal: q.total, currency: q.currency, itemsCount: q.itemsCount })
    .run();
  const name = clientName(tx, clientId);
  notifyStaff(tx, {
    kind: "order_request",
    titleAr: `طلب جديد من ${name}`,
    titleEn: `New order from ${name}`,
    bodyAr: `طلب #${number} · ${q.itemsCount} قطعة · ${formatMoney(q.total, q.currency, "ar")}`,
    bodyEn: `Request #${number} · ${q.itemsCount} items · ${formatMoney(q.total, q.currency, "en")}`,
    link: `/requests?id=${id}`,
    refId: id,
  });
  return { id, number, quote: q };
}

const pendingRequest = (tx: Q, id: string) => {
  const r = tx.select().from(orderRequests).where(and(eq(orderRequests.id, id), isNull(orderRequests.deletedAt))).get();
  if (!r) throw notFound("request");
  if (r.status !== "pending") throw new HttpError(409, "not_pending", "This request was already answered.");
  return r;
};

/** Staff accept: the request becomes a real order (stock, client account, receipt) in one go. */
export function acceptOrderRequest(tx: Q, id: string, userId: string) {
  const r = pendingRequest(tx, id);
  const creditMethod = tx.select().from(paymentMethods).where(and(eq(paymentMethods.kind, "credit"), eq(paymentMethods.active, true), isNull(paymentMethods.deletedAt))).orderBy(asc(paymentMethods.sort)).get();
  if (!creditMethod) throw new HttpError(409, "no_credit_method", "Add an active “On credit” payment method first (Settings → Money).");
  const payNote = r.paymentChoice === "on_delivery" ? "💵 الدفع عند الاستلام / Pay on delivery" : "";
  const note = [payNote, r.note].filter(Boolean).join(" · ").slice(0, 300);
  const order = createOrder(tx, { ...toOrderInput(r.clientId, { fulfilment: r.fulfilment, lines: JSON.parse(r.linesJson) as RequestLine[], note }), methodId: creditMethod.id, paidAmount: 0 }, userId, { source: "portal" });
  tx.update(orderRequests).set({ status: "accepted", decidedBy: userId, decidedAt: nowIso(), orderId: order.id, updatedAt: nowIso(), syncedAt: null }).where(eq(orderRequests.id, id)).run();
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
  const r = pendingRequest(tx, id);
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
