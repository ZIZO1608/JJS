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
  purchases,
  returnLines,
  returns,
  stockMoves,
  suppliers,
} from "../db/schema.js";
import { addDays, addMonths, currentRate, localDate, monthEnd, monthOf, round4, type Q } from "../lib/biz.js";
import { getSetting } from "../lib/settings.js";
import { boxBalance, clientBalanceUsd } from "./money.js";
import { itemQty, recipeOf } from "./stock.js";
import { clientAging, consignmentOpenValueUsd, supplierDue } from "./wholesale.js";

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
    .select({
      categoryId: categories.id,
      nameAr: categories.nameAr,
      nameEn: categories.nameEn,
      qty: sql<number>`sum(${orderLines.qty})`,
      revenueUsd: sql<number>`sum(case when ${orders.currency}='USD' then ${orderLines.lineTotal} else ${orderLines.lineTotal} / ${orders.fxRate} end)`,
      costUsd: sql<number>`sum(${orderLines.unitCostUsd} * ${orderLines.qty})`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .innerJoin(products, eq(orderLines.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(w)
    .groupBy(categories.id)
    .all()
    .map((r) => ({ ...r, revenueUsd: round4(r.revenueUsd), costUsd: round4(r.costUsd), marginPct: r.revenueUsd > 0 ? round4(((r.revenueUsd - r.costUsd) / r.revenueUsd) * 100) : 0 }));

  const byClient = tx
    .select({ clientId: orders.clientId, name: clients.name, orders: count(), items: sql<number>`sum(${orders.itemsCount})`, salesUsd: sql<number>`sum(${orders.totalUsd})`, costUsd: sql<number>`sum(${orders.costUsd})` })
    .from(orders)
    .leftJoin(clients, eq(orders.clientId, clients.id))
    .where(w)
    .groupBy(orders.clientId)
    .orderBy(desc(sql`sum(${orders.totalUsd})`))
    .all()
    .map((r) => {
      const ret = r.clientId
        ? tx.get<{ v: number; c: number }>(sql`select coalesce(sum(total_usd),0) as v, coalesce(sum(cost_usd),0) as c from returns where client_id = ${r.clientId} and consignment_id is null and deleted_at is null and business_date between ${from} and ${to}`)
        : null;
      // delivery cost charged to this client's area/rep is not split per client; profit here is sales − returns − goods cost
      const netSales = r.salesUsd - (ret?.v ?? 0);
      const profit = netSales - (r.costUsd - (ret?.c ?? 0));
      return {
        ...r,
        salesUsd: round4(r.salesUsd),
        returnsUsd: round4(ret?.v ?? 0),
        costUsd: round4(r.costUsd),
        profitUsd: round4(profit),
        marginPct: netSales > 0 ? round4((profit / netSales) * 100) : 0,
        balanceUsd: r.clientId ? clientBalanceUsd(tx, r.clientId) : null,
        overdueDays: r.clientId ? clientAging(tx, r.clientId, to).overdueDays : 0,
      };
    });

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

  // Returns of invoiced goods reduce sales and goods cost (unsold consignment goods were never sold).
  const ret = tx
    .select({ n: count(), usd: sql<number>`coalesce(sum(${returns.totalUsd}),0)`, cost: sql<number>`coalesce(sum(${returns.costUsd}),0)` })
    .from(returns)
    .where(and(isNull(returns.deletedAt), sql`${returns.consignmentId} is null`, gte(returns.businessDate, from), lte(returns.businessDate, to)))
    .get()!;
  const returnsByAction = tx
    .select({ action: returnLines.action, qty: sql<number>`coalesce(sum(${returnLines.qty}),0)` })
    .from(returnLines)
    .innerJoin(returns, eq(returnLines.returnId, returns.id))
    .where(and(isNull(returns.deletedAt), gte(returns.businessDate, from), lte(returns.businessDate, to)))
    .groupBy(returnLines.action)
    .all();
  const internal = tx.select({ n: count(), items: sql<number>`coalesce(sum(${orders.itemsCount}),0)`, cost: sql<number>`coalesce(sum(${orders.costUsd}),0)` }).from(orders).where(and(liveOrders(from, to), eq(orders.type, "internal"))).get()!;
  const internalUse = tx.get<{ c: number }>(sql`select coalesce(-sum(qty * unit_cost_usd),0) as c from stock_moves where ref_type = 'internal' and deleted_at is null and business_date between ${from} and ${to}`)?.c ?? 0;
  const purch = tx.select({ n: count(), usd: sql<number>`coalesce(sum(${purchases.totalUsd}),0)` }).from(purchases).where(and(isNull(purchases.deletedAt), gte(purchases.date, from), lte(purchases.date, to))).get()!;
  const moneyIn = tx.get<{ v: number }>(sql`select coalesce(sum(amount_usd),0) as v from box_moves where deleted_at is null and type in ('sale','client_payment','topup') and business_date between ${from} and ${to}`)?.v ?? 0;
  const withdrawals = tx.get<{ v: number }>(sql`select coalesce(-sum(amount_usd),0) as v from box_moves where deleted_at is null and type = 'withdrawal' and business_date between ${from} and ${to}`)?.v ?? 0;
  const dueExpenses = tx.get<{ v: number }>(sql`select coalesce(sum(amount_usd),0) as v from expenses where deleted_at is null and status = 'due' and date between ${from} and ${to}`)?.v ?? 0;
  // average rate of the period's sales (for showing the numbers in SYP)
  const rateRow = tx.get<{ r: number | null }>(sql`select sum(total_usd * fx_rate) / nullif(sum(total_usd),0) as r from orders where status != 'cancelled' and deleted_at is null and fx_rate is not null and business_date between ${from} and ${to}`);
  const avgRate = rateRow?.r ? round4(rateRow.r) : currentRate();

  const trialsGiven = tx.select({ n: count() }).from(orders).where(and(liveOrders(from, to), eq(orders.type, "trial"))).get()?.n ?? 0;
  const converted = tx.select({ n: count() }).from(clients).where(and(gte(clients.convertedAt, from), lte(clients.convertedAt, `${to}~`))).get()?.n ?? 0;

  const salesUsd = round4(o.salesUsd);
  const returnsUsd = round4(ret.usd);
  const netSalesUsd = round4(salesUsd - returnsUsd);
  const costUsd = round4(o.costUsd - ret.cost);
  // Taxes collected belong to the government, not to the shop.
  const grossProfitUsd = round4(netSalesUsd - round4(extra.taxUsd) - costUsd);
  const netUsd = round4(grossProfitUsd - expensesUsd - wasteUsd - dep.totalUsd - salaries);
  return {
    from,
    to,
    orders: o.orders,
    items: o.items,
    freeItems: o.freeItems,
    salesUsd,
    returnsUsd,
    returnsCount: ret.n,
    returnedQty: { restock: returnsByAction.find((x) => x.action === "restock")?.qty ?? 0, waste: returnsByAction.find((x) => x.action === "waste")?.qty ?? 0 },
    netSalesUsd,
    collectedUsd: round4(moneyIn),
    purchasesUsd: round4(purch.usd),
    purchasesCount: purch.n,
    internalUse: { orders: internal.n, items: internal.items, costUsd: round4(internal.cost + internalUse) },
    withdrawalsUsd: round4(withdrawals),
    dueExpensesUsd: round4(dueExpenses),
    avgRate,
    grossUsd: round4(extra.grossUsd),
    discountUsd: round4(extra.discountUsd),
    taxUsd: round4(extra.taxUsd),
    deliveryUsd: round4(extra.deliveryUsd),
    costUsd,
    grossProfitUsd,
    marginPct: netSalesUsd > 0 ? round4((grossProfitUsd / netSalesUsd) * 100) : 0,
    operatingProfitUsd: round4(grossProfitUsd - expensesUsd - wasteUsd - salaries),
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
  const overdue = tx
    .select()
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.active, true)))
    .all()
    .map((c) => ({ id: c.id, name: c.name, ...clientAging(tx, c.id) }))
    .filter((c) => c.overdueDays > 0)
    .sort((a, b) => b.overdueDays - a.overdueDays);
  const dueExpenses = tx.all<{ id: string; date: string; amount: number; currency: string; note: string }>(sql`select id, date, amount, currency, note from expenses where deleted_at is null and status = 'due' and coalesce(due_date, date) <= ${localDate()} order by date`);
  const pay = payables(tx);
  return {
    overdueClients: overdue,
    dueExpenses,
    suppliersOverdueUsd: pay.overdueUsd,
    expired: batchRows.filter((r) => r.b.expiresAt! <= nowIsoStr).map((r) => ({ ...r.b, nameAr: r.nameAr, nameEn: r.nameEn, unitCode: r.unitCode })),
    expiresToday: batchRows.filter((r) => r.b.expiresAt! > nowIsoStr).map((r) => ({ ...r.b, nameAr: r.nameAr, nameEn: r.nameEn, unitCode: r.unitCode })),
    lowStock: low,
    nearCreditLimit: nearLimit,
    repCash: reps,
  };
}

/** What we owe suppliers, in total. */
export function payables(tx: Q) {
  const rows = tx.select({ id: suppliers.id }).from(suppliers).where(isNull(suppliers.deletedAt)).all().map((s) => supplierDue(tx, s.id));
  return { totalUsd: round4(rows.reduce((a, r) => a + r.totalDueUsd, 0)), overdueUsd: round4(rows.reduce((a, r) => a + r.overdueUsd, 0)) };
}

/** Money in all boxes, in USD (SYP boxes at today's rate). */
export function cashOnHandUsd(tx: Q) {
  const rate = currentRate();
  return round4(
    tx
      .select()
      .from(cashBoxes)
      .where(and(isNull(cashBoxes.deletedAt), eq(cashBoxes.active, true)))
      .all()
      .reduce((s, b) => {
        const bal = boxBalance(tx, b.id);
        return s + (b.currency === "USD" ? bal : rate ? bal / rate : 0);
      }, 0),
  );
}

/**
 * "Your day in five answers" (JJ's final question list):
 * how much was sold, what it cost, profit after all expenses, cash and debts, and are prices still profitable.
 */
export function fiveAnswers(tx: Q, date = localDate()) {
  const r = periodReport(tx, date, date);
  const receivables = unpaidBalances(tx);
  const target = getSetting("costing").targetMarginPct;
  const rate = currentRate();
  const lowMargin = tx
    .select()
    .from(products)
    .where(and(isNull(products.deletedAt), eq(products.active, true)))
    .all()
    .map((p) => {
      const cost = recipeOf(tx, { productId: p.id }).reduce((s, x) => s + x.qty * x.avgCostUsd, 0) + p.extraCostUsd;
      const price = p.currency === "USD" ? p.price : rate ? p.price / rate : null;
      const margin = price && cost > 0 ? ((price - cost) / price) * 100 : null;
      return { productId: p.id, nameAr: p.nameAr, nameEn: p.nameEn, marginPct: margin === null ? null : round4(margin) };
    })
    .filter((x) => x.marginPct !== null && x.marginPct < target);
  return {
    date,
    rate,
    sold: { items: r.items, orders: r.orders, salesUsd: r.netSalesUsd },
    cost: { goodsUsd: r.costUsd, wasteUsd: r.wasteUsd },
    profit: { grossUsd: r.grossProfitUsd, afterExpensesUsd: r.netUsd ?? 0, expensesUsd: r.expensesUsd },
    money: { cashUsd: cashOnHandUsd(tx), collectedTodayUsd: r.collectedUsd, clientsOweUsd: round4(-receivables.reduce((s, c) => s + c.balanceUsd, 0)), weOweUsd: payables(tx).totalUsd, goodsAtShopsUsd: consignmentOpenValueUsd(tx) },
    prices: { ok: lowMargin.length === 0, targetMarginPct: target, below: lowMargin },
  };
}

/**
 * Production vs sales for each product: what was there in the morning, made, sold from the fridge,
 * left on consignment, returned, wasted, counted, and what is left — straight from the stock ledger.
 * "Made fresh" is what orders took straight from ingredients.
 */
export function productionVsSales(tx: Q, from: string, to: string) {
  const rows = tx.all<{ item_id: string; product_id: string; name_ar: string; name_en: string; type: string; ref_type: string | null; q: number }>(
    sql`select m.item_id, i.product_id, i.name_ar, i.name_en, m.type, m.ref_type, sum(m.qty) as q from stock_moves m join items i on i.id = m.item_id
        where i.kind = 'product' and m.deleted_at is null and m.business_date between ${from} and ${to} group by m.item_id, m.type, m.ref_type`,
  );
  const sold = tx.all<{ product_id: string; q: number }>(sql`select ol.product_id, sum(ol.qty) as q from order_lines ol join orders o on o.id = ol.order_id where o.status != 'cancelled' and o.deleted_at is null and o.consignment_id is null and o.business_date between ${from} and ${to} group by ol.product_id`);
  const consSold = tx.all<{ product_id: string; q: number }>(sql`select cl.product_id, sum(cl.qty - cl.returned_qty) as q from consignment_lines cl join consignments c on c.id = cl.consignment_id where c.status = 'settled' and c.business_date between ${from} and ${to} group by cl.product_id`);
  const byItem = new Map<string, { productId: string; nameAr: string; nameEn: string; opening: number; made: number; fromFridge: number; consigned: number; returnedIn: number; wasted: number; counted: number; other: number; closing: number; soldTotal: number; madeFresh: number; consignSold: number }>();
  for (const r of rows) {
    let x = byItem.get(r.item_id);
    if (!x) {
      const opening = tx.get<{ q: number }>(sql`select coalesce(sum(qty),0) as q from stock_moves where item_id = ${r.item_id} and deleted_at is null and business_date < ${from}`)?.q ?? 0;
      x = { productId: r.product_id, nameAr: r.name_ar, nameEn: r.name_en, opening: round4(opening), made: 0, fromFridge: 0, consigned: 0, returnedIn: 0, wasted: 0, counted: 0, other: 0, closing: 0, soldTotal: 0, madeFresh: 0, consignSold: 0 };
      byItem.set(r.item_id, x);
    }
    if (r.type === "production") x.made += r.q;
    else if (r.type === "sale") x.fromFridge += -r.q;
    else if (r.type === "consign") x.consigned += -r.q;
    else if (r.type === "return") x.returnedIn += r.q;
    else if (r.type === "waste") x.wasted += -r.q;
    else if (r.type === "count") x.counted += r.q;
    else if (r.type !== "transfer") x.other += r.q;
  }
  for (const s of sold) {
    const x = [...byItem.values()].find((v) => v.productId === s.product_id);
    if (x) x.soldTotal = s.q;
  }
  for (const s of consSold) {
    const x = [...byItem.values()].find((v) => v.productId === s.product_id);
    if (x) x.consignSold = s.q;
  }
  return [...byItem.entries()].map(([itemId, x]) => {
    const closing = round4(x.opening + x.made - x.fromFridge - x.consigned + x.returnedIn - x.wasted + x.counted + x.other);
    return { itemId, ...x, madeFresh: Math.max(0, x.soldTotal - x.fromFridge), closing, leftNow: round4(itemQty(tx, itemId)), difference: round4(x.counted) };
  });
}

/** Where the money went: money in and out of every box by kind of movement. */
export function cashFlow(tx: Q, from: string, to: string) {
  const rows = tx.all<{ box_id: string; type: string; usd: number; amount: number; n: number }>(
    sql`select box_id, type, sum(amount_usd) as usd, sum(amount) as amount, count(*) as n from box_moves where deleted_at is null and business_date between ${from} and ${to} group by box_id, type`,
  );
  const boxes = tx.select().from(cashBoxes).where(isNull(cashBoxes.deletedAt)).all();
  const opening = (boxId: string) => tx.get<{ s: number }>(sql`select coalesce(sum(amount),0) as s from box_moves where box_id = ${boxId} and deleted_at is null and business_date < ${from}`)?.s ?? 0;
  const perBox = boxes.map((b) => {
    const mine = rows.filter((r) => r.box_id === b.id);
    const open = opening(b.id);
    const net = mine.reduce((s, r) => s + r.amount, 0);
    return { id: b.id, nameAr: b.nameAr, nameEn: b.nameEn, currency: b.currency, opening: round4(open), moves: mine.map((r) => ({ type: r.type, amount: round4(r.amount), usd: round4(r.usd), n: r.n })), closing: round4(open + net) };
  });
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + r.usd);
  const inUsd = round4(rows.filter((r) => r.usd > 0).reduce((s, r) => s + r.usd, 0));
  const outUsd = round4(-rows.filter((r) => r.usd < 0).reduce((s, r) => s + r.usd, 0));
  return { from, to, boxes: perBox, byType: [...byType.entries()].map(([type, usd]) => ({ type, usd: round4(usd) })), inUsd, outUsd, netUsd: round4(inUsd - outUsd) };
}

/** Month by month: sales, costs, profit (last n months, oldest first). */
export function monthsCompare(tx: Q, n = 6) {
  const today = localDate();
  return Array.from({ length: n }, (_, i) => addMonths(`${monthOf(today)}-01`, i - (n - 1))).map((start) => {
    const end = start.slice(0, 7) === monthOf(today) ? today : monthEnd(start);
    const r = periodReport(tx, start, end);
    return { month: start.slice(0, 7), orders: r.orders, items: r.items, salesUsd: r.netSalesUsd, costUsd: r.costUsd, grossProfitUsd: r.grossProfitUsd, expensesUsd: r.expensesUsd, wasteUsd: r.wasteUsd, salariesUsd: r.salariesUsd, depreciationUsd: r.depreciationUsd, netUsd: r.netUsd, marginPct: r.marginPct, avgRate: r.avgRate };
  });
}

/** Delivery & distribution cost: expenses linked to a rep, plus transport/fuel categories. */
export function deliveryCost(tx: Q, from: string, to: string) {
  const rows = tx.all<{ employee_id: string | null; name: string | null; cat: string | null; usd: number; n: number }>(
    sql`select e.employee_id, emp.name as name, l.name_en as cat, sum(e.amount_usd) as usd, count(*) as n from expenses e
        left join employees emp on emp.id = e.employee_id left join lookups l on l.id = e.category_id
        where e.deleted_at is null and e.date between ${from} and ${to}
          and (e.employee_id is not null or l.name_en in ('Transport & distribution','Fuel','Delivery & scooter'))
        group by e.employee_id, l.name_en`,
  );
  const deliveries = tx.get<{ n: number; fees: number }>(sql`select count(*) as n, coalesce(sum(case when currency='USD' then delivery_fee else delivery_fee / fx_rate end),0) as fees from orders where status != 'cancelled' and fulfilment = 'delivery' and business_date between ${from} and ${to}`);
  const totalUsd = round4(rows.reduce((s, r) => s + r.usd, 0));
  return { rows: rows.map((r) => ({ employeeId: r.employee_id, name: r.name, category: r.cat, usd: round4(r.usd), n: r.n })), totalUsd, deliveries: deliveries?.n ?? 0, perDeliveryUsd: deliveries?.n ? round4(totalUsd / deliveries.n) : null, feesCollectedUsd: round4(deliveries?.fees ?? 0) };
}

/** `five` (the phone dashboard's "day in five answers") repeats the day's report; only the cloud sync asks for it. */
export function dashboard(tx: Q, opts: { five?: boolean } = {}) {
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
  return {
    date: today,
    today: periodReport(tx, today, today),
    week,
    recent,
    alerts: alerts(tx),
    boxes: boxes.map((b) => ({ ...b, todayIn: todayMoves.find((m) => m.boxId === b.id)?.sum ?? 0 })),
    unpaid: unpaidBalances(tx).slice(0, 8),
    ...(opts.five ? { five: fiveAnswers(tx, today) } : {}),
    stockValueUsd: round4(tx.all<{ v: number }>(sql`select coalesce(sum(case when q > 0 then q * avg_cost_usd else 0 end),0) as v from (select i.avg_cost_usd, (select coalesce(sum(qty),0) from stock_moves m where m.item_id = i.id and m.deleted_at is null) as q from items i where i.deleted_at is null)`)[0]?.v ?? 0),
  };
}

/**
 * "My day" — the five boxes: profit, net, what was made, what came out of the warehouse, and the cash boxes.
 * Net here is profit minus the day's expenses and waste (salaries and depreciation are monthly — see reports).
 */
export function myDay(tx: Q, date: string) {
  const r = periodReport(tx, date, date);
  const fromStock = productionVsSales(tx, date, date)
    .map((x) => ({ productId: x.productId, nameAr: x.nameAr, nameEn: x.nameEn, made: round4(x.made + x.madeFresh), sold: round4(x.soldTotal) }));
  // Products never kept in the fridge have no stock moves: everything sold was made fresh.
  for (const p of r.byProduct) if (!fromStock.some((x) => x.productId === p.productId)) fromStock.push({ productId: p.productId, nameAr: p.nameAr, nameEn: p.nameEn, made: round4(p.qty), sold: round4(p.qty) });
  const made = fromStock.filter((x) => x.made > 0 || x.sold > 0).sort((a, b) => b.made - a.made);
  const used = tx
    .all<{ item_id: string; name_ar: string; name_en: string; unit_code: string; qty: number; usd: number }>(
      sql`select m.item_id, i.name_ar, i.name_en, i.unit_code, -sum(m.qty) as qty, -sum(m.qty * m.unit_cost_usd) as usd from stock_moves m join items i on i.id = m.item_id
          where m.type = 'use' and i.kind != 'product' and m.deleted_at is null and m.business_date = ${date} group by m.item_id order by usd desc`,
    )
    .map((x) => ({ itemId: x.item_id, nameAr: x.name_ar, nameEn: x.name_en, unitCode: x.unit_code, qty: round4(x.qty), usd: round4(x.usd) }));
  const rate = currentRate();
  const boxes = tx
    .select()
    .from(cashBoxes)
    .where(and(isNull(cashBoxes.deletedAt), sql`${cashBoxes.systemKey} in ('main_cash', 'sham')`))
    .all()
    .map((b) => {
      const d = tx.get<{ inn: number; out: number; end: number }>(
        sql`select coalesce(sum(case when business_date = ${date} and amount > 0 then amount end),0) as inn,
                   coalesce(-sum(case when business_date = ${date} and amount < 0 then amount end),0) as out,
                   coalesce(sum(amount),0) as end
            from box_moves where box_id = ${b.id} and deleted_at is null and business_date <= ${date}`,
      )!;
      const toUsd = (v: number) => (b.currency === "USD" ? v : rate ? v / rate : 0);
      return { id: b.id, systemKey: b.systemKey, nameAr: b.nameAr, nameEn: b.nameEn, currency: b.currency, in: round4(d.inn), out: round4(d.out), balance: round4(d.end), balanceUsd: round4(toUsd(d.end)) };
    })
    .sort((a) => (a.systemKey === "main_cash" ? -1 : 1));
  return {
    date,
    rate,
    profit: { usd: r.grossProfitUsd, salesUsd: r.netSalesUsd, costUsd: r.costUsd, marginPct: r.marginPct },
    net: { usd: round4(r.grossProfitUsd - r.expensesUsd - r.wasteUsd), expensesUsd: r.expensesUsd, wasteUsd: r.wasteUsd },
    made: { total: round4(made.reduce((s, x) => s + x.made, 0)), sold: r.items, orders: r.orders, rows: made },
    used: { usd: round4(used.reduce((s, x) => s + x.usd, 0)), count: used.length, rows: used },
    boxes: { totalUsd: round4(boxes.reduce((s, b) => s + b.balanceUsd, 0)), rows: boxes },
  };
}

/** Everything that is the owner's, right now: money in every box, what clients owe, goods at shops — minus what the shop owes. */
export function allMyMoney(tx: Q) {
  const rate = currentRate();
  const boxes = tx
    .select()
    .from(cashBoxes)
    .where(and(isNull(cashBoxes.deletedAt), eq(cashBoxes.active, true)))
    .all()
    .map((b) => {
      const balance = round4(boxBalance(tx, b.id));
      return { id: b.id, kind: b.kind, nameAr: b.nameAr, nameEn: b.nameEn, currency: b.currency, balance, usd: round4(b.currency === "USD" ? balance : rate ? balance / rate : 0) };
    })
    .filter((b) => Math.abs(b.balance) > 0.009);
  const cashUsd = round4(boxes.reduce((s, b) => s + b.usd, 0));
  const clientsOweUsd = round4(-unpaidBalances(tx).reduce((s, c) => s + c.balanceUsd, 0));
  const goodsAtShopsUsd = round4(consignmentOpenValueUsd(tx));
  const weOweUsd = payables(tx).totalUsd;
  const dueExpensesUsd = round4(tx.get<{ v: number }>(sql`select coalesce(sum(amount_usd),0) as v from expenses where deleted_at is null and status = 'due'`)?.v ?? 0);
  return {
    rate,
    boxes,
    cashUsd,
    clientsOweUsd,
    goodsAtShopsUsd,
    weOweUsd,
    dueExpensesUsd,
    totalUsd: round4(cashUsd + clientsOweUsd + goodsAtShopsUsd - weOweUsd - dueExpensesUsd),
  };
}

/**
 * Who took what between two moments (ISO times): one row per client with the products, how many,
 * the invoice total, what they paid on the spot and what is left. Walk-ins share one row. Amounts in USD.
 */
export function clientsSheet(tx: Q, fromIso: string, toIso: string) {
  const rows = tx.all<{ client_id: string | null; name: string | null; orders: number; items: number; total_usd: number; paid_usd: number }>(
    sql`select o.client_id, c.name, count(*) as orders, coalesce(sum(o.items_count),0) as items, coalesce(sum(o.total_usd),0) as total_usd,
               coalesce(sum(case when o.currency = 'USD' then o.paid_amount else o.paid_amount / nullif(o.fx_rate,0) end),0) as paid_usd
        from orders o left join clients c on c.id = o.client_id
        where o.status != 'cancelled' and o.deleted_at is null and o.type in ('normal','staff') and o.created_at >= ${fromIso} and o.created_at <= ${toIso}
        group by o.client_id order by total_usd desc`,
  );
  const lines = tx.all<{ client_id: string | null; name_ar: string; name_en: string; qty: number }>(
    sql`select o.client_id, l.name_ar, l.name_en, sum(l.qty) as qty from order_lines l join orders o on o.id = l.order_id
        where o.status != 'cancelled' and o.deleted_at is null and o.type in ('normal','staff') and o.created_at >= ${fromIso} and o.created_at <= ${toIso}
        group by o.client_id, l.product_id order by qty desc`,
  );
  const out = rows.map((r) => {
    const paidUsd = round4(Math.min(r.paid_usd, r.total_usd));
    return {
      clientId: r.client_id,
      name: r.name,
      orders: r.orders,
      items: r.items,
      products: lines.filter((l) => l.client_id === r.client_id).map((l) => ({ nameAr: l.name_ar, nameEn: l.name_en, qty: l.qty })),
      totalUsd: round4(r.total_usd),
      paidUsd,
      leftUsd: round4(r.total_usd - paidUsd),
    };
  });
  const sum = (k: "orders" | "items" | "totalUsd" | "paidUsd" | "leftUsd") => round4(out.reduce((s, r) => s + r[k], 0));
  return { from: fromIso, to: toIso, rate: currentRate(), rows: out, totals: { orders: sum("orders"), items: sum("items"), totalUsd: sum("totalUsd"), paidUsd: sum("paidUsd"), leftUsd: sum("leftUsd") } };
}
