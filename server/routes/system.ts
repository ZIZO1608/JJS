import os from "node:os";
import { and, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { loadDemoData } from "../db/demo.js";
import { cashBoxes, employees } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, requirePerm } from "../lib/auth.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { DATA_DIR, PORT } from "../env.js";
import { h, newId, parse } from "../lib/util.js";
import { pendingCount, syncNow } from "../services/sync.js";

export const systemRouter = Router();

/** Settings every screen needs: currency, loyalty rule, delivery fee, printing sizes. */
systemRouter.get(
  "/app-settings",
  requireAuth,
  h((_req, res) => res.json({ defaultCurrency: getSetting("currency.default"), loyalty: getSetting("loyalty"), orders: getSetting("orders"), printing: getSetting("printing"), business: getSetting("business") })),
);

const loyaltySchema = z.object({ enabled: z.boolean(), buyQty: z.number().int().min(1).max(10_000), freeQty: z.number().int().min(1).max(1000) });
const ordersSchema = z.object({ defaultDeliveryFee: z.number().min(0), allowStacking: z.boolean() });
const printingSchema = z.object({
  receiptWidthMm: z.union([z.literal(58), z.literal(80)]),
  labelWidthMm: z.number().min(20).max(120),
  labelHeightMm: z.number().min(15).max(120),
  receiptFooterAr: z.string().max(120),
  receiptFooterEn: z.string().max(120),
});

for (const [key, schema] of [
  ["loyalty", loyaltySchema],
  ["orders", ordersSchema],
  ["printing", printingSchema],
] as const) {
  systemRouter.put(
    `/settings/${key}`,
    requirePerm("settings", "edit"),
    h((req, res) => {
      const body = parse(schema, req.body);
      const before = getSetting(key);
      setSetting(key, body as never);
      writeAudit(db, { userId: req.user!.id, action: "edit", entity: `settings.${key}`, before, after: body });
      res.json(body);
    }),
  );
}

/** Network: let the admin's phone on the same Wi-Fi open the system. */
systemRouter.get(
  "/network",
  requirePerm("settings", "view"),
  h((_req, res) => {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === "IPv4" && !a.internal)
      .map((a) => `http://${a.address}:${PORT}`);
    res.json({ ...getSetting("network"), addresses, port: PORT, dataDir: DATA_DIR, listeningOnLan: process.env.JJS_LAN_ACTIVE === "1" });
  }),
);
systemRouter.put(
  "/network",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const body = parse(z.object({ lanAccess: z.boolean() }), req.body);
    setSetting("network", body);
    writeAudit(db, { userId: req.user!.id, action: "edit", entity: "settings.network", after: body });
    res.json({ ...body, restartNeeded: true });
  }),
);

/** Cloud sync (Supabase). The key is write-only: it is never sent back to the screen. */
systemRouter.get(
  "/sync",
  requirePerm("settings", "view"),
  h((_req, res) => {
    const cfg = getSetting("sync");
    res.json({ enabled: cfg.enabled, supabaseUrl: cfg.supabaseUrl, hasKey: !!cfg.serviceKey, status: getSetting("sync.status"), pending: pendingCount() });
  }),
);
systemRouter.put(
  "/sync",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const body = parse(z.object({ enabled: z.boolean(), supabaseUrl: z.string().trim().url().or(z.literal("")), serviceKey: z.string().max(500).optional() }), req.body);
    const before = getSetting("sync");
    setSetting("sync", { enabled: body.enabled, supabaseUrl: body.supabaseUrl, serviceKey: body.serviceKey ?? before.serviceKey });
    writeAudit(db, { userId: req.user!.id, action: "edit", entity: "settings.sync", after: { enabled: body.enabled, supabaseUrl: body.supabaseUrl } });
    res.json({ ok: true });
  }),
);
systemRouter.post(
  "/sync/run",
  requirePerm("settings", "edit"),
  h(async (_req, res) => res.json(await syncNow())),
);

/** Load the sample menu, stock and clients (only on an empty system). */
systemRouter.post(
  "/demo-data",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const out = db.transaction((tx) => {
      const r = loadDemoData(tx, req.user!.id);
      if (r.loaded) {
        // the sample delivery person gets a cash box
        const rep = tx.select().from(employees).where(eq(employees.isDeliveryRep, true)).get();
        if (rep && !tx.select().from(cashBoxes).where(and(eq(cashBoxes.employeeId, rep.id), isNull(cashBoxes.deletedAt))).get())
          tx.insert(cashBoxes).values({ id: newId(), nameAr: `نقد مع ${rep.name}`, nameEn: `Cash with ${rep.name}`, kind: "rep", currency: getSetting("currency.default"), employeeId: rep.id }).run();
        writeAudit(tx, { userId: req.user!.id, action: "create", entity: "system.demo_data" });
      }
      return r;
    });
    res.json(out);
  }),
);
