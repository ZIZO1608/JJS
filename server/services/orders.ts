import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Currency } from "../../shared/money.js";
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
  products,
  taxes,
} from "../db/schema.js";
import { getSetting } from "../lib/settings.js";
import { assertDayOpen, convert, localDate, nextNumber, rateFor, roundMoney, round4, toUsd, type Q } from "../lib/biz.js";
import { HttpError, newId, nowIso } from "../lib/util.js";
import { loyaltyStatus, subscriptionStatus } from "./clients.js";
import { addBoxMove, addClientMove, clientBalanceUsd, getMethod } from "./money.js";
import { ensureProductItem, recipeOf, reverseStock, takeStock } from "./stock.js";

export interface OrderInput {
  clientId?: string | null;
  type: "normal" | "trial" | "staff";
  employeeId?: string | null;
  fulfilment: "pickup" | "delivery";
  deliveryFee?: number | null;
  assignedTo?: string | null;
  methodId?: string | null;
  manualDiscountPct?: number;
  useLoyalty?: boolean;
  note?: string;
  lines: { productId: string; qty: number; optionIds: string[] }[];
}

export interface PricedLine {
  productId: string;
  nameAr: string;
  nameEn: string;
  qty: number;
  freeQty: number;
  basePrice: number;
  specialPrice: boolean;
  options: { id: string; nameAr: string; nameEn: string; priceDelta: number }[];
  unitPrice: number;
  lineTotal: number;
}

/** Price an order without writing anything (used for the live preview and inside createOrder). */
export function priceOrder(tx: Q, input: OrderInput, date = localDate()) {
  const currency = getSetting("currency.default");
  const used = new Set<Currency>([currency]);
  const lineProducts = input.lines.map((l) => {
    const p = tx.select().from(products).where(and(eq(products.id, l.productId), isNull(products.deletedAt))).get();
    if (!p || !p.active) throw new HttpError(400, "product_unavailable", "One of the products is not on the menu any more.");
    used.add(p.currency);
    return p;
  });
  const client = input.clientId ? tx.select().from(clients).where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt))).get() : null;
  if (input.clientId && (!client || !client.active)) throw new HttpError(400, "client_unavailable", "Choose an active client.");

  const special = new Map<string, { price: number; currency: Currency }>();
  if (client) {
    for (const cp of tx.select().from(clientPrices).where(and(eq(clientPrices.clientId, client.id), isNull(clientPrices.deletedAt))).all()) {
      special.set(cp.productId, { price: cp.price, currency: cp.currency });
      used.add(cp.currency);
    }
  }
  const allOptionIds = input.lines.flatMap((l) => l.optionIds);
  const optRows = allOptionIds.length ? tx.select().from(options).where(and(isNull(options.deletedAt), eq(options.active, true), inArray(options.id, allOptionIds))).all() : [];
  optRows.forEach((o) => used.add(o.currency));
  const rate = rateFor(...used);

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
    const base = roundMoney(sp ? convert(sp.price, sp.currency, currency, rate) : convert(p.price, p.currency, currency, rate), currency);
    const opts = chosen.map((o) => ({ id: o.id, nameAr: o.nameAr, nameEn: o.nameEn, priceDelta: roundMoney(convert(o.priceDelta, o.currency, currency, rate), currency) }));
    const unit = roundMoney(base + opts.reduce((s, o) => s + o.priceDelta, 0), currency);
    return { productId: p.id, nameAr: p.nameAr, nameEn: p.nameEn, qty: l.qty, freeQty: 0, basePrice: base, specialPrice: !!sp, options: opts, unitPrice: unit, lineTotal: roundMoney(unit * l.qty, currency) };
  });

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0), currency);
  const itemsCount = lines.reduce((s, l) => s + l.qty, 0);
  const reasons: string[] = [];

  // Free items: subscription allowance first, then loyalty rewards, on the cheapest units.
  let subFree = 0;
  let loyaltyFree = 0;
  const sub = client && input.type === "normal" ? subscriptionStatus(tx, client.id, date) : null;
  const loyalty = client && input.type === "normal" ? loyaltyStatus(tx, client.id, date) : null;
  if (input.type === "normal") {
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

  // Percentage discounts: best one wins unless stacking is allowed.
  const cands: { key: string; pct: number }[] = [];
  if (input.type === "trial") cands.push({ key: "trial", pct: 100 });
  if (client?.tierId && input.type === "normal") {
    const tier = tx.select().from(clientTiers).where(eq(clientTiers.id, client.tierId)).get();
    if (tier && tier.discountPct > 0) cands.push({ key: "tier", pct: tier.discountPct });
  }
  if (sub && sub.plan.discountPct > 0) cands.push({ key: "subscription", pct: sub.plan.discountPct });
  let employee: typeof employees.$inferSelect | undefined;
  if (input.type === "staff") {
    employee = input.employeeId ? tx.select().from(employees).where(and(eq(employees.id, input.employeeId), isNull(employees.deletedAt))).get() : undefined;
    if (!employee) throw new HttpError(400, "employee_required", "Choose which employee is buying.");
    if (employee.staffDiscountPct > 0) cands.push({ key: "staff", pct: employee.staffDiscountPct });
  }
  if (input.manualDiscountPct && input.manualDiscountPct > 0) cands.push({ key: "manual", pct: Math.min(100, input.manualDiscountPct) });
  const stacking = getSetting("orders").allowStacking;
  const pct = cands.length === 0 ? 0 : stacking ? Math.min(100, cands.reduce((s, c) => s + c.pct, 0)) : Math.max(...cands.map((c) => c.pct));
  const pctKeys = stacking ? cands : cands.filter((c) => c.pct === pct).slice(0, 1);
  pctKeys.forEach((c) => reasons.push(`${c.key}:${c.pct}%`));
  const pctDiscount = roundMoney((subtotal - freeValue) * (pct / 100), currency);
  const discount = roundMoney(freeValue + pctDiscount, currency);

  // Taxes (not on free trials).
  const appliedTaxes: { id: string; nameAr: string; nameEn: string; kind: string; value: number; amount: number }[] = [];
  if (input.type !== "trial") {
    const base = subtotal - discount;
    for (const t of tx.select().from(taxes).where(and(isNull(taxes.deletedAt), eq(taxes.active, true))).all()) {
      const amount = t.kind === "percent" ? roundMoney(base * (t.value / 100), currency) : roundMoney(convert(t.value, "USD", currency, rate), currency);
      if (amount > 0) appliedTaxes.push({ id: t.id, nameAr: t.nameAr, nameEn: t.nameEn, kind: t.kind, value: t.value, amount });
    }
  }
  const taxTotal = roundMoney(appliedTaxes.reduce((s, t) => s + t.amount, 0), currency);
  const deliveryFee = input.fulfilment === "delivery" && input.type !== "trial" ? roundMoney(Math.max(0, input.deliveryFee ?? getSetting("orders").defaultDeliveryFee), currency) : 0;
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
export function createOrder(tx: Q, input: OrderInput, userId: string) {
  const date = localDate();
  assertDayOpen(tx, date);
  if (input.type === "trial" && !input.clientId) throw new HttpError(400, "client_required", "A free trial needs a client (add them as a new client first).");
  if (!input.lines.length) throw new HttpError(400, "empty_order", "Add at least one item.");
  const priced = priceOrder(tx, input, date);

  // Decide how it is paid.
  let method: typeof paymentMethods.$inferSelect | null = null;
  let paymentStatus: "paid" | "credit" | "free" | "salary" = "paid";
  if (input.type === "trial" || priced.total === 0) paymentStatus = "free";
  else {
    if (!input.methodId) throw new HttpError(400, "method_required", "Choose how the client paid.");
    method = getMethod(tx, input.methodId);
    if (method.kind === "credit") {
      if (!priced.client) throw new HttpError(400, "client_required", "Credit is only for account clients. Choose the client.");
      const after = (priced.client.balanceUsd ?? 0) - priced.totalUsd;
      if (priced.client.creditLimitUsd > 0 && -after > priced.client.creditLimitUsd + 0.001 && priced.client.creditBlock)
        throw new HttpError(409, "credit_limit", `This order passes ${priced.client.name}'s credit limit.`, { limitUsd: priced.client.creditLimitUsd, balanceAfterUsd: round4(after) });
      paymentStatus = "credit";
    } else if (method.kind === "salary") {
      if (input.type !== "staff") throw new HttpError(400, "salary_staff_only", "Deduct from salary is only for staff purchases.");
      paymentStatus = "salary";
    }
  }

  const id = newId();
  const number = nextNumber(tx, orders, orders.number);
  const ctx = { userId, date, refType: "order", refId: id };

  // Stock: finished sandwiches from the fridge first (FIFO, never expired), the rest is made fresh from the recipe.
  let costUsd = 0;
  const lineCosts: number[] = [];
  for (const l of priced.lines) {
    const itemId = ensureProductItem(tx, l.productId);
    const fridge =
      tx.get<{ q: number }>(sql`select coalesce(sum(qty_left),0) as q from batches where item_id = ${itemId} and qty_left > 0 and deleted_at is null and (expires_at is null or expires_at > ${nowIso()})`)?.q ?? 0;
    const fromFridge = Math.min(l.qty, Math.floor(fridge + 1e-9));
    let c = fromFridge ? takeStock(tx, { itemId, qty: fromFridge, type: "sale" }, ctx) : 0;
    const fresh = l.qty - fromFridge;
    if (fresh > 0) for (const r of recipeOf(tx, { productId: l.productId })) c += takeStock(tx, { itemId: r.itemId, qty: round4(r.qty * fresh), type: "use" }, ctx);
    for (const o of l.options) for (const r of recipeOf(tx, { optionId: o.id })) c += takeStock(tx, { itemId: r.itemId, qty: round4(r.qty * l.qty), type: "use" }, ctx);
    lineCosts.push(round4(c / l.qty));
    costUsd += c;
  }

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
    })
    .run();
  priced.lines.forEach((l, i) =>
    tx.insert(orderLines)
      .values({ id: newId(), orderId: id, productId: l.productId, nameAr: l.nameAr, nameEn: l.nameEn, qty: l.qty, freeQty: l.freeQty, unitPrice: l.unitPrice, optionsJson: JSON.stringify(l.options), lineTotal: l.lineTotal, unitCostUsd: lineCosts[i] ?? 0 })
      .run(),
  );

  // Money.
  if (paymentStatus === "paid" && method) {
    let boxId = method.boxId;
    // Cash collected on delivery stays with the delivery person until they hand it over.
    if (input.fulfilment === "delivery" && input.assignedTo && method.systemKey === "cash") {
      const repBox = tx.select().from(cashBoxes).where(and(eq(cashBoxes.employeeId, input.assignedTo), eq(cashBoxes.kind, "rep"), isNull(cashBoxes.deletedAt))).get();
      if (repBox) boxId = repBox.id;
    }
    if (!boxId) throw new HttpError(400, "method_has_no_box", "This payment method has no cash box. Fix it in Settings → Cash boxes.");
    const pid = newId();
    tx.insert(payments).values({ id: pid, kind: "order", orderId: id, clientId: input.clientId ?? null, methodId: method.id, boxId, amount: priced.total, currency: priced.currency, fxRate: priced.rate, amountUsd: priced.totalUsd, userId, businessDate: date }).run();
    addBoxMove(tx, { boxId, type: "sale", amount: priced.total, currency: priced.currency, rate: priced.rate, refType: "order", refId: id, note: `#${number}`, userId, date });
  }
  if (paymentStatus === "credit" && input.clientId) {
    addClientMove(tx, { clientId: input.clientId, type: "charge", amount: -priced.total, currency: priced.currency, rate: priced.rate, orderId: id, note: `#${number}`, userId, date });
  }

  // A client who had a free trial becomes "converted" on their first paid order.
  if (input.clientId && input.type === "normal") {
    const c = tx.select().from(clients).where(eq(clients.id, input.clientId)).get();
    const hadTrial = tx.get<{ n: number }>(sql`select count(*) as n from orders where client_id = ${input.clientId} and type = 'trial' and status != 'cancelled'`)?.n ?? 0;
    if (c && !c.convertedAt && hadTrial > 0) tx.update(clients).set({ convertedAt: date, updatedAt: nowIso(), syncedAt: null }).where(eq(clients.id, c.id)).run();
  }
  return { id, number, priced };
}

/** Cancel: stock goes back, money is reversed, and the client box is credited back. */
export function cancelOrder(tx: Q, orderId: string, userId: string) {
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
  if (o.paymentStatus === "credit" && o.clientId) addClientMove(tx, { clientId: o.clientId, type: "refund", amount: o.total, currency: o.currency, rate: o.fxRate, orderId: o.id, note: `Cancel #${o.number}`, userId, date });
  tx.update(orders).set({ status: "cancelled", cancelledAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(eq(orders.id, o.id)).run();
  return o;
}
