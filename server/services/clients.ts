import { and, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { clients, orders, subscriptionPlans, subscriptions } from "../db/schema.js";
import { getSetting } from "../lib/settings.js";
import { addMonths, monthEnd, monthStart, type Q } from "../lib/biz.js";
import { newId, nowIso } from "../lib/util.js";
import { addClientMove } from "./money.js";

/** Items a client bought this calendar month (free items not counted) and loyalty rewards. */
export function loyaltyStatus(tx: Q, clientId: string, date: string) {
  const cfg = getSetting("loyalty");
  const row = tx
    .select({
      items: sql<number>`coalesce(sum(${orders.itemsCount} - ${orders.freeItems}),0)`,
      redeemed: sql<number>`coalesce(sum(${orders.loyaltyFree}),0)`,
    })
    .from(orders)
    .where(and(eq(orders.clientId, clientId), ne(orders.status, "cancelled"), eq(orders.type, "normal"), gte(orders.businessDate, monthStart(date)), lte(orders.businessDate, monthEnd(date)), isNull(orders.deletedAt)))
    .get();
  const count = Math.max(0, row?.items ?? 0);
  const earned = cfg.enabled && cfg.buyQty > 0 ? Math.floor(count / cfg.buyQty) * cfg.freeQty : 0;
  const redeemed = row?.redeemed ?? 0;
  return {
    enabled: cfg.enabled,
    buyQty: cfg.buyQty,
    freeQty: cfg.freeQty,
    count,
    progress: cfg.buyQty > 0 ? count % cfg.buyQty : 0,
    earned,
    redeemed,
    available: Math.max(0, earned - redeemed),
  };
}

/** The client's subscription covering `date`, with how many included items are left this month. */
export function subscriptionStatus(tx: Q, clientId: string, date: string) {
  const sub = tx
    .select({ s: subscriptions, p: subscriptionPlans })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(and(eq(subscriptions.clientId, clientId), eq(subscriptions.status, "active"), lte(subscriptions.startDate, date), gte(subscriptions.endDate, date), isNull(subscriptions.deletedAt)))
    .orderBy(desc(subscriptions.startDate))
    .get();
  if (!sub) return null;
  const used =
    tx
      .select({ n: sql<number>`coalesce(sum(${orders.subFree}),0)` })
      .from(orders)
      .where(and(eq(orders.clientId, clientId), ne(orders.status, "cancelled"), gte(orders.businessDate, sub.s.startDate), lte(orders.businessDate, sub.s.endDate)))
      .get()?.n ?? 0;
  return { ...sub.s, plan: sub.p, usedIncluded: used, availableIncluded: Math.max(0, sub.p.includedItems - used) };
}

/** Start a subscription period and charge its monthly fee to the client box. */
export function startSubscription(tx: Q, p: { clientId: string; planId: string; startDate: string; userId: string | null; rate: number | null; today: string; autoRenew?: boolean }) {
  const plan = tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, p.planId)).get()!;
  const endDate = addMonths(p.startDate, 1, -1);
  const id = newId();
  tx.insert(subscriptions).values({ id, clientId: p.clientId, planId: p.planId, startDate: p.startDate, endDate, autoRenew: p.autoRenew ?? true }).run();
  addClientMove(tx, { clientId: p.clientId, type: "subscription", amount: -plan.monthlyFee, currency: plan.currency, rate: p.rate, note: `${plan.nameEn} ${p.startDate} → ${endDate}`, userId: p.userId, date: p.today });
  return { id, endDate };
}

/** Renew subscriptions whose period ended (runs at start and every hour). */
export function renewSubscriptions(tx: Q, today: string, rate: number | null) {
  const ended = tx.select().from(subscriptions).where(and(eq(subscriptions.status, "active"), sql`${subscriptions.endDate} < ${today}`, isNull(subscriptions.deletedAt))).all();
  let renewed = 0;
  for (const s of ended) {
    tx.update(subscriptions).set({ status: "ended", updatedAt: nowIso(), syncedAt: null }).where(eq(subscriptions.id, s.id)).run();
    const client = tx.select().from(clients).where(eq(clients.id, s.clientId)).get();
    const plan = tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, s.planId)).get();
    if (!s.autoRenew || !client?.active || !plan?.active) continue;
    if (plan.currency === "SYP" && !rate) continue; // renew later once a rate exists
    // next period starts the day after the old one ended (catch up if several months passed)
    let start = addMonths(s.endDate, 0, 1);
    while (addMonths(start, 1, -1) < today) start = addMonths(start, 1);
    startSubscription(tx, { clientId: s.clientId, planId: s.planId, startDate: start, userId: null, rate, today, autoRenew: true });
    renewed++;
  }
  return renewed;
}
