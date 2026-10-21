import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { categories, items, orders, priceChanges, products, recurringOrders } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { addDays, currentRate, localDate, monthEnd, roundMoney, round4, toUsd } from "../lib/biz.js";
import { getSetting } from "../lib/settings.js";
import { gte, desc } from "drizzle-orm";
import { h, notFound, nowIso, parse } from "../lib/util.js";
import { periodReport } from "../services/reports.js";
import { itemQty, recipeCostUsd, recipeOf } from "../services/stock.js";

export const costingRouter = Router();

/** Every product's real cost (recipe incl. packaging), its price and its margin. */
costingRouter.get(
  "/products",
  requirePerm("costing", "view"),
  h((_req, res) => {
    const rate = currentRate();
    const target = getSetting("costing").targetMarginPct;
    const rows = db
      .select({ p: products, catAr: categories.nameAr, catEn: categories.nameEn })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(isNull(products.deletedAt))
      .orderBy(asc(categories.sort), asc(products.sort))
      .all()
      .map(({ p, catAr, catEn }) => {
        const recipe = recipeOf(db, { productId: p.id });
        const lines = recipe.map((r) => {
          const it = db.select().from(items).where(eq(items.id, r.itemId)).get()!;
          return { itemId: r.itemId, nameAr: it.nameAr, nameEn: it.nameEn, kind: it.kind, unitCode: it.unitCode, cleanQty: r.cleanQty, wastePct: r.wastePct, qty: r.qty, unitCostUsd: r.avgCostUsd, costUsd: round4(r.qty * r.avgCostUsd) };
        });
        const extraUsd = p.extraCostUsd;
        const costUsd = round4(lines.reduce((s, l) => s + l.costUsd, 0) + extraUsd);
        const packagingUsd = round4(lines.filter((l) => l.kind === "packaging").reduce((s, l) => s + l.costUsd, 0));
        const priceUsd = p.currency === "USD" ? p.price : rate ? p.price / rate : null;
        // price that gives the target margin: cost / (1 − margin)
        const targetUsd = target < 100 ? costUsd / (1 - target / 100) : null;
        const inCcy = (usd: number | null) => (usd === null ? null : p.currency === "USD" ? round4(usd) : rate ? roundMoney(usd * rate, "SYP") : null);
        return {
          id: p.id,
          nameAr: p.nameAr,
          nameEn: p.nameEn,
          category: { nameAr: catAr, nameEn: catEn },
          price: p.price,
          currency: p.currency,
          priceUsd: priceUsd === null ? null : round4(priceUsd),
          costUsd,
          packagingUsd,
          profitUsd: priceUsd === null ? null : round4(priceUsd - costUsd),
          marginPct: priceUsd ? round4(((priceUsd - costUsd) / priceUsd) * 100) : null,
          hasRecipe: lines.length > 0,
          lines,
          extraUsd,
          weightG: p.weightG,
          cost50Usd: round4(costUsd * 50),
          cost100Usd: round4(costUsd * 100),
          targetMarginPct: target,
          targetPriceUsd: targetUsd === null ? null : round4(targetUsd),
          /** in the product's own currency, for the screen */
          costInCurrency: inCcy(costUsd),
          targetPrice: inCcy(targetUsd),
          belowTarget: priceUsd !== null && costUsd > 0 && ((priceUsd - costUsd) / priceUsd) * 100 < target - 0.05,
        };
      });
    res.json({ rows, targetMarginPct: target, rate });
  }),
);

/** Correct an ingredient's unit cost by hand (e.g. before the first purchase is entered). */
costingRouter.put(
  "/items/:id/cost",
  requirePerm("costing", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const body = parse(z.object({ cost: z.number().min(0), currency: z.enum(["USD", "SYP"]).default("USD") }), req.body);
    const it = db.select().from(items).where(eq(items.id, id)).get();
    if (!it) throw notFound("item");
    const usd = round4(toUsd(body.cost, body.currency, currentRate()));
    db.update(items).set({ avgCostUsd: usd, updatedAt: nowIso(), syncedAt: null }).where(eq(items.id, id)).run();
    writeAudit(db, { userId: req.user!.id, action: "edit", entity: "item.cost", entityId: id, before: { avgCostUsd: it.avgCostUsd }, after: { avgCostUsd: usd } });
    res.json({ avgCostUsd: usd });
  }),
);

/** Fixed costs of a month spread over the items sold: what each sandwich must also cover. */
costingRouter.get(
  "/overheads",
  requirePerm("costing", "view"),
  h((req, res) => {
    const month = String(req.query.month ?? localDate().slice(0, 7));
    const from = `${month}-01`;
    const r = periodReport(db, from, monthEnd(from));
    const fixed = round4(r.expensesUsd + r.depreciationUsd + r.salariesUsd);
    // Break-even: how many items must be sold this month for their profit to cover the fixed costs.
    const gpPerItem = r.items ? (r.grossProfitUsd - r.wasteUsd) / r.items : null;
    const breakEvenItems = gpPerItem && gpPerItem > 0 ? Math.ceil(fixed / gpPerItem) : null;
    res.json({
      month,
      itemsSold: r.items,
      expensesUsd: r.expensesUsd,
      depreciationUsd: r.depreciationUsd,
      salariesUsd: r.salariesUsd,
      fixedUsd: fixed,
      perItemUsd: r.items ? round4(fixed / r.items) : null,
      grossProfitPerItemUsd: gpPerItem === null ? null : round4(gpPerItem),
      breakEvenItems,
      itemsLeftToBreakEven: breakEvenItems === null ? null : Math.max(0, breakEvenItems - r.items),
      reached: breakEvenItems !== null && r.items >= breakEvenItems,
    });
  }),
);

/**
 * Prep list for a day: products expected (regular clients due that weekday + orders already
 * taken for that date) and the ingredients they need versus what is in stock.
 */
costingRouter.get(
  "/prep",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const date = String(req.query.date ?? addDays(localDate(), 1));
    const dow = new Date(`${date}T12:00:00`).getDay();
    const need = new Map<string, number>();
    const add = (pid: string, q: number) => need.set(pid, (need.get(pid) ?? 0) + q);
    const orderedClients = new Set(
      db
        .select({ c: orders.clientId })
        .from(orders)
        .where(and(eq(orders.businessDate, date), ne(orders.status, "cancelled")))
        .all()
        .map((x) => x.c),
    );
    for (const r of db.select().from(recurringOrders).where(and(eq(recurringOrders.active, true), isNull(recurringOrders.deletedAt))).all()) {
      if (!r.days.split(",").map(Number).includes(dow) || orderedClients.has(r.clientId)) continue;
      for (const l of JSON.parse(r.linesJson) as { productId: string; qty: number }[]) add(l.productId, l.qty);
    }
    for (const l of db.all<{ product_id: string; qty: number }>(sql`select ol.product_id, sum(ol.qty) as qty from order_lines ol join orders o on o.id = ol.order_id where o.business_date = ${date} and o.status != 'cancelled' group by ol.product_id`))
      add(l.product_id, l.qty);

    const ingredients = new Map<string, number>();
    const productRows = [...need.entries()].map(([pid, qty]) => {
      const p = db.select().from(products).where(eq(products.id, pid)).get();
      for (const r of recipeOf(db, { productId: pid })) ingredients.set(r.itemId, (ingredients.get(r.itemId) ?? 0) + r.qty * qty);
      return { productId: pid, nameAr: p?.nameAr ?? "?", nameEn: p?.nameEn ?? "?", qty, unitCostUsd: recipeCostUsd(db, { productId: pid }) };
    });
    const ingredientRows = [...ingredients.entries()].map(([itemId, qty]) => {
      const it = db.select().from(items).where(eq(items.id, itemId)).get()!;
      const have = round4(itemQty(db, itemId));
      return { itemId, nameAr: it.nameAr, nameEn: it.nameEn, kind: it.kind, unitCode: it.unitCode, need: round4(qty), have, short: round4(Math.max(0, qty - have)) };
    });
    res.json({ date, products: productRows.sort((a, b) => b.qty - a.qty), ingredients: ingredientRows.sort((a, b) => b.short - a.short || a.nameEn.localeCompare(b.nameEn)) });
  }),
);

/**
 * Price-change radar: recent ingredient price moves and what they did to each product's cost and margin,
 * with the price that would bring the margin back to the target.
 */
costingRouter.get(
  "/impact",
  requirePerm("costing", "view"),
  h((req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
    const since = addDays(localDate(), -days);
    const target = getSetting("costing").targetMarginPct;
    const rate = currentRate();
    const changes = db
      .select({ c: priceChanges, nameAr: items.nameAr, nameEn: items.nameEn, unitCode: items.unitCode })
      .from(priceChanges)
      .innerJoin(items, eq(priceChanges.itemId, items.id))
      .where(and(isNull(priceChanges.deletedAt), gte(priceChanges.businessDate, since)))
      .orderBy(desc(priceChanges.createdAt))
      .all();
    // earliest "old" cost per item inside the window = the cost before the first change
    const oldCost = new Map<string, number>();
    for (const c of [...changes].reverse()) if (!oldCost.has(c.c.itemId)) oldCost.set(c.c.itemId, c.c.oldCostUsd);
    const affected = db
      .select()
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.active, true)))
      .all()
      .map((p) => {
        const recipe = recipeOf(db, { productId: p.id });
        const hit = recipe.filter((r) => oldCost.has(r.itemId));
        if (!hit.length) return null;
        const now = recipe.reduce((s, r) => s + r.qty * r.avgCostUsd, 0) + p.extraCostUsd;
        const before = recipe.reduce((s, r) => s + r.qty * (oldCost.get(r.itemId) ?? r.avgCostUsd), 0) + p.extraCostUsd;
        const priceUsd = p.currency === "USD" ? p.price : rate ? p.price / rate : null;
        const m = (c: number) => (priceUsd ? round4(((priceUsd - c) / priceUsd) * 100) : null);
        const suggestUsd = target < 100 ? now / (1 - target / 100) : null;
        return {
          productId: p.id,
          nameAr: p.nameAr,
          nameEn: p.nameEn,
          price: p.price,
          currency: p.currency,
          costBeforeUsd: round4(before),
          costNowUsd: round4(now),
          profitChangeUsd: round4(before - now),
          marginBefore: m(before),
          marginNow: m(now),
          belowTarget: (m(now) ?? 100) < target,
          suggestedPrice: suggestUsd === null ? null : p.currency === "USD" ? round4(suggestUsd) : rate ? roundMoney(suggestUsd * rate, "SYP") : null,
          items: hit.map((r) => r.itemId),
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.profitChangeUsd - b.profitChangeUsd);
    res.json({
      since,
      targetMarginPct: target,
      changes: changes.map((c) => ({ ...c.c, nameAr: c.nameAr, nameEn: c.nameEn, unitCode: c.unitCode })),
      products: affected,
    });
  }),
);

/**
 * Forecast for a day: the average sold per product on the same weekday over the last 4 weeks,
 * and the materials that would need. An estimate, not a promise.
 */
costingRouter.get(
  "/forecast",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const date = String(req.query.date ?? addDays(localDate(), 1));
    const weeks = [1, 2, 3, 4].map((w) => addDays(date, -7 * w));
    const sold = db.all<{ product_id: string; qty: number }>(
      sql`select product_id, sum(qty) as qty from (
            select ol.product_id, ol.qty from order_lines ol join orders o on o.id = ol.order_id
              where o.status != 'cancelled' and o.consignment_id is null and o.business_date in (${sql.join(weeks.map((d) => sql`${d}`), sql`,`)})
            union all
            select cl.product_id, cl.qty - cl.returned_qty from consignment_lines cl join consignments c on c.id = cl.consignment_id
              where c.status != 'cancelled' and c.business_date in (${sql.join(weeks.map((d) => sql`${d}`), sql`,`)})
          ) group by product_id`,
    );
    const mats = new Map<string, number>();
    const productsOut = sold
      .map((r) => {
        const p = db.select().from(products).where(eq(products.id, r.product_id)).get();
        const qty = Math.ceil(r.qty / weeks.length);
        for (const x of recipeOf(db, { productId: r.product_id })) mats.set(x.itemId, (mats.get(x.itemId) ?? 0) + x.qty * qty);
        return { productId: r.product_id, nameAr: p?.nameAr ?? "?", nameEn: p?.nameEn ?? "?", qty };
      })
      .filter((x) => x.qty > 0)
      .sort((a, b) => b.qty - a.qty);
    const materials = [...mats.entries()].map(([itemId, need]) => {
      const it = db.select().from(items).where(eq(items.id, itemId)).get()!;
      const have = round4(itemQty(db, itemId));
      return { itemId, nameAr: it.nameAr, nameEn: it.nameEn, kind: it.kind, unitCode: it.unitCode, need: round4(need), have, short: round4(Math.max(0, need - have)) };
    });
    res.json({ date, basedOn: weeks, products: productsOut, materials: materials.sort((a, b) => b.short - a.short) });
  }),
);
