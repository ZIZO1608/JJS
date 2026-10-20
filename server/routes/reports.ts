import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { clients, expenses, lookups, orders, paymentMethods } from "../db/schema.js";
import { requirePerm } from "../lib/auth.js";
import { localDate } from "../lib/biz.js";
import { h, HttpError, parse } from "../lib/util.js";
import { dashboard, periodReport, unpaidBalances } from "../services/reports.js";

export const reportsRouter = Router();
const range = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

reportsRouter.get(
  "/dashboard",
  requirePerm("dashboard", "view"),
  h((_req, res) => res.json(dashboard(db))),
);

reportsRouter.get(
  "/range",
  requirePerm("reports", "view"),
  h((req, res) => {
    const q = parse(range, { from: req.query.from ?? localDate(), to: req.query.to ?? localDate() });
    if (q.from > q.to) throw new HttpError(400, "bad_range", "The start date is after the end date.");
    const report = periodReport(db, q.from, q.to);
    // Costs and profit are hidden from roles that cannot see costs.
    if (!req.user!.permissions.has("costing:see_cost")) {
      const { costUsd: _c, grossProfitUsd: _g, marginPct: _m, netUsd: _n, ...rest } = report;
      return res.json({ ...rest, byProduct: report.byProduct.map(({ costUsd: _x, marginPct: _y, ...p }) => p), hiddenCosts: true, unpaid: unpaidBalances(db) });
    }
    res.json({ ...report, unpaid: unpaidBalances(db) });
  }),
);

const csv = (rows: (string | number | null | undefined)[][]) =>
  "﻿" + rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\r\n");

/** CSV files that open in Excel (UTF-8 with BOM so Arabic shows correctly). */
reportsRouter.get(
  "/export/:kind.csv",
  requirePerm("reports", "export"),
  h((req, res) => {
    const q = parse(range, req.query);
    const kind = String(req.params.kind);
    let rows: (string | number | null)[][];
    if (kind === "orders") {
      const list = db
        .select({ o: orders, client: clients.name, method: paymentMethods.nameEn })
        .from(orders)
        .leftJoin(clients, eq(orders.clientId, clients.id))
        .leftJoin(paymentMethods, eq(orders.methodId, paymentMethods.id))
        .where(and(gte(orders.businessDate, q.from), lte(orders.businessDate, q.to), isNull(orders.deletedAt)))
        .orderBy(asc(orders.number))
        .all();
      rows = [["Number", "Date", "Client", "Type", "Status", "Payment", "Method", "Items", "Free items", "Subtotal", "Discount", "Tax", "Delivery", "Total", "Currency", "Total USD", "Cost USD"]];
      for (const r of list) rows.push([r.o.number, r.o.businessDate, r.client ?? "Walk-in", r.o.type, r.o.status, r.o.paymentStatus, r.method, r.o.itemsCount, r.o.freeItems, r.o.subtotal, r.o.discount, r.o.taxTotal, r.o.deliveryFee, r.o.total, r.o.currency, r.o.totalUsd, r.o.costUsd]);
    } else if (kind === "products") {
      const rep = periodReport(db, q.from, q.to);
      rows = [["Product (EN)", "Product (AR)", "Qty", "Revenue USD", "Cost USD", "Margin %"]];
      for (const p of rep.byProduct) rows.push([p.nameEn, p.nameAr, p.qty, p.revenueUsd, p.costUsd, p.marginPct]);
    } else if (kind === "clients") {
      const rep = periodReport(db, q.from, q.to);
      rows = [["Client", "Orders", "Items", "Sales USD", "Balance USD"]];
      for (const c of rep.byClient) rows.push([c.name ?? "Walk-in", c.orders, c.items, c.salesUsd, c.balanceUsd]);
    } else if (kind === "expenses") {
      const list = db
        .select({ e: expenses, cat: lookups.nameEn })
        .from(expenses)
        .leftJoin(lookups, eq(expenses.categoryId, lookups.id))
        .where(and(gte(expenses.date, q.from), lte(expenses.date, q.to), isNull(expenses.deletedAt)))
        .orderBy(asc(expenses.date))
        .all();
      rows = [["Date", "Category", "Amount", "Currency", "Amount USD", "Note"]];
      for (const r of list) rows.push([r.e.date, r.cat, r.e.amount, r.e.currency, r.e.amountUsd, r.e.note]);
    } else throw new HttpError(404, "not_found", "Unknown export.");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="jjs-${kind}-${q.from}-to-${q.to}.csv"`);
    res.send(csv(rows));
  }),
);
