import { and, asc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { categories, products } from "../db/schema.js";
import { getSetting } from "../lib/settings.js";
import { h, HttpError, notFound } from "../lib/util.js";

/**
 * The public menu page (/menu): no login. Only what the admin switched on is sent,
 * and only the fields a visitor should see (never costs, codes or stock).
 */
export const publicRouter = Router();

const menuOff = () => new HttpError(404, "menu_off", "The menu is not published.");

publicRouter.get(
  "/menu",
  h((_req, res) => {
    const cfg = getSetting("publicMenu");
    if (!cfg.enabled) throw menuOff();
    const biz = getSetting("business");
    const cats = db.select().from(categories).where(and(isNull(categories.deletedAt), eq(categories.active, true))).orderBy(asc(categories.sort), asc(categories.nameEn)).all();
    const prods = db
      .select()
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.active, true), eq(products.showOnMenu, true)))
      .orderBy(asc(products.sort), asc(products.nameEn))
      .all();
    const shown = (p: (typeof prods)[number]) => ({
      id: p.id,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      descAr: p.menuDescAr,
      descEn: p.menuDescEn,
      allergens: p.allergens,
      photo: p.photo ? `/api/public/menu/photo/${p.id}?v=${encodeURIComponent(p.updatedAt)}` : "",
      ...(cfg.showPrices ? { price: p.price, currency: p.currency } : {}),
    });
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      business: { nameAr: biz.nameAr, nameEn: biz.nameEn, phone: biz.phone, address: biz.address, logo: biz.logo },
      page: {
        showPrices: cfg.showPrices,
        whatsapp: cfg.whatsapp,
        heroTitleAr: cfg.heroTitleAr,
        heroTitleEn: cfg.heroTitleEn,
        heroSubtitleAr: cfg.heroSubtitleAr,
        heroSubtitleEn: cfg.heroSubtitleEn,
        aboutAr: cfg.aboutAr,
        aboutEn: cfg.aboutEn,
        hoursAr: cfg.hoursAr,
        hoursEn: cfg.hoursEn,
        instagram: cfg.instagram,
        facebook: cfg.facebook,
        mapUrl: cfg.mapUrl,
      },
      categories: cats
        .map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn, products: prods.filter((p) => p.categoryId === c.id).map(shown) }))
        .filter((c) => c.products.length > 0),
    });
  }),
);

publicRouter.get(
  "/menu/photo/:id",
  h((req, res) => {
    if (!getSetting("publicMenu").enabled) throw menuOff();
    const p = db
      .select({ photo: products.photo })
      .from(products)
      .where(and(eq(products.id, String(req.params.id)), isNull(products.deletedAt), eq(products.active, true), eq(products.showOnMenu, true)))
      .get();
    const m = p?.photo.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/);
    if (!m) throw notFound("photo");
    res.setHeader("Content-Type", m[1]!);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(m[2]!, "base64"));
  }),
);
