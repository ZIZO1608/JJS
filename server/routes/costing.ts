import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { categories, items, orders, products, recurringOrders } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { addDays, currentRate, localDate, monthEnd, round4, toUsd } from "../lib/biz.js";
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
          return { itemId: r.itemId, nameAr: it.nameAr, nameEn: it.nameEn, kind: it.kind, unitCode: it.unitCode, qty: r.qty, unitCostUsd: r.avgCostUsd, costUsd: round4(r.qty * r.avgCostUsd) };
        });
        const costUsd = round4(lines.reduce((s, l) => s + l.costUsd, 0));
        const packagingUsd = round4(lines.filter((l) => l.kind === "packaging").reduce((s, l) => s + l.costUsd, 0));
        const priceUsd = p.currency === "USD" ? p.price : rate ? p.price / rate : null;
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
        };
      });
    res.json({ rows });
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
    res.json({ month, itemsSold: r.items, expensesUsd: r.expensesUsd, depreciationUsd: r.depreciationUsd, salariesUsd: r.salariesUsd, fixedUsd: fixed, perItemUsd: r.items ? round4(fixed / r.items) : null });
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
