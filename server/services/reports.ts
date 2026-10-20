import { and, asc, count, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import {
  assets,
  batches,
  boxMoves,
  cashBoxes,
  categories,
  clients,
  expenses,
  items,
  lookups,
  orderLines,
  orders,
  paymentMethods,
  payrollRuns,
  payslips,
  products,
  stockMoves,
} from "../db/schema.js";
import { addDays, localDate, monthOf, round4, type Q } from "../lib/biz.js";
import { boxBalance, clientBalanceUsd } from "./money.js";
import { itemQty } from "./stock.js";

const liveOrders = (from: string, to: string) => and(gte(orders.businessDate, from), lte(orders.businessDate, to), ne(orders.status, "cancelled"), isNull(orders.deletedAt));

/** Straight-line depreciation of all assets for the months touched by [from, to]. */
export function depreciationUsd(tx: Q, from: string, to: string) {
  const months: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); ) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number) as [number, number];
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  let total = 0;
  const perAsset: { id: string; nameAr: string; nameEn: string; usd: number }[] = [];
  for (const a of tx.select().from(assets).where(isNull(assets.deletedAt)).all()) {
    const monthly = (a.priceUsd - a.salvageUsd) / Math.max(1, a.lifeMonths);
    const start = monthOf(a.purchaseDate);
    const [sy, sm] = start.split("-").map(Number) as [number, number];
    const endIdx = sy * 12 + sm - 1 + a.lifeMonths; // exclusive
    const n = months.filter((m) => {
      const [y, mo] = m.split("-").map(Number) as [number, number];
      const idx = y * 12 + mo - 1;
      return idx >= sy * 12 + sm - 1 && idx < endIdx;
    }).length;
    // A single day or part of a month gets that month's share pro-rated by days in range.
    const share = from === to ? n / 30 : n;
    if (share > 0) {
      perAsset.push({ id: a.id, nameAr: a.nameAr, nameEn: a.nameEn, usd: round4(monthly * share) });
      total += monthly * share;
    }
  }
  return { totalUsd: round4(total), perAsset };
}

/** All the numbers for a period. A single day uses from === to. */
export function periodReport(tx: Q, from: string, to: string) {
  const w = liveOrders(from, to);
  const o = tx
    .select({
      orders: count(),
      items: sql<number>`coalesce(sum(${orders.itemsCount}),0)`,
      freeItems: sql<number>`coalesce(sum(${orders.freeItems}),0)`,
      salesUsd: sql<number>`coalesce(sum(${orders.totalUsd}),0)`,
      costUsd: sql<number>`coalesce(sum(${orders.costUsd}),0)`,
    })
    .from(orders)
    .where(w)
    .get()!;
  // discounts / taxes / delivery in USD using each order's own rate
  const usd = (col: unknown) => sql<number>`coalesce(sum(case when ${orders.currency} = 'USD' then ${col} else ${col} / ${orders.fxRate} end),0)`;
  const extra = tx.select({ discountUsd: usd(orders.discount), taxUsd: usd(orders.taxTotal), deliveryUsd: usd(orders.deliveryFee), grossUsd: usd(orders.subtotal) }).from(orders).where(w).get()!;

  const byStatus = tx.select({ status: orders.paymentStatus, n: count(), usd: sql<number>`coalesce(sum(${orders.totalUsd}),0)` }).from(orders).where(w).groupBy(orders.paymentStatus).all();
  const byMethod = tx
    .select({ methodId: orders.methodId, nameAr: paymentMethods.nameAr, nameEn: paymentMethods.nameEn, n: count(), usd: sql<number>`coalesce(sum(${orders.totalUsd}),0)` })
    .from(orders)
    .leftJoin(paymentMethods, eq(orders.methodId, paymentMethods.id))
    .where(w)
    .groupBy(orders.methodId)
    .all();
  const byType = tx.select({ type: orders.type, n: count(), items: sql<number>`coalesce(sum(${orders.itemsCount}),0)` }).from(orders).where(w).groupBy(orders.type).all();

  const byProduct = tx
    .select({
      productId: orderLines.productId,
      nameAr: orderLines.nameAr,
      nameEn: orderLines.nameEn,
      qty: sql<number>`sum(${orderLines.qty})`,
      revenueUsd: sql<number>`sum(case when ${orders.currency}='USD' then ${orderLines.lineTotal} else ${orderLines.lineTotal} / ${orders.fxRate} end)`,
      costUsd: sql<number>`sum(${orderLines.unitCostUsd} * ${orderLines.qty})`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .where(w)
    .groupBy(orderLines.productId)
    .orderBy(desc(sql`sum(${orderLines.qty})`))
    .all()
    .map((r) => ({ ...r, revenueUsd: round4(r.revenueUsd), costUsd: round4(r.costUsd), marginPct: r.revenueUsd > 0 ? round4(((r.revenueUsd - r.costUsd) / r.revenueUsd) * 100) : 0 }));

  const byCategory = tx
    .select({ categoryId: categories.id, nameAr: categories.nameAr, nameEn: categories.nameEn, qty: sql<number>`sum(${orderLines.qty})` })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .innerJoin(products, eq(orderLines.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(w)
    .groupBy(categories.id)
    .all();

  const byClient = tx
    .select({ clientId: orders.clientId, name: clients.name, orders: count(), items: sql<number>`sum(${orders.itemsCount})`, salesUsd: sql<number>`sum(${orders.totalUsd})` })
    .from(orders)
    .leftJoin(clients, eq(orders.clientId, clients.id))
    .where(w)
    .groupBy(orders.clientId)
    .orderBy(desc(sql`sum(${orders.totalUsd})`))
    .all()
    .map((r) => ({ ...r, salesUsd: round4(r.salesUsd), balanceUsd: r.clientId ? clientBalanceUsd(tx, r.clientId) : null }));

  const exp = tx
    .select({ categoryId: expenses.categoryId, nameAr: lookups.nameAr, nameEn: lookups.nameEn, usd: sql<number>`sum(${expenses.amountUsd})`, n: count() })
    .from(expenses)
    .leftJoin(lookups, eq(expenses.categoryId, lookups.id))
    .where(and(gte(expenses.date, from), lte(expenses.date, to), isNull(expenses.deletedAt)))
    .groupBy(expenses.categoryId)
    .all();
  const expensesUsd = round4(exp.reduce((s, e) => s + e.usd, 0));

  const wasteRows = tx
    .select({ itemId: stockMoves.itemId, nameAr: items.nameAr, nameEn: items.nameEn, qty: sql<number>`-sum(${stockMoves.qty})`, usd: sql<number>`-sum(${stockMoves.qty} * ${stockMoves.unitCostUsd})` })
    .from(stockMoves)
    .innerJoin(items, eq(stockMoves.itemId, items.id))
    .where(and(eq(stockMoves.type, "waste"), gte(stockMoves.businessDate, from), lte(stockMoves.businessDate, to), isNull(stockMoves.deletedAt)))
    .groupBy(stockMoves.itemId)
    .all();
  const wasteUsd = round4(wasteRows.reduce((s, x) => s + x.usd, 0));

  const dep = depreciationUsd(tx, from, to);
  const salaries = tx
    .select({ usd: sql<number>`coalesce(sum(${payslips.netUsd} + ${payslips.advancesUsd} + ${payslips.staffPurchasesUsd}),0)` })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payslips.runId, payrollRuns.id))
    .where(and(eq(payrollRuns.status, "paid"), gte(payrollRuns.month, monthOf(from)), lte(payrollRuns.month, monthOf(to))))
    .get()!.usd;

  const trialsGiven = tx.select({ n: count() }).from(orders).where(and(liveOrders(from, to), eq(orders.type, "trial"))).get()?.n ?? 0;
  const converted = tx.select({ n: count() }).from(clients).where(and(gte(clients.convertedAt, from), lte(clients.convertedAt, `${to}~`))).get()?.n ?? 0;

  const salesUsd = round4(o.salesUsd);
  const costUsd = round4(o.costUsd);
  // Taxes collected belong to the government, not to the shop.
  const grossProfitUsd = round4(salesUsd - round4(extra.taxUsd) - costUsd);
  const netUsd = round4(grossProfitUsd - expensesUsd - wasteUsd - dep.totalUsd - salaries);
  return {
    from,
    to,
    orders: o.orders,
    items: o.items,
    freeItems: o.freeItems,
    salesUsd,
    grossUsd: round4(extra.grossUsd),
    discountUsd: round4(extra.discountUsd),
    taxUsd: round4(extra.taxUsd),
    deliveryUsd: round4(extra.deliveryUsd),
    costUsd,
    grossProfitUsd,
    marginPct: salesUsd > 0 ? round4((grossProfitUsd / salesUsd) * 100) : 0,
    expensesUsd,
    wasteUsd,
    depreciationUsd: dep.totalUsd,
    salariesUsd: round4(salaries),
    netUsd,
    byStatus: byStatus.map((x) => ({ ...x, usd: round4(x.usd) })),
    byMethod: byMethod.map((x) => ({ ...x, usd: round4(x.usd) })),
    byType,
    byProduct,
    byCategory,
    byClient,
    expenses: exp.map((x) => ({ ...x, usd: round4(x.usd) })),
    waste: wasteRows.map((x) => ({ ...x, usd: round4(x.usd) })),
    depreciation: dep.perAsset,
    trials: { given: trialsGiven, converted, rate: trialsGiven ? round4((converted / trialsGiven) * 100) : 0 },
  };
}

/** Clients who owe money, biggest first. */
export function unpaidBalances(tx: Q) {
  return tx
    .select()
    .from(clients)
    .where(isNull(clients.deletedAt))
    .all()
    .map((c) => ({ id: c.id, name: c.name, balanceUsd: clientBalanceUsd(tx, c.id), creditLimitUsd: c.creditLimitUsd }))
    .filter((c) => c.balanceUsd < -0.009)
    .sort((a, b) => a.balanceUsd - b.balanceUsd);
}

/** Things that need attention right now. */
export function alerts(tx: Q) {
  const now = new Date();
  const nowIsoStr = now.toISOString();
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const batchRows = tx
    .select({ b: batches, nameAr: items.nameAr, nameEn: items.nameEn, unitCode: items.unitCode })
    .from(batches)
    .innerJoin(items, eq(batches.itemId, items.id))
    .where(and(sql`${batches.qtyLeft} > 0`, isNull(batches.deletedAt), lte(batches.expiresAt, endToday.toISOString())))
    .orderBy(asc(batches.expiresAt))
    .all();
  const low = tx
    .select()
    .from(items)
    .where(and(isNull(items.deletedAt), eq(items.active, true), sql`${items.minLevel} > 0`))
    .all()
    .map((i) => ({ id: i.id, nameAr: i.nameAr, nameEn: i.nameEn, unitCode: i.unitCode, qty: round4(itemQty(tx, i.id)), minLevel: i.minLevel }))
    .filter((i) => i.qty < i.minLevel);
  const nearLimit = tx
    .select()
    .from(clients)
    .where(and(isNull(clients.deletedAt), sql`${clients.creditLimitUsd} > 0`))
    .all()
    .map((c) => ({ id: c.id, name: c.name, balanceUsd: clientBalanceUsd(tx, c.id), limitUsd: c.creditLimitUsd }))
    .filter((c) => -c.balanceUsd >= c.limitUsd * 0.8);
  const reps = tx
    .select()
    .from(cashBoxes)
    .where(and(eq(cashBoxes.kind, "rep"), isNull(cashBoxes.deletedAt)))
    .all()
    .map((b) => ({ id: b.id, nameAr: b.nameAr, nameEn: b.nameEn, currency: b.currency, balance: boxBalance(tx, b.id) }))
    .filter((b) => b.balance > 0.009);
  return {
    expired: batchRows.filter((r) => r.b.expiresAt! <= nowIsoStr).map((r) => ({ ...r.b, nameAr: r.nameAr, nameEn: r.nameEn, unitCode: r.unitCode })),
    expiresToday: batchRows.filter((r) => r.b.expiresAt! > nowIsoStr).map((r) => ({ ...r.b, nameAr: r.nameAr, nameEn: r.nameEn, unitCode: r.unitCode })),
    lowStock: low,
    nearCreditLimit: nearLimit,
    repCash: reps,
  };
}

export function dashboard(tx: Q) {
  const today = localDate();
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => {
    const r = tx.select({ usd: sql<number>`coalesce(sum(${orders.totalUsd}),0)`, n: count() }).from(orders).where(liveOrders(d, d)).get()!;
    return { date: d, salesUsd: round4(r.usd), orders: r.n };
  });
  const recent = tx
    .select({ o: orders, clientName: clients.name })
    .from(orders)
    .leftJoin(clients, eq(orders.clientId, clients.id))
    .where(and(eq(orders.businessDate, today), isNull(orders.deletedAt)))
    .orderBy(desc(orders.number))
    .limit(12)
    .all()
    .map((r) => ({ ...r.o, clientName: r.clientName }));
  const boxes = tx
    .select()
    .from(cashBoxes)
    .where(and(isNull(cashBoxes.deletedAt), eq(cashBoxes.active, true)))
    .all()
    .map((b) => ({ id: b.id, nameAr: b.nameAr, nameEn: b.nameEn, kind: b.kind, currency: b.currency, balance: boxBalance(tx, b.id) }));
  const todayMoves = tx
    .select({ boxId: boxMoves.boxId, sum: sql<number>`sum(${boxMoves.amount})` })
    .from(boxMoves)
    .where(and(eq(boxMoves.businessDate, today), isNull(boxMoves.deletedAt)))
    .groupBy(boxMoves.boxId)
    .all();
  return { date: today, today: periodReport(tx, today, today), week, recent, alerts: alerts(tx), boxes: boxes.map((b) => ({ ...b, todayIn: todayMoves.find((m) => m.boxId === b.id)?.sum ?? 0 })), unpaid: unpaidBalances(tx).slice(0, 8) };
}
