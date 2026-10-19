import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, requirePerm } from "../lib/auth.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { h, parse } from "../lib/util.js";

export const settingsRouter = Router();

/** What every logged-in screen needs (header, receipts): business name, logo, default currency. */
settingsRouter.get(
  "/public",
  requireAuth,
  h((_req, res) => {
    res.json({ business: getSetting("business"), defaultCurrency: getSetting("currency.default") });
  }),
);

const MAX_LOGO_BYTES = 400_000;
const businessSchema = z.object({
  nameAr: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(40).default(""),
  address: z.string().trim().max(200).default(""),
  logo: z
    .string()
    .max(Math.ceil(MAX_LOGO_BYTES * 1.37), "The logo is too big. Use an image under 400 KB.")
    .refine((s) => s === "" || /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(s), "The logo must be a PNG, JPG, WEBP or SVG image")
    .default(""),
});

settingsRouter.put(
  "/business",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const body = parse(businessSchema, req.body);
    const before = getSetting("business");
    db.transaction((tx) => {
      setSetting("business", body, tx);
      writeAudit(tx, {
        userId: req.user!.id,
        action: "edit",
        entity: "settings.business",
        before: { ...before, logo: before.logo ? "(image)" : "" },
        after: { ...body, logo: body.logo ? "(image)" : "" },
      });
    });
    res.json({ business: getSetting("business") });
  }),
);

settingsRouter.put(
  "/currency",
  requirePerm("settings", "edit"),
  h((req, res) => {
    const { defaultCurrency } = parse(z.object({ defaultCurrency: z.enum(["USD", "SYP"]) }), req.body);
    const before = getSetting("currency.default");
    db.transaction((tx) => {
      setSetting("currency.default", defaultCurrency, tx);
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "settings.currency", before, after: defaultCurrency });
    });
    res.json({ defaultCurrency });
  }),
);
