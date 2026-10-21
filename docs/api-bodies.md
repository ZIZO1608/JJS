## menu.ts
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

const recipeLines = z.array(z.object({ itemId: z.string().min(1), qty: z.number().positive().max(100_000) })).max(60);
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
});

## stock.ts

stockRouter.use(
  "/warehouses",
  crudRouter({
    table: warehouses,
    module: "warehouse",
    entity: "warehouse",
    schema: z.object({ ...names, kind: z.enum(["store", "fridge", "freezer"]), sort: z.number().int().min(0).default(0), active: z.boolean().default(true) }),
    beforeDelete: (tx, row) => {
      const n = tx.select({ n: count() }).from(locations).where(and(eq(locations.warehouseId, row.id), isNull(locations.deletedAt))).get()?.n ?? 0;
      if (n) throw new HttpError(409, "in_use", "Delete or move its locations first.");
    },
  }),
);

stockRouter.use(
  "/locations",
  crudRouter({
    table: locations,
    module: "warehouse",
    entity: "location",
    schema: z.object({ warehouseId: z.string().min(1), ...names, active: z.boolean().default(true) }),
    beforeDelete: (tx, row) => {
      const n = tx.select({ n: count() }).from(batches).where(and(eq(batches.locationId, row.id), sql`${batches.qtyLeft} > 0`, isNull(batches.deletedAt))).get()?.n ?? 0;
      if (n) throw new HttpError(409, "in_use", "This location still has stock in it. Move it first.");
    },
  }),
);

/* ---------- items ---------- */
const itemSchema = z.object({
  kind: z.enum(["ingredient", "packaging"]),
  ...names,
  unitCode: z.enum(["kg", "g", "l", "ml", "pc"]),
  minLevel: z.number().min(0).default(0),
  avgCostUsd: z.number().min(0).default(0),
  active: z.boolean().default(true),
});

const itemOut = (i: typeof items.$inferSelect) => {
  const qty = round4(itemQty(db, i.id));
  return { ...i, qty, valueUsd: round4(Math.max(0, qty) * i.avgCostUsd), low: i.minLevel > 0 && qty < i.minLevel };
};

stockRouter.get(
  "/batches",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const q = parse(
      z.object({ warehouseId: z.string().optional(), locationId: z.string().optional(), kind: z.enum(["ingredient", "packaging", "product"]).optional(), status: z.string().optional(), includeEmpty: z.enum(["0", "1"]).default("0") }),
      req.query,
    );
    const conds: (SQL | undefined)[] = [isNull(batches.deletedAt)];
    if (q.includeEmpty === "0") conds.push(sql`${batches.qtyLeft} > 0`);
    if (q.warehouseId) conds.push(eq(warehouses.id, q.warehouseId));
    if (q.locationId) conds.push(eq(batches.locationId, q.locationId));
    if (q.kind) conds.push(eq(items.kind, q.kind));
    let rows = batchSelect()
      .where(and(...conds))
      .orderBy(sql`${batches.expiresAt} IS NULL`, asc(batches.expiresAt))
      .all()
      .map(batchOut);
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    res.json({ rows });
  }),
);

stockRouter.get(
  "/scan/:code",
  requirePerm("warehouse", "view"),
  h((req, res) => {
    const code = String(req.params.code).trim().toUpperCase();
    const r = batchSelect().where(eq(sql`upper(${batches.batchCode})`, code)).get();
    if (r) return res.json({ kind: "batch", batch: batchOut(r) });
    const p = db.select().from(products).where(and(eq(sql`upper(${products.code})`, code), isNull(products.deletedAt))).get();
    if (p) return res.json({ kind: "product", product: p });
    throw new HttpError(404, "not_found", `Nothing found for code ${code}.`);
  }),
);

const ctxOf = (req: { user?: { id: string } }, refType?: string, note?: string) => ({ userId: req.user!.id, date: localDate(), refType, note });

/** Opening stock or anything received without a purchase invoice. */
stockRouter.post(
  "/receive",
  requirePerm("warehouse", "create"),
  h((req, res) => {
    const body = parse(
      z.object({ itemId: z.string(), locationId: z.string(), qty: z.number().positive(), unitCostUsd: z.number().min(0).optional(), expiresAt: z.string().nullable().optional(), note: z.string().max(200).optional() }),
      req.body,
    );
    const item = db.select().from(items).where(eq(items.id, body.itemId)).get();
    if (!item) throw notFound("item");
    const out = db.transaction((tx) => {
      assertDayOpen(tx, localDate());
      const r = addStock(tx, { itemId: body.itemId, locationId: body.locationId, qty: body.qty, unitCostUsd: body.unitCostUsd ?? item.avgCostUsd, type: "adjust", expiresAt: body.expiresAt ?? null }, ctxOf(req, "receive", body.note));
      writeAudit(tx, { userId: req.user!.id, action: "create", entity: "stock.receive", entityId: r.batchId, after: body });
      return r;
    });
    res.status(201).json(out);
  }),
);

## purchasing.ts

purchasingRouter.use(
  "/suppliers",
  crudRouter({
    table: suppliers,
    module: "purchasing",
    entity: "supplier",
    schema: z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().max(40).default(""), note: z.string().max(300).default(""), active: z.boolean().default(true) }),
  }),
);

const lineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().positive().max(1_000_000),
  unitPrice: z.number().min(0).max(100_000_000),
  locationId: z.string().min(1),
  expiresAt: z.string().nullable().optional(),
});
const purchaseSchema = z.object({
  supplierId: z.string().nullable().optional(),
  currency: z.enum(["USD", "SYP"]),
  lines: z.array(lineSchema).min(1).max(100),
  paid: z.number().min(0).default(0),
  boxId: z.string().nullable().optional(),
  note: z.string().max(300).default(""),
});

const outOf = (id: string) => {
  const p = db.select({ p: purchases, supplierName: suppliers.name }).from(purchases).leftJoin(suppliers, eq(purchases.supplierId, suppliers.id)).where(eq(purchases.id, id)).get();
  if (!p) return null;
  const lines = db
    .select({ line: purchaseLines, nameAr: items.nameAr, nameEn: items.nameEn, unitCode: items.unitCode, locAr: locations.nameAr, locEn: locations.nameEn })
    .from(purchaseLines)
    .innerJoin(items, eq(purchaseLines.itemId, items.id))
    .innerJoin(locations, eq(purchaseLines.locationId, locations.id))
    .where(eq(purchaseLines.purchaseId, id))
    .all();
  return { ...p.p, supplierName: p.supplierName, due: round4(p.p.total - p.p.paid), lines: lines.map((l) => ({ ...l.line, nameAr: l.nameAr, nameEn: l.nameEn, unitCode: l.unitCode, location: { nameAr: l.locAr, nameEn: l.locEn } })) };
};

## money.ts

const boxSchema = z.object({ ...names, kind: z.enum(["cash", "wallet", "rep", "bank"]), currency: z.enum(["USD", "SYP"]), employeeId: z.string().nullable().optional(), active: z.boolean().default(true) });
moneyRouter.use(
  "/boxes",
  crudRouter({
    table: cashBoxes,
    module: "settings",
    entity: "cash_box",
    schema: boxSchema,
    map: boxOut,
    beforeSave: (tx, body, before) => {
      if (before && before.currency !== body.currency) {
        const n = tx.select({ n: count() }).from(boxMoves).where(eq(boxMoves.boxId, before.id)).get()?.n ?? 0;
        if (n) throw new HttpError(409, "box_has_moves", "This box already has money movements, so its currency cannot change.");
      }
    },
    beforeDelete: (tx, row) => {
      if (row.systemKey) throw new HttpError(409, "system_box", "The main cash box and Sham Cash box cannot be deleted.");
      if (Math.abs(boxBalance(tx, row.id)) > 0.001) throw new HttpError(409, "box_not_empty", "Empty this box first (transfer its money).");
    },
  }),
);

moneyRouter.get(
  "/methods",
  requireAuth,
  h((_req, res) => res.json({ rows: db.select().from(paymentMethods).where(isNull(paymentMethods.deletedAt)).orderBy(asc(paymentMethods.sort)).all() })),
);
moneyRouter.use(
  "/methods",
  crudRouter({
    table: paymentMethods,
    module: "settings",
    entity: "payment_method",
    schema: z
      .object({ ...names, kind: z.enum(["box", "credit", "salary"]), boxId: z.string().nullable().optional(), sort: z.number().int().min(0).default(0), active: z.boolean().default(true) })
      .refine((m) => m.kind !== "box" || !!m.boxId, { message: "Choose the box this method pays into", path: ["boxId"] }),
    beforeDelete: (_tx, row) => {
      if (row.systemKey) throw new HttpError(409, "system_method", "Built-in payment methods can be hidden but not deleted.");
    },
  }),
);

## clients.ts
const names = { nameAr: z.string().trim().min(1).max(60), nameEn: z.string().trim().min(1).max(60) };

clientsRouter.use(
  "/tiers",
  crudRouter({
    table: clientTiers,
    module: "clients",
    entity: "client_tier",
    schema: z.object({ ...names, discountPct: z.number().min(0).max(100), sort: z.number().int().min(0).default(0) }),
    beforeDelete: (tx, row) => {
      const n = tx.select({ n: count() }).from(clients).where(and(eq(clients.tierId, row.id), isNull(clients.deletedAt))).get()?.n ?? 0;
      if (n) throw new HttpError(409, "in_use", `${n} client(s) are in this tier.`);
    },
  }),
);

clientsRouter.use(
  "/plans",
  crudRouter({
    table: subscriptionPlans,
    module: "clients",
    entity: "subscription_plan",
    schema: z.object({ ...names, monthlyFee: z.number().min(0), currency: z.enum(["USD", "SYP"]), discountPct: z.number().min(0).max(100).default(0), includedItems: z.number().int().min(0).default(0), active: z.boolean().default(true) }),
  }),
);

clientsRouter.use(
  "/calls",
  crudRouter({
    table: salesCalls,
    module: "clients",
    entity: "sales_call",
    schema: z.object({
      employeeId: z.string().nullable().optional(),
      clientId: z.string().nullable().optional(),
      prospectName: z.string().trim().max(80).default(""),
      phone: z.string().trim().max(40).default(""),
      date: z.string().min(10).max(10),
      result: z.enum(["no_answer", "interested", "not_interested", "trial_given", "converted", "follow_up"]),
      nextFollowUp: z.string().nullable().optional(),
      note: z.string().max(400).default(""),
    }),
    orderBy: [desc(salesCalls.date), desc(salesCalls.createdAt)],
    map: (r) => ({
      ...r,
      clientName: r.clientId ? (db.select({ n: clients.name }).from(clients).where(eq(clients.id, r.clientId)).get()?.n ?? null) : null,
      employeeName: r.employeeId ? (db.select({ n: employees.name }).from(employees).where(eq(employees.id, r.employeeId)).get()?.n ?? null) : null,
    }),
  }),
);

/* ---------- clients ---------- */
const clientSchema = z.object({
  type: z.enum(["business", "individual"]),
  name: z.string().trim().min(1).max(80),
  contactPerson: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(40).default(""),
  address: z.string().trim().max(200).default(""),
  tierId: z.string().nullable().optional(),
  tagId: z.string().nullable().optional(),
  receiptLanguage: z.enum(["ar", "en"]).default("ar"),
  creditLimitUsd: z.number().min(0).default(0),
  creditBlock: z.boolean().default(false),
  note: z.string().max(400).default(""),
  active: z.boolean().default(true),
});

const lastOrderDate = (clientId: string) => db.select({ d: max(orders.businessDate) }).from(orders).where(and(eq(orders.clientId, clientId), ne(orders.status, "cancelled"))).get()?.d ?? null;

function summary(c: typeof clients.$inferSelect) {
  const today = localDate();
  const loy = loyaltyStatus(db, c.id, today);
  const sub = subscriptionStatus(db, c.id, today);
  return {
    ...c,
    balanceUsd: clientBalanceUsd(db, c.id),
    loyalty: { count: loy.count, progress: loy.progress, buyQty: loy.buyQty, available: loy.available, enabled: loy.enabled },
    subscription: sub ? { planNameAr: sub.plan.nameAr, planNameEn: sub.plan.nameEn, endDate: sub.endDate, availableIncluded: sub.availableIncluded } : null,
    lastOrderDate: lastOrderDate(c.id),
  };
}

const recurringSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().min(1).max(1000), optionIds: z.array(z.string()).default([]) })).min(1).max(50),
  note: z.string().max(200).default(""),
  active: z.boolean().default(true),
});

## orders.ts
const inputSchema = z.object({
  clientId: z.string().nullable().optional(),
  type: z.enum(["normal", "trial", "staff"]).default("normal"),
  employeeId: z.string().nullable().optional(),
  fulfilment: z.enum(["pickup", "delivery"]).default("pickup"),
  deliveryFee: z.number().min(0).nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  methodId: z.string().nullable().optional(),
  manualDiscountPct: z.number().min(0).max(100).optional(),
  useLoyalty: z.boolean().optional(),
  note: z.string().max(300).optional(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().min(1).max(1000), optionIds: z.array(z.string()).max(20).default([]) })).max(80),
});

const listSelect = () =>
  db
    .select({ o: orders, clientName: clients.name, methodAr: paymentMethods.nameAr, methodEn: paymentMethods.nameEn, userName: users.name, employeeName: employees.name })
    .from(orders)
    .leftJoin(clients, eq(orders.clientId, clients.id))
    .leftJoin(paymentMethods, eq(orders.methodId, paymentMethods.id))
    .leftJoin(users, eq(orders.userId, users.id))
    .leftJoin(employees, eq(orders.assignedTo, employees.id));

const listOut = (r: Awaited<ReturnType<ReturnType<typeof listSelect>["all"]>>[number]) => ({
  ...r.o,
  clientName: r.clientName,
  method: r.methodAr ? { nameAr: r.methodAr, nameEn: r.methodEn } : null,
  userName: r.userName,
  assignedName: r.employeeName,
});

## expenses.ts
const expenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoryId: z.string().nullable().optional(),
  itemId: z.string().nullable().optional(),
  amount: z.number().positive().max(1_000_000_000),
  currency: z.enum(["USD", "SYP"]),
  boxId: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  note: z.string().max(300).default(""),
});

const listSelect = () =>
  db
    .select({ e: expenses, catAr: lookups.nameAr, catEn: lookups.nameEn, boxAr: cashBoxes.nameAr, boxEn: cashBoxes.nameEn, userName: users.name })
    .from(expenses)
    .leftJoin(lookups, eq(expenses.categoryId, lookups.id))
    .leftJoin(cashBoxes, eq(expenses.boxId, cashBoxes.id))
    .leftJoin(users, eq(expenses.userId, users.id));

const itemName = (id: string | null) => (id ? (db.select({ ar: lookups.nameAr, en: lookups.nameEn }).from(lookups).where(eq(lookups.id, id)).get() ?? null) : null);

  const monthlyUsd = round4((a.priceUsd - a.salvageUsd) / Math.max(1, a.lifeMonths));
  const used = Math.min(a.lifeMonths, monthsBetween(a.purchaseDate, localDate()));
  const accumulatedUsd = round4(monthlyUsd * used);
  return { ...a, monthlyUsd, monthsUsed: used, accumulatedUsd, bookValueUsd: round4(a.priceUsd - accumulatedUsd) };
}

assetsRouter.use(
  "/",
  crudRouter({
    table: assets,
    module: "assets",
    entity: "asset",
    schema: z.object({
      nameAr: z.string().trim().min(1).max(80),
      nameEn: z.string().trim().min(1).max(80),
      price: z.number().positive(),
      currency: z.enum(["USD", "SYP"]),
      purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lifeMonths: z.number().int().min(1).max(600),
      salvageUsd: z.number().min(0).default(0),
      note: z.string().max(300).default(""),
      active: z.boolean().default(true),
    }),
    map: assetOut,
    beforeSave: (_tx, body) => {
      const rate = rateFor(body.currency);
      const priceUsd = round4(toUsd(body.price, body.currency, rate));
      if (body.salvageUsd > priceUsd) throw new HttpError(400, "invalid_input", "The value at the end cannot be above the price.");
      return { fxRate: rate, priceUsd };
    },
  }),
);
## people.ts
export const peopleRouter = Router();

/** A delivery person gets their own cash box for the money they collect. */
function ensureRepBox(tx: Tx, e: typeof employees.$inferSelect) {
  const box = tx.select().from(cashBoxes).where(and(eq(cashBoxes.employeeId, e.id), eq(cashBoxes.kind, "rep"), isNull(cashBoxes.deletedAt))).get();
  if (e.isDeliveryRep && !box) {
    tx.insert(cashBoxes).values({ id: newId(), nameAr: `نقد مع ${e.name}`, nameEn: `Cash with ${e.name}`, kind: "rep", currency: getSetting("currency.default"), employeeId: e.id }).run();
  }
  if (box && box.active !== (e.isDeliveryRep && e.active)) tx.update(cashBoxes).set({ active: e.isDeliveryRep && e.active, updatedAt: nowIso(), syncedAt: null }).where(eq(cashBoxes.id, box.id)).run();
}

peopleRouter.use(
  "/employees",
  crudRouter({
    table: employees,
    module: "people",
    entity: "employee",
    schema: z.object({
      name: z.string().trim().min(1).max(80),
      phone: z.string().trim().max(40).default(""),
      jobTitle: z.string().trim().max(60).default(""),
      userId: z.string().nullable().optional(),
      payModel: z.enum(["fixed", "commission", "both"]),
      baseSalary: z.number().min(0).default(0),
      currency: z.enum(["USD", "SYP"]),
      commissionPerClientUsd: z.number().min(0).default(0),
      commissionPct: z.number().min(0).max(100).default(0),
      staffDiscountPct: z.number().min(0).max(100).default(30),
      isDeliveryRep: z.boolean().default(false),
      active: z.boolean().default(true),
    }),
    orderBy: [asc(employees.name)],
    afterSave: (tx, row) => ensureRepBox(tx, row),
    map: (e) => ({ ...e, userName: e.userId ? (db.select({ n: users.name }).from(users).where(eq(users.id, e.userId)).get()?.n ?? null) : null }),
  }),
);

/* ---------- advances (سلف) ---------- */

## Wholesale & distribution pack (new request bodies)

```ts
// POST /orders and /orders/quote — new fields
type: "normal" | "trial" | "staff" | "internal"   // internal = tasting / kitchen use, total 0, cost recorded
paidAmount?: number | null   // with a box method: paid now (order currency). Less than total → status "partial", rest on the client's account (client required)
// response receipt now has: payment: { paid, remaining }, account: { beforeUsd, afterUsd, nowUsd } | null, client.phone/address/contactPerson
// quote lines have priceFrom: "menu" | "list" | "client" | "agreed"
// POST /orders/:id/cancel  { reason?: string }   (consignment invoices → 409 consignment_order)

// POST /returns
{ clientId?, orderId?, repId?, settlement: "credit" | "refund" | "none", boxId? (refund), note?,
  lines: [{ productId, qty:int, action: "restock" | "waste", expiresAt? }] }
// with orderId: priced from that invoice (after its discount), max = sold − already returned (400 return_too_many)

// POST /consignments  { clientId, repId?, note?, lines: [{ productId, qty }] }   → stock leaves now, priced at the client's price
// POST /consignments/:id/settle { lines: [{ productId, returnedQty, action }], methodId?, paidAmount?, note? }
//   → returned goods back/waste, sold part becomes an invoice (default method: on credit)
// POST /consignments/:id/cancel   (open only; stock comes back)

// POST /production/preview { lines: [{ productId, qty }] } → { products, materials[{need,have,short}], itemsCount, costUsd, shortages }
// POST /production { lines, employeeId?, locationId?, note? } → { id, number, batches[{productId,batchId,batchCode,qty,costUsd}], costUsd, itemsCount }
// GET  /production?from&to, /production/:id, /trace/:batchIdOrCode, /route-sheet?date&repId

// clients: new fields areaId, paymentTermsDays, priceListId, consignment (bool), repId
//   POST /clients also accepts openingBalance (+ owes us / − prepaid) and openingCurrency
//   summary rows now have aging: { balanceUsd, oldestUnpaidDate, daysOutstanding, termsDays, overdueDays }
//   GET /clients/:id/snapshot (for the invoice screen), GET /clients/:id adds totals, area, priceList, rep, returns, consignments
// price lists: crud /clients/price-lists {nameAr,nameEn,active}; GET/PUT /clients/price-lists/:id/items { items: [{productId, price, currency}] }

// items: unitCode adds "pack" | "carton"; packUnit (label), packSize (base units per pack), supplierId
// products: weightG, extraCost (per piece, product currency); recipe lines: wastePct
// suppliers: openingBalance, openingCurrency, paymentTermsDays (+ out: dueUsd, overdueUsd, openInvoices)
//   GET /purchases/suppliers/:id/statement?from&to, POST /purchases/suppliers/:id/pay {amount,currency,boxId,note?}
//   GET /purchases/debts, GET /purchases/price-changes?from, GET /purchases/:id/photo
// purchases: supplierRef, discount, transport, dueDate, photo (data URL); lines inPacks:boolean

// expenses: status "paid"|"due", dueDate, paidBy, beneficiary, photo, employeeId (rep/route)
//   GET /expenses?status=due, POST /expenses/:id/pay {boxId?, paidBy?}, GET /expenses/:id/photo
//   crud /expenses/recurring {categoryId,itemId,amount,currency,dayOfMonth 1–28,beneficiary,note,active}; POST /expenses/recurring/run
// money: POST /money/withdraw {boxId, amount, person, note} (daily_close:edit = owner), GET /money/withdrawals?from&to
// stock: POST /stock/use {itemId, qty, reasonId?, note}  (material used outside production)
// costing: /costing/products adds cleanQty/wastePct per line, extraUsd, cost50Usd, cost100Usd, targetPriceUsd, targetPrice, costInCurrency, belowTarget
//   GET /costing/impact?days, GET /costing/forecast?date, /costing/overheads adds breakEvenItems, itemsLeftToBreakEven, reached
// reports: /reports/range adds returnsUsd, netSalesUsd, collectedUsd, purchasesUsd, internalUse, withdrawalsUsd, dueExpensesUsd, avgRate, operatingProfitUsd;
//   byClient adds returnsUsd, costUsd, profitUsd, marginPct, overdueDays; byCategory adds revenueUsd, costUsd, marginPct
//   GET /reports/five, /reports/production, /reports/cashflow, /reports/months?n, /reports/delivery-cost
//   CSV kinds: orders, products, clients, expenses, returns, purchases, supplier-debts, client-debts, withdrawals, production
// dashboard adds five (same as /reports/five), stockValueUsd; alerts add overdueClients, dueExpenses, suppliersOverdueUsd
// days/:date adds cashFlow {currency, opening, moves[{type,amount,n}], expected}, repSettlement[], production[]
// settings: PUT /system/settings/costing {targetMarginPct, priceAlertPct}; orders adds defaultPaymentTermsDays, defaultReturnAction; printing adds invoiceSize "thermal"|"a4"
// backups: POST /backups/restore {name} (applies on next start), POST /backups/restore/cancel, GET /backups/restore → {pending}
// lookups: new list types "area", "cancel_reason"
```
