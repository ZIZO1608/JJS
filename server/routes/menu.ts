import { and, asc, count, eq, inArray, isNull, or } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db, type Tx } from "../db/client.js";
import { categories, items, optionGroupLinks, optionGroups, options, products, recipes } from "../db/schema.js";
import { writeAudit } from "../lib/audit.js";
import { can, requireAuth, requirePerm } from "../lib/auth.js";
import { crudRouter } from "../lib/crud.js";
import { h, HttpError, newId, notFound, nowIso, parse } from "../lib/util.js";
import { ensureProductItem, recipeCostUsd } from "../services/stock.js";
import { currentRate, rateFor, round4, toUsd } from "../lib/biz.js";

export const menuRouter = Router();

const names = { nameAr: z.string().trim().min(1).max(80), nameEn: z.string().trim().min(1).max(80) };
const currency = z.enum(["USD", "SYP"]);

/* ---------- categories ---------- */
menuRouter.use(
  "/categories",
  crudRouter({
    table: categories,
    module: "menu",
    entity: "category",
    schema: z.object({ ...names, sort: z.number().int().min(0).default(0), active: z.boolean().default(true) }),
    beforeDelete: (tx, row) => {
      const n = tx.select({ n: count() }).from(products).where(and(eq(products.categoryId, row.id), isNull(products.deletedAt))).get()?.n ?? 0;
      if (n) throw new HttpError(409, "in_use", `This category still has ${n} product(s). Move or delete them first.`);
    },
  }),
);

/* ---------- option groups & options ---------- */
menuRouter.use(
  "/option-groups",
  crudRouter({
    table: optionGroups,
    module: "menu",
    entity: "option_group",
    schema: z
      .object({ ...names, minSelect: z.number().int().min(0).max(20).default(0), maxSelect: z.number().int().min(1).max(20).default(5), sort: z.number().int().min(0).default(0) })
      .refine((g) => g.minSelect <= g.maxSelect, { message: "Minimum cannot be above maximum", path: ["minSelect"] }),
    beforeDelete: (tx, row) => {
      tx.update(options).set({ deletedAt: nowIso(), syncedAt: null }).where(eq(options.groupId, row.id)).run();
      tx.update(optionGroupLinks).set({ deletedAt: nowIso(), syncedAt: null }).where(eq(optionGroupLinks.groupId, row.id)).run();
    },
  }),
);

menuRouter.use(
  "/options",
  crudRouter({
    table: options,
    module: "menu",
    entity: "option",
    schema: z.object({ groupId: z.string().min(1), ...names, priceDelta: z.number().min(-1000).max(10_000_000).default(0), currency: currency.default("USD"), sort: z.number().int().min(0).default(0), active: z.boolean().default(true) }),
    where: (req) => (req.query.groupId ? eq(options.groupId, String(req.query.groupId)) : undefined),
    beforeSave: (tx, body) => {
      if (!tx.select().from(optionGroups).where(and(eq(optionGroups.id, body.groupId), isNull(optionGroups.deletedAt))).get())
        throw new HttpError(400, "group_not_found", "Choose an option group that exists.");
    },
  }),
);

const recipeLines = z.array(z.object({ itemId: z.string().min(1), qty: z.number().positive().max(100_000), wastePct: z.number().min(0).max(200).default(0) })).max(60);

function saveRecipe(tx: Tx, key: { productId?: string; optionId?: string }, lines: z.infer<typeof recipeLines>) {
  const where = key.productId ? eq(recipes.productId, key.productId) : eq(recipes.optionId, key.optionId!);
  tx.update(recipes).set({ deletedAt: nowIso(), updatedAt: nowIso(), syncedAt: null }).where(and(where, isNull(recipes.deletedAt))).run();
  for (const l of lines) {
    const it = tx.select().from(items).where(and(eq(items.id, l.itemId), isNull(items.deletedAt))).get();
    if (!it) throw new HttpError(400, "item_not_found", "A recipe line uses an item that does not exist.");
    if (it.kind === "product") throw new HttpError(400, "bad_recipe", "A recipe can only use ingredients and packaging.");
    tx.insert(recipes).values({ id: newId(), productId: key.productId ?? null, optionId: key.optionId ?? null, itemId: l.itemId, qty: l.qty, wastePct: l.wastePct }).run();
  }
}

const recipeRows = (key: { productId?: string; optionId?: string }) =>
  db
    .select({ itemId: recipes.itemId, qty: recipes.qty, wastePct: recipes.wastePct, nameAr: items.nameAr, nameEn: items.nameEn, kind: items.kind, unitCode: items.unitCode, avgCostUsd: items.avgCostUsd })
    .from(recipes)
    .innerJoin(items, eq(recipes.itemId, items.id))
    .where(and(key.productId ? eq(recipes.productId, key.productId) : eq(recipes.optionId, key.optionId!), isNull(recipes.deletedAt)))
    .all();

menuRouter.get(
  "/options/:id/recipe",
  requirePerm("menu", "view"),
  h((req, res) => res.json({ recipe: recipeRows({ optionId: String(req.params.id) }) })),
);
menuRouter.put(
  "/options/:id/recipe",
  requirePerm("menu", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const lines = parse(recipeLines, req.body.recipe ?? []);
    db.transaction((tx) => {
      saveRecipe(tx, { optionId: id }, lines);
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "option.recipe", entityId: id, after: lines });
    });
    res.json({ recipe: recipeRows({ optionId: id }) });
  }),
);

/** Which option groups a category offers (products in it inherit them). */
menuRouter.put(
  "/categories/:id/groups",
  requirePerm("menu", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const groupIds = parse(z.array(z.string()).max(30), req.body.groupIds ?? []);
    db.transaction((tx) => {
      tx.update(optionGroupLinks).set({ deletedAt: nowIso(), syncedAt: null }).where(and(eq(optionGroupLinks.categoryId, id), isNull(optionGroupLinks.deletedAt))).run();
      for (const g of groupIds) tx.insert(optionGroupLinks).values({ id: newId(), groupId: g, categoryId: id }).run();
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "category.groups", entityId: id, after: groupIds });
    });
    res.json({ ok: true });
  }),
);

/* ---------- products ---------- */
const productSchema = z.object({
  categoryId: z.string().min(1),
  code: z.string().trim().max(20).regex(/^[A-Za-z0-9-]*$/, "Use letters, numbers and dashes").default(""),
  ...names,
  price: z.number().min(0).max(100_000_000),
  currency: currency,
  shelfLifeHours: z.number().int().min(1).max(24 * 365),
  allergens: z.string().max(200).default(""),
  photo: z.string().max(300_000).default(""),
  sort: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  optionGroupIds: z.array(z.string()).max(30).default([]),
  recipe: recipeLines.default([]),
  weightG: z.number().min(0).max(100_000).default(0),
  /** Other direct cost per piece, entered in the product's currency. */
  extraCost: z.number().min(0).default(0),
});

const linkedGroupIds = (productId: string, categoryId: string) =>
  db
    .select({ groupId: optionGroupLinks.groupId, productId: optionGroupLinks.productId })
    .from(optionGroupLinks)
    .where(and(isNull(optionGroupLinks.deletedAt), or(eq(optionGroupLinks.productId, productId), eq(optionGroupLinks.categoryId, categoryId))))
    .all();

function productOut(p: typeof products.$inferSelect) {
  const links = linkedGroupIds(p.id, p.categoryId);
  const item = db.select().from(items).where(eq(items.productId, p.id)).get();
  return {
    ...p,
    itemId: item?.id ?? null,
    minLevel: item?.minLevel ?? 0,
    ownGroupIds: links.filter((l) => l.productId).map((l) => l.groupId),
    groupIds: [...new Set(links.map((l) => l.groupId))],
    recipe: recipeRows({ productId: p.id }),
    costUsd: recipeCostUsd(db, { productId: p.id }),
    extraCost: p.currency === "USD" ? p.extraCostUsd : Math.round(p.extraCostUsd * (currentRate() ?? 0)),
  };
}

menuRouter.get(
  "/products",
  requirePerm("menu", "view"),
  h((_req, res) => {
    const rows = db.select().from(products).where(isNull(products.deletedAt)).orderBy(asc(products.sort), asc(products.nameEn)).all();
    res.json({ rows: rows.map(productOut) });
  }),
);

function saveProduct(tx: Tx, id: string, body: z.infer<typeof productSchema>, isNew: boolean) {
  if (!tx.select().from(categories).where(and(eq(categories.id, body.categoryId), isNull(categories.deletedAt))).get()) throw new HttpError(400, "category_not_found", "Choose a category.");
  let code = body.code.toUpperCase();
  if (!code) {
    const n = (tx.select({ n: count() }).from(products).get()?.n ?? 0) + 1;
    code = `P${String(n).padStart(3, "0")}`;
    while (tx.select().from(products).where(eq(products.code, code)).get()) code = `P${String(Math.floor(Math.random() * 9000) + 1000)}`;
  }
  const row = {
    categoryId: body.categoryId,
    code,
    nameAr: body.nameAr,
    nameEn: body.nameEn,
    price: body.price,
    currency: body.currency,
    shelfLifeHours: body.shelfLifeHours,
    allergens: body.allergens,
    photo: body.photo,
    sort: body.sort,
    active: body.active,
    weightG: body.weightG,
    extraCostUsd: round4(toUsd(body.extraCost, body.currency, body.extraCost ? rateFor(body.currency) : null)),
  };
  if (isNew) tx.insert(products).values({ id, ...row }).run();
  else tx.update(products).set({ ...row, updatedAt: nowIso(), syncedAt: null }).where(eq(products.id, id)).run();
  ensureProductItem(tx, id);
  tx.update(optionGroupLinks).set({ deletedAt: nowIso(), syncedAt: null }).where(and(eq(optionGroupLinks.productId, id), isNull(optionGroupLinks.deletedAt))).run();
  for (const g of body.optionGroupIds) tx.insert(optionGroupLinks).values({ id: newId(), groupId: g, productId: id }).run();
  saveRecipe(tx, { productId: id }, body.recipe);
}

menuRouter.post(
  "/products",
  requirePerm("menu", "create"),
  h((req, res) => {
    const body = parse(productSchema, req.body);
    const id = newId();
    db.transaction((tx) => {
      saveProduct(tx, id, body, true);
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "product", entityId: id, after: { ...body, photo: body.photo ? "(image)" : "" } });
    });
    res.status(201).json({ row: productOut(db.select().from(products).where(eq(products.id, id)).get()!) });
  }),
);

menuRouter.put(
  "/products/:id",
  requirePerm("menu", "edit"),
  h((req, res) => {
    const id = String(req.params.id);
    const before = db.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).get();
    if (!before) throw notFound("product");
    const body = parse(productSchema, req.body);
    db.transaction((tx) => {
      saveProduct(tx, id, body, false);
      writeAudit(tx, { userId: req.user!.id, action: "edit", entity: "product", entityId: id, before: { ...before, photo: "" }, after: { ...body, photo: body.photo ? "(image)" : "" } });
    });
    res.json({ row: productOut(db.select().from(products).where(eq(products.id, id)).get()!) });
  }),
);

menuRouter.delete(
  "/products/:id",
  requirePerm("menu", "delete"),
  h((req, res) => {
    const id = String(req.params.id);
    const before = db.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).get();
    if (!before) throw notFound("product");
    db.transaction((tx) => {
      tx.update(products).set({ deletedAt: nowIso(), active: false, updatedAt: nowIso(), syncedAt: null }).where(eq(products.id, id)).run();
      tx.update(items).set({ active: false, updatedAt: nowIso(), syncedAt: null }).where(eq(items.productId, id)).run();
      writeAudit(tx, { userId: req.user!.id, action: "delete", entity: "product", entityId: id, before: { ...before, photo: "" } });
    });
    res.json({ ok: true });
  }),
);

/** Everything the order screen needs, in one call. */
menuRouter.get(
  "/catalog",
  requireAuth,
  h((req, res) => {
    if (!can(req.user, "orders", "view") && !can(req.user, "menu", "view")) throw new HttpError(403, "forbidden", "Your role cannot see the menu.");
    const cats = db.select().from(categories).where(and(isNull(categories.deletedAt), eq(categories.active, true))).orderBy(asc(categories.sort), asc(categories.nameEn)).all();
    const prods = db.select().from(products).where(and(isNull(products.deletedAt), eq(products.active, true))).orderBy(asc(products.sort), asc(products.nameEn)).all();
    const links = db.select().from(optionGroupLinks).where(isNull(optionGroupLinks.deletedAt)).all();
    const groupIds = [...new Set(links.map((l) => l.groupId))];
    const groups = groupIds.length ? db.select().from(optionGroups).where(and(inArray(optionGroups.id, groupIds), isNull(optionGroups.deletedAt))).orderBy(asc(optionGroups.sort)).all() : [];
    const opts = groupIds.length ? db.select().from(options).where(and(inArray(options.groupId, groupIds), isNull(options.deletedAt), eq(options.active, true))).orderBy(asc(options.sort)).all() : [];
    res.json({
      categories: cats,
      products: prods.map((p) => ({
        ...p,
        photo: p.photo ? `/api/menu/products/${p.id}/photo` : "",
        groupIds: [...new Set(links.filter((l) => l.productId === p.id || l.categoryId === p.categoryId).map((l) => l.groupId))].filter((g) => groups.some((x) => x.id === g)),
      })),
      groups: groups.map((g) => ({ ...g, options: opts.filter((o) => o.groupId === g.id) })),
    });
  }),
);

menuRouter.get(
  "/products/:id/photo",
  requireAuth,
  h((req, res) => {
    const p = db.select({ photo: products.photo }).from(products).where(eq(products.id, String(req.params.id))).get();
    const m = p?.photo.match(/^data:(image\/[a-z+]+);base64,(.*)$/);
    if (!m) throw notFound("photo");
    res.setHeader("Content-Type", m[1]!);
    res.setHeader("Cache-Control", "max-age=300");
    res.send(Buffer.from(m[2]!, "base64"));
  }),
);
