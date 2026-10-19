import { desc } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { fxRates } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, requirePerm } from "../lib/auth.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { h, parse } from "../lib/util.js";
import { getCurrentRate, refreshRate, setManualRate } from "../services/fx.js";

export const fxRouter = Router();

fxRouter.get("/current", requireAuth, h((_req, res) => res.json(getCurrentRate())));

fxRouter.post(
  "/refresh",
  requirePerm("settings", "edit"),
  h(async (_req, res) => res.json(await refreshRate())),
);

fxRouter.put(
  "/manual",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const { rate } = parse(z.object({ rate: z.number().positive().max(10_000_000).nullable() }), req.body);
    const before = getSetting("fx.manualRate");
    setManualRate(rate);
    writeAudit(db, { userId: req.user!.id, action: "edit", entity: "settings.fx.manual", before, after: rate });
    res.json(getCurrentRate());
  }),
);

fxRouter.get(
  "/config",
  requirePerm("settings", "view"),
  h((_req, res) => {
    const cfg = getSetting("fx.config");
    res.json({ apiUrl: cfg.apiUrl, jsonPath: cfg.jsonPath, hasApiKey: !!cfg.apiKey });
  }),
);

fxRouter.put(
  "/config",
  requirePerm("settings", "edit"),
  h(async (req, res) => {
    const body = parse(
      z.object({
        apiUrl: z.string().trim().url().or(z.literal("")),
        jsonPath: z.string().trim().max(80).default("rate"),
        /** Omit to keep the stored key; send "" to clear it. */
        apiKey: z.string().max(300).optional(),
      }),
      req.body,
    );
    const before = getSetting("fx.config");
    const next = { apiUrl: body.apiUrl, jsonPath: body.jsonPath || "rate", apiKey: body.apiKey ?? before.apiKey };
    setSetting("fx.config", next);
    writeAudit(db, { userId: req.user!.id, action: "edit", entity: "settings.fx.config", before, after: next });
    res.json(await refreshRate());
  }),
);

fxRouter.get(
  "/history",
  requirePerm("settings", "view"),
  h((_req, res) => res.json({ rates: db.select().from(fxRates).orderBy(desc(fxRates.fetchedAt)).limit(50).all() })),
);
