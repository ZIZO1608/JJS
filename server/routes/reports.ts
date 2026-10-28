import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { clients, expenses, lookups, orders, paymentMethods } from "../db/schema.js";
import { requirePerm } from "../lib/auth.js";
import { localDate } from "../lib/biz.js";
import { h, HttpError, parse } from "../lib/util.js";
import { allMyMoney, cashFlow, clientsSheet, dashboard, deliveryCost, fiveAnswers, monthsCompare, myDay, periodReport, productionVsSales, unpaidBalances } from "../services/reports.js";
import { boxMoves, cashBoxes, purchases, returns, suppliers } from "../db/schema.js";
import { desc } from "drizzle-orm";
import { supplierDue } from "../services/wholesale.js";

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
      const { costUsd: _c, grossProfitUsd: _g, marginPct: _m, netUsd: _n, operatingProfitUsd: _o, internalUse: _i, withdrawalsUsd: _w, ...rest } = report;
      return res.json({
        ...rest,
        byProduct: report.byProduct.map(({ costUsd: _x, marginPct: _y, ...p }) => p),
        byCategory: report.byCategory.map(({ costUsd: _x, marginPct: _y, ...p }) => p),
        byClient: report.byClient.map(({ costUsd: _x, marginPct: _y, profitUsd: _z, ...p }) => p),
        hiddenCosts: true,
        unpaid: unpaidBalances(db),
      });
    }
    res.json({ ...report, unpaid: unpaidBalances(db) });
  }),
);

const rangeOf = (req: { query: Record<string, unknown> }) => {
  const q = parse(range, { from: req.query.from ?? localDate(), to: req.query.to ?? localDate() });
  if (q.from > q.to) throw new HttpError(400, "bad_range", "The start date is after the end date.");
  return q;
};

/** "My day": five boxes — profit, net, made, used from the warehouse, cash boxes. Money figures need see_cost. */
reportsRouter.get(
  "/day",
  requirePerm("dashboard", "view"),
  h((req, res) => {
    const date = parse(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), req.query.date ?? localDate());
    const day = myDay(db, date);
    if (req.user!.permissions.has("costing:see_cost")) return res.json(day);
    res.json({ ...day, profit: null, net: null, used: { ...day.used, usd: null, rows: day.used.rows.map(({ usd: _u, ...x }) => x) }, hiddenCosts: true });
  }),
);

/** Clients sheet for printing: who took what between two moments, and what they paid. */
reportsRouter.get(
  "/clients-sheet",
  requirePerm("reports", "view"),
  h((req, res) => {
    const iso = z.string().datetime();
    const q = parse(z.object({ from: iso, to: iso }), req.query);
    if (q.from > q.to) throw new HttpError(400, "bad_range", "The start is after the end.");
    res.json(clientsSheet(db, q.from, q.to));
  }),
);

/** The cloud: all the money that is the owner's. Admin only. */
reportsRouter.get(
  "/my-money",
  h((req, res) => {
    if (!req.user) throw new HttpError(401, "not_logged_in", "Please log in.");
    if (req.user.role.systemKey !== "admin") throw new HttpError(403, "forbidden", "Only the admin can see this.");
    res.json(allMyMoney(db));
  }),
);

/** "Your day in five answers" — also sent to the phone dashboard. */
reportsRouter.get(
  "/five",
  requirePerm("dashboard", "view"),
  h((req, res) => res.json(fiveAnswers(db, String(req.query.date ?? localDate())))),
);

/** Made vs sold vs returned vs wasted vs left, per product. */
reportsRouter.get(
  "/production",
  requirePerm("reports", "view"),
  h((req, res) => {
    const q = rangeOf(req);
    res.json({ ...q, rows: productionVsSales(db, q.from, q.to) });
  }),
);

reportsRouter.get(
  "/cashflow",
  requirePerm("costing", "see_cost"),
  h((req, res) => {
    const q = rangeOf(req);
    res.json(cashFlow(db, q.from, q.to));
  }),
);

reportsRouter.get(
  "/months",
  requirePerm("costing", "see_cost"),
  h((req, res) => res.json({ rows: monthsCompare(db, Math.min(24, Math.max(2, Number(req.query.n ?? 6)))) })),
);

reportsRouter.get(
  "/delivery-cost",
  requirePerm("costing", "see_cost"),
  h((req, res) => {
    const q = rangeOf(req);
    res.json({ ...q, ...deliveryCost(db, q.from, q.to) });
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
    } else if (kind === "returns") {
      const list = db.select({ r: returns, client: clients.name }).from(returns).leftJoin(clients, eq(returns.clientId, clients.id)).where(and(gte(returns.businessDate, q.from), lte(returns.businessDate, q.to), isNull(returns.deletedAt))).orderBy(asc(returns.number)).all();
      rows = [["Return", "Date", "Client", "Total", "Currency", "Total USD", "Settlement", "Note"]];
      for (const r of list) rows.push([`R${r.r.number}`, r.r.businessDate, r.client ?? "", r.r.total, r.r.currency, r.r.totalUsd, r.r.settlement, r.r.note]);
    } else if (kind === "purchases") {
      const list = db.select({ p: purchases, sup: suppliers.name }).from(purchases).leftJoin(suppliers, eq(purchases.supplierId, suppliers.id)).where(and(gte(purchases.date, q.from), lte(purchases.date, q.to), isNull(purchases.deletedAt))).orderBy(asc(purchases.number)).all();
      rows = [["Number", "Date", "Supplier", "Supplier invoice", "Discount", "Transport", "Total", "Currency", "Total USD", "Paid", "Remaining", "Due date"]];
      for (const r of list) rows.push([r.p.number, r.p.date, r.sup ?? "", r.p.supplierRef, r.p.discount, r.p.transport, r.p.total, r.p.currency, r.p.totalUsd, r.p.paid, Math.round((r.p.total - r.p.paid) * 100) / 100, r.p.dueDate]);
    } else if (kind === "supplier-debts") {
      rows = [["Supplier", "Owed USD", "Overdue USD", "Open invoices"]];
      for (const s of db.select().from(suppliers).where(isNull(suppliers.deletedAt)).all()) {
        const d = supplierDue(db, s.id);
        if (d.totalDueUsd > 0.009) rows.push([s.name, d.totalDueUsd, d.overdueUsd, d.open.length]);
      }
    } else if (kind === "client-debts") {
      rows = [["Client", "Owes USD"]];
      for (const c of unpaidBalances(db)) rows.push([c.name, -c.balanceUsd]);
    } else if (kind === "withdrawals") {
      const list = db.select({ m: boxMoves, box: cashBoxes.nameEn }).from(boxMoves).innerJoin(cashBoxes, eq(boxMoves.boxId, cashBoxes.id)).where(and(eq(boxMoves.type, "withdrawal"), isNull(boxMoves.deletedAt), gte(boxMoves.businessDate, q.from), lte(boxMoves.businessDate, q.to))).orderBy(desc(boxMoves.createdAt)).all();
      rows = [["Date", "Box", "Amount", "Currency", "USD", "Note"]];
      for (const r of list) rows.push([r.m.businessDate, r.box, -r.m.amount, r.m.currency, -r.m.amountUsd, r.m.note]);
    } else if (kind === "production") {
      rows = [["Product (EN)", "Product (AR)", "Opening", "Made", "Sold from fridge", "Made fresh for orders", "Left on consignment", "Returned", "Wasted", "Count adjustments", "Closing"]];
      for (const r of productionVsSales(db, q.from, q.to)) rows.push([r.nameEn, r.nameAr, r.opening, r.made, r.fromFridge, r.madeFresh, r.consigned, r.returnedIn, r.wasted, r.counted, r.closing]);
    } else throw new HttpError(404, "not_found", "Unknown export.");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="jjs-${kind}-${q.from}-to-${q.to}.csv"`);
    res.send(csv(rows));
  }),
);
