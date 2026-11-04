import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { formatMoney, type Currency } from "../../shared/money.js";
import { isOrderQty } from "../../shared/orderQty.js";
import {
  cashBoxes,
  clientPrices,
  clientTiers,
  clients,
  employees,
  optionGroupLinks,
  optionGroups,
  options,
  orderLines,
  orders,
  paymentMethods,
  payments,
  priceListItems,
  products,
  taxes,
} from "../db/schema.js";
import { getSetting } from "../lib/settings.js";
import { assertDayOpen, convert, localDate, nextNumber, rateFor, roundMoney, round4, toUsd, type Q } from "../lib/biz.js";
import { HttpError, newId, nowIso } from "../lib/util.js";
import { loyaltyStatus, subscriptionStatus } from "./clients.js";
import { addBoxMove, addClientMove, clientBalanceUsd, getMethod } from "./money.js";
import { notifyStaff } from "./notifications.js";
import { reverseStock, takeProductStock } from "./stock.js";

export interface OrderInput {
  clientId?: string | null;
  /** internal = tasting / kitchen use: no money, the cost is recorded. */
  type: "normal" | "trial" | "staff" | "internal";
  employeeId?: string | null;
  fulfilment: "pickup" | "delivery";
  deliveryFee?: number | null;
  assignedTo?: string | null;
  methodId?: string | null;
  manualDiscountPct?: number;
  /** A fixed amount off, in the order currency. Used instead of the percentage when above 0. */
  manualDiscountAmount?: number;
  useLoyalty?: boolean;
  note?: string;
  /** Paid now, in the order currency. Less than the total → the rest goes on the client's account. */
  paidAmount?: number | null;
  lines: { productId: string; qty: number; optionIds: string[] }[];
}

/** Used by consignment settlement: prices already agreed (net) and stock already taken. */
export interface OrderOptions {
  presetPrices?: number[];
  presetCosts?: number[];
  presetCurrency?: Currency;
  presetRate?: number | null;
  consignmentId?: string;
  fulfilmentNote?: string;
  source?: "staff" | "portal";
}

export interface PricedLine {
  productId: string;
  nameAr: string;
  nameEn: string;
  qty: number;
  freeQty: number;
  basePrice: number;
  specialPrice: boolean;
  priceFrom: "menu" | "list" | "client" | "agreed";
  options: { id: string; nameAr: string; nameEn: string; priceDelta: number }[];
  unitPrice: number;
  lineTotal: number;
}

/** What a person may order: fives only. Consignment settlements and requests already sent don't pass through here. */
export function assertOrderQtys(lines: { qty: number }[]) {
  if (lines.some((l) => !isOrderQty(l.qty))) throw new HttpError(400, "invalid_qty", "Order quantities come in fives: 5, 10, 15…");
}

/** Price an order without writing anything (used for the live preview and inside createOrder). */
export function priceOrder(tx: Q, input: OrderInput, date = localDate(), opts: OrderOptions = {}) {
  const currency = opts.presetCurrency ?? getSetting("currency.default");
  const used = new Set<Currency>([currency]);
  const lineProducts = input.lines.map((l) => {
    const p = tx.select().from(products).where(and(eq(products.id, l.productId), isNull(products.deletedAt))).get();
    if (!p || !p.active) throw new HttpError(400, "product_unavailable", "One of the products is not on the menu any more.");
    used.add(p.currency);
    return p;
  });
  const client = input.clientId ? tx.select().from(clients).where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt))).get() : null;
  if (input.clientId && (!client || !client.active)) throw new HttpError(400, "client_unavailable", "Choose an active client.");

  // Price for this client: their own special price, else their price list, else the menu price.
  const special = new Map<string, { price: number; currency: Currency; from: "client" | "list" }>();
  if (client?.priceListId) {
    for (const li of tx.select().from(priceListItems).where(and(eq(priceListItems.listId, client.priceListId), isNull(priceListItems.deletedAt))).all()) {
      special.set(li.productId, { price: li.price, currency: li.currency, from: "list" });
      used.add(li.currency);
    }
  }
  if (client) {
    for (const cp of tx.select().from(clientPrices).where(and(eq(clientPrices.clientId, client.id), isNull(clientPrices.deletedAt))).all()) {
      special.set(cp.productId, { price: cp.price, currency: cp.currency, from: "client" });
      used.add(cp.currency);
    }
  }
  const allOptionIds = input.lines.flatMap((l) => l.optionIds);
  const optRows = allOptionIds.length ? tx.select().from(options).where(and(isNull(options.deletedAt), eq(options.active, true), inArray(options.id, allOptionIds))).all() : [];
  optRows.forEach((o) => used.add(o.currency));
  let rate = opts.presetRate !== undefined && opts.presetRate !== null ? opts.presetRate : rateFor(...used);

  const lines: PricedLine[] = input.lines.map((l, i) => {
    const p = lineProducts[i]!;
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 1000) throw new HttpError(400, "invalid_qty", "Quantities must be whole numbers from 1 to 1000.");
    // allowed groups: the product's own + its category's
    const links = tx.select().from(optionGroupLinks).where(and(isNull(optionGroupLinks.deletedAt), sql`(${optionGroupLinks.productId} = ${p.id} or ${optionGroupLinks.categoryId} = ${p.categoryId})`)).all();
    const allowed = new Set(links.map((x) => x.groupId));
    const chosen = l.optionIds.map((id) => {
      const o = optRows.find((x) => x.id === id);
      if (!o || !allowed.has(o.groupId)) throw new HttpError(400, "option_unavailable", `An add-on is not available for ${p.nameEn}.`);
      return o;
    });
    for (const gid of allowed) {
      const g = tx.select().from(optionGroups).where(and(eq(optionGroups.id, gid), isNull(optionGroups.deletedAt))).get();
      if (!g) continue;
      const n = chosen.filter((c) => c.groupId === gid).length;
      if (n < g.minSelect || n > g.maxSelect) throw new HttpError(400, "option_count", `${p.nameEn}: choose between ${g.minSelect} and ${g.maxSelect} from “${g.nameEn}”.`);
    }
    const sp = special.get(p.id);
    const preset = opts.presetPrices?.[i];
    const base = roundMoney(preset !== undefined ? preset : sp ? convert(sp.price, sp.currency, currency, rate) : convert(p.price, p.currency, currency, rate), currency);
    const chosenOpts = chosen.map((o) => ({ id: o.id, nameAr: o.nameAr, nameEn: o.nameEn, priceDelta: roundMoney(convert(o.priceDelta, o.currency, currency, rate), currency) }));
    const unit = roundMoney(base + chosenOpts.reduce((s, o) => s + o.priceDelta, 0), currency);
    return { productId: p.id, nameAr: p.nameAr, nameEn: p.nameEn, qty: l.qty, freeQty: 0, basePrice: base, specialPrice: !!sp, priceFrom: preset !== undefined ? "agreed" : (sp?.from ?? "menu"), options: chosenOpts, unitPrice: unit, lineTotal: roundMoney(unit * l.qty, currency) };
  });

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0), currency);
  const itemsCount = lines.reduce((s, l) => s + l.qty, 0);
  const reasons: string[] = [];

  // Free items: subscription allowance first, then loyalty rewards, on the cheapest units.
  let subFree = 0;
  let loyaltyFree = 0;
  const agreed = !!opts.presetPrices;
  const sub = client && input.type === "normal" && !agreed ? subscriptionStatus(tx, client.id, date) : null;
  const loyalty = client && input.type === "normal" && !agreed ? loyaltyStatus(tx, client.id, date) : null;
  if (input.type === "normal" && !agreed) {
    let subLeft = sub?.availableIncluded ?? 0;
    let loyLeft = input.useLoyalty === false ? 0 : (loyalty?.available ?? 0);
    const units = lines.flatMap((l, idx) => Array.from({ length: l.qty }, () => ({ idx, price: l.unitPrice }))).sort((a, b) => a.price - b.price);
    for (const u of units) {
      if (subLeft > 0) {
        subLeft--;
        subFree++;
      } else if (loyLeft > 0) {
        loyLeft--;
        loyaltyFree++;
      } else break;
      lines[u.idx]!.freeQty++;
    }
    if (subFree) reasons.push(`subscription:${subFree}`);
    if (loyaltyFree) reasons.push(`loyalty:${loyaltyFree}`);
  }
  const freeValue = roundMoney(lines.reduce((s, l) => s + l.freeQty * l.unitPrice, 0), currency);

  // Discounts, as a percentage or a fixed amount: the one worth the most wins unless stacking is allowed.
  const discountable = subtotal - freeValue;
  type Cand = { key: string; pct: number; amount: number; label: string };
  const cands: Cand[] = [];
  const addDiscount = (key: string, pct: number, amount: number, amountCurrency: Currency) => {
    if (amount > 0) {
      if (amountCurrency !== currency && !rate) rate = rateFor(amountCurrency, currency);
      cands.push({ key, pct: 0, amount: roundMoney(convert(amount, amountCurrency, currency, rate), currency), label: `${amount} ${amountCurrency}` });
    } else if (pct > 0) cands.push({ key, pct, amount: 0, label: `${pct}%` });
  };
  if (input.type === "trial") addDiscount("trial", 100, 0, currency);
  if (input.type === "internal") addDiscount("internal", 100, 0, currency);
  if (client?.tierId && input.type === "normal" && !agreed) {
    const tier = tx.select().from(clientTiers).where(eq(clientTiers.id, client.tierId)).get();
    if (tier) addDiscount("tier", tier.discountPct, tier.discountAmount, tier.discountCurrency);
  }
  if (sub) addDiscount("subscription", sub.plan.discountPct, sub.plan.discountAmount, sub.plan.currency);
  let employee: typeof employees.$inferSelect | undefined;
  if (input.type === "staff") {
    employee = input.employeeId ? tx.select().from(employees).where(and(eq(employees.id, input.employeeId), isNull(employees.deletedAt))).get() : undefined;
    if (!employee) throw new HttpError(400, "employee_required", "Choose which employee is buying.");
    addDiscount("staff", employee.staffDiscountPct, employee.staffDiscountAmount, employee.currency);
  }
  addDiscount("manual", Math.min(100, input.manualDiscountPct ?? 0), input.manualDiscountAmount ?? 0, currency);
  const worth = (c: Cand) => Math.min(discountable, discountable * (c.pct / 100) + c.amount);
  const stacking = getSetting("orders").allowStacking;
  const best = cands.reduce<Cand | null>((b, c) => (!b || worth(c) > worth(b) ? c : b), null);
  const applied = stacking ? cands : best ? [best] : [];
  applied.forEach((c) => reasons.push(`${c.key}:${c.label}`));
  const appliedPct = Math.min(100, applied.reduce((s, c) => s + c.pct, 0));
  const appliedAmount = applied.reduce((s, c) => s + c.amount, 0);
  const offDiscountable = roundMoney(Math.min(discountable, discountable * (appliedPct / 100) + appliedAmount), currency);
  // The share of the price this discount takes: consignment prices use it line by line.
  const pct = appliedAmount > 0 ? (discountable > 0 ? round4((offDiscountable / discountable) * 100) : 0) : appliedPct;
  const discount = roundMoney(freeValue + offDiscountable, currency);

  // Taxes (not on free trials).
  const appliedTaxes: { id: string; nameAr: string; nameEn: string; kind: string; value: number; amount: number }[] = [];
  if (input.type !== "trial" && input.type !== "internal") {
    const base = subtotal - discount;
    for (const t of tx.select().from(taxes).where(and(isNull(taxes.deletedAt), eq(taxes.active, true))).all()) {
      const amount = t.kind === "percent" ? roundMoney(base * (t.value / 100), currency) : roundMoney(convert(t.value, "USD", currency, rate), currency);
      if (amount > 0) appliedTaxes.push({ id: t.id, nameAr: t.nameAr, nameEn: t.nameEn, kind: t.kind, value: t.value, amount });
    }
  }
  const taxTotal = roundMoney(appliedTaxes.reduce((s, t) => s + t.amount, 0), currency);
  const deliveryFee = input.fulfilment === "delivery" && input.type !== "trial" && input.type !== "internal" && !agreed ? roundMoney(Math.max(0, input.deliveryFee ?? getSetting("orders").defaultDeliveryFee), currency) : 0;
  const total = roundMoney(Math.max(0, subtotal - discount + taxTotal + deliveryFee), currency);

  const balanceUsd = client ? clientBalanceUsd(tx, client.id) : null;
  return {
    currency,
    rate,
    client: client ? { id: client.id, name: client.name, creditLimitUsd: client.creditLimitUsd, creditBlock: client.creditBlock, balanceUsd } : null,
    employee: employee ? { id: employee.id, name: employee.name } : null,
    lines,
    subtotal,
    discount,
    discountPct: pct,
    discountReason: reasons.join(","),
    freeItems: subFree + loyaltyFree,
    subFree,
    loyaltyFree,
    taxes: appliedTaxes,
    taxTotal,
    deliveryFee,
    total,
    totalUsd: round4(toUsd(total, currency, rate)),
    itemsCount,
    loyalty,
    subscription: sub ? { planNameAr: sub.plan.nameAr, planNameEn: sub.plan.nameEn, availableIncluded: sub.availableIncluded, endDate: sub.endDate } : null,
  };
}

export type PricedOrder = ReturnType<typeof priceOrder>;

/** Confirm an order: number it, take stock, take payment, and update the client box. */
export function createOrder(tx: Q, input: OrderInput, userId: string, opts: OrderOptions = {}) {
  const date = localDate();
  assertDayOpen(tx, date);
  if (input.type === "trial" && !input.clientId) throw new HttpError(400, "client_required", "A free trial needs a client (add them as a new client first).");
  if (!input.lines.length) throw new HttpError(400, "empty_order", "Add at least one item.");
  const priced = priceOrder(tx, input, date, opts);

  // Decide how it is paid: fully now, partly now (rest on account), on account, salary, or free.
  let method: typeof paymentMethods.$inferSelect | null = null;
  let paymentStatus: "paid" | "partial" | "credit" | "free" | "salary" = "paid";
  let paidNow = 0;
  const checkCredit = (onAccount: number) => {
    if (!priced.client) throw new HttpError(400, "client_required", "Only account clients can pay later. Choose the client.");
    const onAccountUsd = round4(toUsd(onAccount, priced.currency, priced.rate));
    const after = (priced.client.balanceUsd ?? 0) - onAccountUsd;
    if (priced.client.creditLimitUsd > 0 && -after > priced.client.creditLimitUsd + 0.001 && priced.client.creditBlock)
      throw new HttpError(409, "credit_limit", `This order passes ${priced.client.name}'s credit limit.`, { limitUsd: priced.client.creditLimitUsd, balanceAfterUsd: round4(after) });
  };
  if (input.type === "trial" || input.type === "internal" || priced.total === 0) paymentStatus = "free";
  else {
    if (!input.methodId) throw new HttpError(400, "method_required", "Choose how the client paid.");
    method = getMethod(tx, input.methodId);
    if (method.kind === "credit") {
      checkCredit(priced.total);
      paymentStatus = "credit";
    } else if (method.kind === "salary") {
      if (input.type !== "staff") throw new HttpError(400, "salary_staff_only", "Deduct from salary is only for staff purchases.");
      paymentStatus = "salary";
    } else {
      paidNow = roundMoney(Math.min(priced.total, Math.max(0, input.paidAmount ?? priced.total)), priced.currency);
      if (paidNow < priced.total) {
        checkCredit(priced.total - paidNow);
        paymentStatus = paidNow > 0 ? "partial" : "credit";
      }
    }
  }

  const id = newId();
  const number = nextNumber(tx, orders, orders.number);
  const ctx = { userId, date, refType: "order", refId: id };

  // Stock: finished sandwiches from the fridge first (FIFO, never expired), the rest is made fresh from the recipe.
  let costUsd = 0;
  const lineCosts: number[] = [];
  priced.lines.forEach((l, i) => {
    const preset = opts.presetCosts?.[i];
    const c = preset !== undefined ? preset * l.qty : takeProductStock(tx, { productId: l.productId, qty: l.qty, optionIds: l.options.map((o) => o.id) }, ctx).costUsd;
    lineCosts.push(round4(c / l.qty));
    costUsd += c;
  });

  tx.insert(orders)
    .values({
      id,
      number,
      businessDate: date,
      clientId: input.clientId ?? null,
      type: input.type,
      employeeId: input.type === "staff" ? (input.employeeId ?? null) : null,
      fulfilment: input.fulfilment,
      assignedTo: input.assignedTo ?? null,
      status: "confirmed",
      paymentStatus,
      methodId: method?.id ?? null,
      currency: priced.currency,
      fxRate: priced.rate,
      subtotal: priced.subtotal,
      discount: priced.discount,
      discountReason: priced.discountReason,
      taxTotal: priced.taxTotal,
      taxesJson: JSON.stringify(priced.taxes),
      deliveryFee: priced.deliveryFee,
      total: priced.total,
      totalUsd: priced.totalUsd,
      costUsd: round4(costUsd),
      itemsCount: priced.itemsCount,
      freeItems: priced.freeItems,
      loyaltyFree: priced.loyaltyFree,
      subFree: priced.subFree,
      note: input.note ?? "",
      userId,
      paidAmount: paidNow,
      consignmentId: opts.consignmentId ?? null,
      source: opts.source ?? "staff",
    })
    .run();
  priced.lines.forEach((l, i) =>
    tx.insert(orderLines)
      .values({ id: newId(), orderId: id, productId: l.productId, nameAr: l.nameAr, nameEn: l.nameEn, qty: l.qty, freeQty: l.freeQty, unitPrice: l.unitPrice, optionsJson: JSON.stringify(l.options), lineTotal: l.lineTotal, unitCostUsd: lineCosts[i] ?? 0 })
      .run(),
  );

  // Money.
  if ((paymentStatus === "paid" || paymentStatus === "partial") && method && paidNow > 0) {
    let boxId = method.boxId;
    // Cash collected on delivery stays with the delivery person until they hand it over.
    if (input.fulfilment === "delivery" && input.assignedTo && method.systemKey === "cash") {
      const repBox = tx.select().from(cashBoxes).where(and(eq(cashBoxes.employeeId, input.assignedTo), eq(cashBoxes.kind, "rep"), isNull(cashBoxes.deletedAt))).get();
      if (repBox) boxId = repBox.id;
    }
    if (!boxId) throw new HttpError(400, "method_has_no_box", "This payment method has no cash box. Fix it in Settings → Cash boxes.");
    const pid = newId();
    tx.insert(payments).values({ id: pid, kind: "order", orderId: id, clientId: input.clientId ?? null, methodId: method.id, boxId, amount: paidNow, currency: priced.currency, fxRate: priced.rate, amountUsd: round4(toUsd(paidNow, priced.currency, priced.rate)), userId, businessDate: date }).run();
    addBoxMove(tx, { boxId, type: "sale", amount: paidNow, currency: priced.currency, rate: priced.rate, refType: "order", refId: id, note: `#${number}`, userId, date });
  }
  const onAccount = roundMoney(priced.total - paidNow, priced.currency);
  if ((paymentStatus === "credit" || paymentStatus === "partial") && input.clientId && onAccount > 0) {
    addClientMove(tx, { clientId: input.clientId, type: "charge", amount: -onAccount, currency: priced.currency, rate: priced.rate, orderId: id, note: `#${number}`, userId, date });
  }

  // A client who had a free trial becomes "converted" on their first paid order.
  if (input.clientId && input.type === "normal") {
    const c = tx.select().from(clients).where(eq(clients.id, input.clientId)).get();
    const hadTrial = tx.get<{ n: number }>(sql`select count(*) as n from orders where client_id = ${input.clientId} and type = 'trial' and status != 'cancelled'`)?.n ?? 0;
    if (c && !c.convertedAt && hadTrial > 0) tx.update(clients).set({ convertedAt: date, updatedAt: nowIso(), syncedAt: null }).where(eq(clients.id, c.id)).run();
  }
  return { id, number, priced, paidNow, onAccount, paymentStatus };
}

/** What the client still owes on this order, in the order currency. */
export const orderRemaining = (o: typeof orders.$inferSelect) => (o.paymentStatus === "credit" || o.paymentStatus === "partial" ? Math.max(0, roundMoney(o.total - o.paidAmount, o.currency)) : 0);

/** The rule for "who may carry an order": an active delivery person. */
function assertDeliveryPerson(tx: Q, employeeId: string) {
  const e = tx.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.isDeliveryRep, true), eq(employees.active, true), isNull(employees.deletedAt))).get();
  if (!e) throw new HttpError(400, "not_delivery_person", "Choose an active delivery person.");
  return e;
}

export function assignDelivery(tx: Q, orderId: string, employeeId: string | null) {
  const o = tx.select().from(orders).where(and(eq(orders.id, orderId), isNull(orders.deletedAt))).get();
  if (!o) throw new HttpError(404, "not_found", "Order not found");
  if (o.status !== "confirmed") throw new HttpError(409, "order_closed", "This order was already delivered or cancelled.");
  if (o.fulfilment !== "delivery") throw new HttpError(400, "not_a_delivery", "This order is a pickup, so nobody delivers it.");
  if (employeeId) assertDeliveryPerson(tx, employeeId);
  tx.update(orders).set({ assignedTo: employeeId, updatedAt: nowIso(), syncedAt: null }).where(eq(orders.id, o.id)).run();
  return { order: o, changed: o.assignedTo !== employeeId };
}

export interface DeliveryCollection {
  /** full = paid everything still owed; part = paid `amount`; none = paid nothing, it stays on the client's account. */
  mode: "full" | "part" | "none";
  amount?: number;
  currency?: Currency;
  methodId?: string | null;
}

/**
 * Hand an order over and record what the client paid. What they did not pay stays on their
 * account (so it shows in the cloud under what clients owe) and every manager's bell says so.
 */
export function deliverOrder(tx: Q, orderId: string, input: { assignedTo?: string | null; collection?: DeliveryCollection }, userId: string) {
  const o = tx.select().from(orders).where(and(eq(orders.id, orderId), isNull(orders.deletedAt))).get();
  if (!o) throw new HttpError(404, "not_found", "Order not found");
  if (o.status === "cancelled") throw new HttpError(409, "cancelled", "This order was cancelled.");
  if (o.status === "delivered") throw new HttpError(409, "already_delivered", "This order was already marked delivered.");
  const assignedTo = input.assignedTo ?? o.assignedTo;
  const owed = orderRemaining(o);
  const c = input.collection ?? { mode: "none" as const };
  let paidInOrderCcy = 0;
  let paidStatus = o.paymentStatus;
  let methodId = o.methodId;
  if (owed > 0 && c.mode !== "none") {
    const date = localDate();
    assertDayOpen(tx, date);
    if (!c.methodId) throw new HttpError(400, "method_required", "Choose how the client paid.");
    const method = getMethod(tx, c.methodId);
    if (method.kind !== "box" || !method.boxId) throw new HttpError(400, "method_has_no_box", "This payment method has no cash box. Fix it in Settings → Cash boxes.");
    const repBox = o.fulfilment === "delivery" && assignedTo && method.systemKey === "cash" ? tx.select().from(cashBoxes).where(and(eq(cashBoxes.employeeId, assignedTo), eq(cashBoxes.kind, "rep"), isNull(cashBoxes.deletedAt))).get() : undefined;
    const boxId = repBox?.id ?? method.boxId;
    const currency = c.currency ?? o.currency;
    const box = tx.select({ currency: cashBoxes.currency }).from(cashBoxes).where(eq(cashBoxes.id, boxId)).get();
    const rate = rateFor(currency, o.currency, box?.currency ?? currency) ?? o.fxRate;
    let amount: number;
    if (c.mode === "full") {
      paidInOrderCcy = owed;
      amount = roundMoney(convert(owed, o.currency, currency, rate), currency);
    } else {
      amount = roundMoney(c.amount ?? 0, currency);
      if (!(amount > 0)) throw new HttpError(400, "amount_required", "Type how much the client paid.");
      paidInOrderCcy = roundMoney(convert(amount, currency, o.currency, rate), o.currency);
      // one unit of slack: a whole-pound amount cannot always land exactly on a dollar remainder
      if (paidInOrderCcy > owed + (o.currency === "USD" ? 0.01 : 1)) throw new HttpError(400, "collected_too_much", "That is more than the client owes on this order.");
      paidInOrderCcy = Math.min(paidInOrderCcy, owed);
    }
    const pid = newId();
    tx.insert(payments).values({ id: pid, kind: "order", orderId: o.id, clientId: o.clientId, methodId: method.id, boxId, amount, currency, fxRate: rate, amountUsd: round4(toUsd(amount, currency, rate)), userId, businessDate: date }).run();
    addBoxMove(tx, { boxId, type: "sale", amount, currency, rate, refType: "order", refId: o.id, note: `#${o.number}`, userId, date });
    if (o.clientId) addClientMove(tx, { clientId: o.clientId, type: "payment", amount, currency, rate, orderId: o.id, paymentId: pid, note: `#${o.number}`, userId, date });
    paidStatus = paidInOrderCcy >= owed ? "paid" : "partial";
    methodId = method.id;
  }
  const stillOwed = roundMoney(owed - paidInOrderCcy, o.currency);
  tx.update(orders)
    .set({ status: "delivered", assignedTo, deliveredAt: nowIso(), deliveredBy: userId, deliveryCollected: paidInOrderCcy, paymentStatus: paidStatus, methodId, paidAmount: roundMoney(o.paidAmount + paidInOrderCcy, o.currency), updatedAt: nowIso(), syncedAt: null })
    .where(eq(orders.id, o.id))
    .run();
  if (stillOwed > 0 && o.clientId) {
    const client = tx.select({ name: clients.name }).from(clients).where(eq(clients.id, o.clientId)).get();
    const name = client?.name ?? "";
    const part = paidInOrderCcy > 0;
    notifyStaff(tx, {
      kind: "delivery_unpaid",
      titleAr: part ? `💰 ${name} دفع جزء بس` : `💰 ${name} ما دفع`,
      titleEn: part ? `💰 ${name} paid only part` : `💰 ${name} did not pay`,
      bodyAr: `طلب #${o.number} · باقي عليه ${formatMoney(stillOwed, o.currency, "ar")}`,
      bodyEn: `Order #${o.number} · still owes ${formatMoney(stillOwed, o.currency, "en")}`,
      link: `/clients/${o.clientId}`,
      refId: o.id,
    });
  }
  return { collected: paidInOrderCcy, stillOwed, currency: o.currency };
}

/** Cancel: stock goes back, money is reversed, and the client box is credited back. */
export function cancelOrder(tx: Q, orderId: string, userId: string, reason = "") {
  const o = tx.select().from(orders).where(and(eq(orders.id, orderId), isNull(orders.deletedAt))).get();
  if (!o) throw new HttpError(404, "not_found", "Order not found");
  if (o.status === "cancelled") throw new HttpError(409, "already_cancelled", "This order is already cancelled.");
  assertDayOpen(tx, o.businessDate);
  const date = o.businessDate;
  reverseStock(tx, "order", o.id, { userId, date });
  for (const p of tx.select().from(payments).where(and(eq(payments.orderId, o.id), isNull(payments.deletedAt))).all()) {
    if (p.boxId) addBoxMove(tx, { boxId: p.boxId, type: "sale", amount: -p.amount, currency: p.currency, rate: p.fxRate, refType: "order_cancel", refId: o.id, note: `Cancel #${o.number}`, userId, date });
    tx.update(payments).set({ deletedAt: nowIso(), syncedAt: null }).where(eq(payments.id, p.id)).run();
  }
  if (o.consignmentId) throw new HttpError(409, "consignment_order", "This invoice came from a consignment. Record a return instead.");
  const onAccount = o.paymentStatus === "credit" ? o.total : o.paymentStatus === "partial" ? roundMoney(o.total - o.paidAmount, o.currency) : 0;
  if (onAccount > 0 && o.clientId) addClientMove(tx, { clientId: o.clientId, type: "refund", amount: onAccount, currency: o.currency, rate: o.fxRate, orderId: o.id, note: `Cancel #${o.number}`, userId, date });
  tx.update(orders).set({ status: "cancelled", cancelledAt: nowIso(), cancelReason: reason, updatedAt: nowIso(), syncedAt: null }).where(eq(orders.id, o.id)).run();
  return o;
}
