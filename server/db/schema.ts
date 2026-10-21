import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Every syncable table carries the same bookkeeping columns (spec: Database structure).
// ids are UUID v7 strings so rows created offline never clash with the cloud copy later.
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const base = {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
  deletedAt: text("deleted_at"),
  syncedAt: text("synced_at"),
};

export const roles = sqliteTable(
  "roles",
  {
    ...base,
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    systemKey: text("system_key", { enum: ["admin", "manager", "member"] }),
  },
  (t) => [uniqueIndex("roles_system_key_uq").on(t.systemKey)],
);

export const permissions = sqliteTable(
  "permissions",
  {
    ...base,
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    action: text("action").notNull(),
  },
  (t) => [uniqueIndex("permissions_role_module_action_uq").on(t.roleId, t.module, t.action)],
);

export const users = sqliteTable(
  "users",
  {
    ...base,
    name: text("name").notNull(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    language: text("language", { enum: ["ar", "en"] }).notNull().default("ar"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [uniqueIndex("users_username_uq").on(t.username), index("users_role_idx").on(t.roleId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(now),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    action: text("action", { enum: ["create", "edit", "delete", "login", "logout", "setup", "backup", "restore"] }).notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull().default(now),
    syncedAt: text("synced_at"),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_entity_idx").on(t.entity, t.entityId)],
);

/** Key/value settings; value is JSON text. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
  syncedAt: text("synced_at"),
});

/** Every editable dropdown in the system (expense items, units, payment methods…). */
export const lookups = sqliteTable(
  "lookups",
  {
    ...base,
    listType: text("list_type").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    sort: integer("sort").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("lookups_type_idx").on(t.listType, t.sort)],
);

export const fxRates = sqliteTable(
  "fx_rates",
  {
    id: text("id").primaryKey(),
    fromCcy: text("from_ccy").notNull(),
    toCcy: text("to_ccy").notNull(),
    rate: real("rate").notNull(),
    source: text("source", { enum: ["api", "manual"] }).notNull(),
    fetchedAt: text("fetched_at").notNull().default(now),
    syncedAt: text("synced_at"),
  },
  (t) => [index("fx_pair_time_idx").on(t.fromCcy, t.toCcy, t.fetchedAt)],
);

export const taxes = sqliteTable("taxes", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  kind: text("kind", { enum: ["percent", "fixed"] }).notNull(),
  value: real("value").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/* ======================================================================
   Stages 2–10. Money rule: every money row keeps its own `currency`,
   the `fx_rate` (1 USD = x SYP) it used, and the USD value for reports.
   ====================================================================== */

/* ---------- Stage 2: Menu ---------- */
export const categories = sqliteTable("categories", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  sort: integer("sort").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const products = sqliteTable(
  "products",
  {
    ...base,
    categoryId: text("category_id").notNull().references(() => categories.id),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    price: real("price").notNull(),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull().default("USD"),
    shelfLifeHours: integer("shelf_life_hours").notNull().default(24),
    allergens: text("allergens").notNull().default(""),
    photo: text("photo").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /** Sandwich weight in grams (information only). */
    weightG: real("weight_g").notNull().default(0),
    /** Any other direct cost per piece (gas, labour share…), in USD. */
    extraCostUsd: real("extra_cost_usd").notNull().default(0),
  },
  (t) => [uniqueIndex("products_code_uq").on(t.code), index("products_category_idx").on(t.categoryId)],
);

export const optionGroups = sqliteTable("option_groups", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  minSelect: integer("min_select").notNull().default(0),
  maxSelect: integer("max_select").notNull().default(5),
  sort: integer("sort").notNull().default(0),
});

export const options = sqliteTable(
  "options",
  {
    ...base,
    groupId: text("group_id").notNull().references(() => optionGroups.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    priceDelta: real("price_delta").notNull().default(0),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull().default("USD"),
    sort: integer("sort").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("options_group_idx").on(t.groupId)],
);

/** An option group applies to a whole category or to one product. */
export const optionGroupLinks = sqliteTable(
  "option_group_links",
  {
    ...base,
    groupId: text("group_id").notNull().references(() => optionGroups.id),
    categoryId: text("category_id").references(() => categories.id),
    productId: text("product_id").references(() => products.id),
  },
  (t) => [index("ogl_group_idx").on(t.groupId)],
);

/* ---------- Stage 3: Warehouse ---------- */
export const warehouses = sqliteTable("warehouses", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  kind: text("kind", { enum: ["store", "fridge", "freezer"] }).notNull().default("store"),
  sort: integer("sort").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const locations = sqliteTable(
  "locations",
  {
    ...base,
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("locations_wh_idx").on(t.warehouseId)],
);

/** Anything that is counted in stock: ingredients, packaging, and finished products. */
export const items = sqliteTable(
  "items",
  {
    ...base,
    kind: text("kind", { enum: ["ingredient", "packaging", "product"] }).notNull(),
    productId: text("product_id").references(() => products.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    unitId: text("unit_id").references(() => lookups.id),
    unitCode: text("unit_code", { enum: ["kg", "g", "l", "ml", "pc", "pack", "carton"] }).notNull().default("pc"),
    /** Bought in packs/cartons: the pack's name and how many base units are inside one. */
    packUnit: text("pack_unit").notNull().default(""),
    packSize: real("pack_size").notNull().default(0),
    supplierId: text("supplier_id"),
    minLevel: real("min_level").notNull().default(0),
    /** Weighted average cost of ONE unit, in USD. */
    avgCostUsd: real("avg_cost_usd").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("items_kind_idx").on(t.kind), uniqueIndex("items_product_uq").on(t.productId)],
);

export const batches = sqliteTable(
  "batches",
  {
    ...base,
    itemId: text("item_id").notNull().references(() => items.id),
    locationId: text("location_id").notNull().references(() => locations.id),
    batchCode: text("batch_code").notNull(),
    producedAt: text("produced_at").notNull(),
    expiresAt: text("expires_at"),
    qtyIn: real("qty_in").notNull(),
    qtyLeft: real("qty_left").notNull(),
    unitCostUsd: real("unit_cost_usd").notNull().default(0),
    runId: text("run_id"),
  },
  (t) => [uniqueIndex("batches_code_uq").on(t.batchCode), index("batches_item_idx").on(t.itemId, t.qtyLeft), index("batches_exp_idx").on(t.expiresAt)],
);

export const stockMoves = sqliteTable(
  "stock_moves",
  {
    ...base,
    itemId: text("item_id").notNull().references(() => items.id),
    batchId: text("batch_id").references(() => batches.id),
    type: text("type", { enum: ["purchase", "production", "use", "sale", "transfer", "waste", "count", "adjust", "return", "consign"] }).notNull(),
    /** Signed: + into stock, − out of stock. Transfers write one row out and one in. */
    qty: real("qty").notNull(),
    locationId: text("location_id").references(() => locations.id),
    unitCostUsd: real("unit_cost_usd").notNull().default(0),
    refType: text("ref_type"),
    refId: text("ref_id"),
    reasonId: text("reason_id").references(() => lookups.id),
    note: text("note"),
    userId: text("user_id").references(() => users.id),
    businessDate: text("business_date").notNull(),
  },
  (t) => [index("moves_item_idx").on(t.itemId), index("moves_ref_idx").on(t.refType, t.refId), index("moves_date_idx").on(t.businessDate, t.type)],
);

/* ---------- Stage 4: Purchasing & costing ---------- */
export const suppliers = sqliteTable("suppliers", {
  ...base,
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  note: text("note").notNull().default(""),
  /** What we already owed this supplier when we started using the system. */
  openingBalance: real("opening_balance").notNull().default(0),
  openingCurrency: text("opening_currency", { enum: ["USD", "SYP"] }).notNull().default("SYP"),
  openingUsd: real("opening_usd").notNull().default(0),
  openingPaidUsd: real("opening_paid_usd").notNull().default(0),
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const purchases = sqliteTable(
  "purchases",
  {
    ...base,
    number: integer("number").notNull(),
    supplierId: text("supplier_id").references(() => suppliers.id),
    date: text("date").notNull(),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
    fxRate: real("fx_rate"),
    total: real("total").notNull(),
    totalUsd: real("total_usd").notNull(),
    paid: real("paid").notNull().default(0),
    paidFromBoxId: text("paid_from_box_id"),
    /** The supplier's own invoice number. */
    supplierRef: text("supplier_ref").notNull().default(""),
    discount: real("discount").notNull().default(0),
    transport: real("transport").notNull().default(0),
    dueDate: text("due_date"),
    photo: text("photo").notNull().default(""),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => users.id),
  },
  (t) => [uniqueIndex("purchases_number_uq").on(t.number), index("purchases_date_idx").on(t.date)],
);

export const purchaseLines = sqliteTable(
  "purchase_lines",
  {
    ...base,
    purchaseId: text("purchase_id").notNull().references(() => purchases.id),
    itemId: text("item_id").notNull().references(() => items.id),
    qty: real("qty").notNull(),
    unitPrice: real("unit_price").notNull(),
    locationId: text("location_id").notNull().references(() => locations.id),
    expiresAt: text("expires_at"),
    batchId: text("batch_id").references(() => batches.id),
  },
  (t) => [index("pl_purchase_idx").on(t.purchaseId)],
);

/** What one product (or one add-on option) uses. qty is in the item's unit. */
export const recipes = sqliteTable(
  "recipes",
  {
    ...base,
    productId: text("product_id").references(() => products.id),
    optionId: text("option_id").references(() => options.id),
    itemId: text("item_id").notNull().references(() => items.id),
    qty: real("qty").notNull(),
    /** Trim / loss: 10 means 10% more is used than the clean quantity. */
    wastePct: real("waste_pct").notNull().default(0),
  },
  (t) => [index("recipes_product_idx").on(t.productId), index("recipes_option_idx").on(t.optionId)],
);

/* ---------- Stage 5: Clients ---------- */
export const clientTiers = sqliteTable("client_tiers", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  discountPct: real("discount_pct").notNull().default(0),
  sort: integer("sort").notNull().default(0),
});

export const clients = sqliteTable(
  "clients",
  {
    ...base,
    type: text("type", { enum: ["business", "individual"] }).notNull(),
    name: text("name").notNull(),
    contactPerson: text("contact_person").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    tierId: text("tier_id").references(() => clientTiers.id),
    tagId: text("tag_id").references(() => lookups.id),
    receiptLanguage: text("receipt_language", { enum: ["ar", "en"] }).notNull().default("ar"),
    /** Max debt allowed, in USD. 0 = no credit. */
    creditLimitUsd: real("credit_limit_usd").notNull().default(0),
    creditBlock: integer("credit_block", { mode: "boolean" }).notNull().default(false),
    note: text("note").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /** Set when a client who received a free trial places their first paid order. */
    convertedAt: text("converted_at"),
    areaId: text("area_id"),
    /** Days the client has to pay an invoice; 0 = cash only / no terms. */
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),
    priceListId: text("price_list_id"),
    /** Goods left on consignment: the shop pays only for what it sold. */
    consignment: integer("consignment", { mode: "boolean" }).notNull().default(false),
    repId: text("rep_id"),
  },
  (t) => [index("clients_name_idx").on(t.name)],
);

/** The client box ledger. amountUsd: + money in the box for the client (payment, top-up), − charges. */
export const clientMoves = sqliteTable(
  "client_moves",
  {
    ...base,
    clientId: text("client_id").notNull().references(() => clients.id),
    type: text("type", { enum: ["charge", "payment", "topup", "refund", "adjust", "subscription", "return", "opening"] }).notNull(),
    amount: real("amount").notNull(),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
    fxRate: real("fx_rate"),
    amountUsd: real("amount_usd").notNull(),
    orderId: text("order_id"),
    paymentId: text("payment_id"),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => users.id),
    businessDate: text("business_date").notNull(),
  },
  (t) => [index("client_moves_client_idx").on(t.clientId, t.createdAt)],
);

export const clientPrices = sqliteTable(
  "client_prices",
  {
    ...base,
    clientId: text("client_id").notNull().references(() => clients.id),
    productId: text("product_id").notNull().references(() => products.id),
    price: real("price").notNull(),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
  },
  (t) => [index("client_prices_idx").on(t.clientId, t.productId)],
);

export const subscriptionPlans = sqliteTable("subscription_plans", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  monthlyFee: real("monthly_fee").notNull(),
  currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
  discountPct: real("discount_pct").notNull().default(0),
  includedItems: integer("included_items").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    ...base,
    clientId: text("client_id").notNull().references(() => clients.id),
    planId: text("plan_id").notNull().references(() => subscriptionPlans.id),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    status: text("status", { enum: ["active", "ended", "cancelled"] }).notNull().default("active"),
    autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("subs_client_idx").on(t.clientId, t.status)],
);

/* ---------- Stage 6: Orders & money ---------- */
export const cashBoxes = sqliteTable("cash_boxes", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  kind: text("kind", { enum: ["cash", "wallet", "rep", "bank"] }).notNull(),
  currency: text("currency", { enum: ["USD", "SYP"] }).notNull().default("USD"),
  employeeId: text("employee_id"),
  systemKey: text("system_key"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const paymentMethods = sqliteTable("payment_methods", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  /** box: money goes into boxId · credit: charged to the client box · salary: deducted at payroll */
  kind: text("kind", { enum: ["box", "credit", "salary"] }).notNull(),
  boxId: text("box_id").references(() => cashBoxes.id),
  systemKey: text("system_key"),
  sort: integer("sort").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Every movement of money in a box. amountUsd signed: + in, − out. */
export const boxMoves = sqliteTable(
  "box_moves",
  {
    ...base,
    boxId: text("box_id").notNull().references(() => cashBoxes.id),
    type: text("type", { enum: ["sale", "client_payment", "topup", "expense", "purchase", "transfer", "handover", "count_adjust", "salary", "advance", "opening", "withdrawal", "refund"] }).notNull(),
    amount: real("amount").notNull(),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
    fxRate: real("fx_rate"),
    amountUsd: real("amount_usd").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => users.id),
    businessDate: text("business_date").notNull(),
  },
  (t) => [index("box_moves_box_idx").on(t.boxId), index("box_moves_date_idx").on(t.businessDate)],
);

export const businessDays = sqliteTable("business_days", {
  ...base,
  date: text("date").notNull().unique(),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  closedAt: text("closed_at"),
  closedBy: text("closed_by").references(() => users.id),
  expectedCashUsd: real("expected_cash_usd"),
  countedCashUsd: real("counted_cash_usd"),
  differenceUsd: real("difference_usd"),
  totalsJson: text("totals_json"),
  reopenedAt: text("reopened_at"),
  reopenedBy: text("reopened_by").references(() => users.id),
});

export const orders = sqliteTable(
  "orders",
  {
    ...base,
    number: integer("number").notNull(),
    businessDate: text("business_date").notNull(),
    clientId: text("client_id").references(() => clients.id),
    type: text("type", { enum: ["normal", "trial", "staff", "internal"] }).notNull().default("normal"),
    employeeId: text("employee_id"),
    fulfilment: text("fulfilment", { enum: ["pickup", "delivery"] }).notNull().default("pickup"),
    assignedTo: text("assigned_to"),
    status: text("status", { enum: ["confirmed", "delivered", "cancelled"] }).notNull().default("confirmed"),
    paymentStatus: text("payment_status", { enum: ["paid", "partial", "credit", "free", "salary"] }).notNull(),
    methodId: text("method_id").references(() => paymentMethods.id),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
    fxRate: real("fx_rate"),
    subtotal: real("subtotal").notNull(),
    discount: real("discount").notNull().default(0),
    discountReason: text("discount_reason").notNull().default(""),
    taxTotal: real("tax_total").notNull().default(0),
    taxesJson: text("taxes_json").notNull().default("[]"),
    deliveryFee: real("delivery_fee").notNull().default(0),
    total: real("total").notNull(),
    totalUsd: real("total_usd").notNull(),
    costUsd: real("cost_usd").notNull().default(0),
    itemsCount: integer("items_count").notNull().default(0),
    freeItems: integer("free_items").notNull().default(0),
    /** Free items taken from the loyalty reward / from the subscription allowance. */
    loyaltyFree: integer("loyalty_free").notNull().default(0),
    subFree: integer("sub_free").notNull().default(0),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => users.id),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason").notNull().default(""),
    /** Paid at the time of the order, in the order currency (the rest goes on the client's account). */
    paidAmount: real("paid_amount").notNull().default(0),
    consignmentId: text("consignment_id"),
  },
  (t) => [uniqueIndex("orders_number_uq").on(t.number), index("orders_date_idx").on(t.businessDate), index("orders_client_idx").on(t.clientId, t.businessDate)],
);

export const orderLines = sqliteTable(
  "order_lines",
  {
    ...base,
    orderId: text("order_id").notNull().references(() => orders.id),
    productId: text("product_id").notNull().references(() => products.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    qty: integer("qty").notNull(),
    /** How many of qty were free (loyalty reward). */
    freeQty: integer("free_qty").notNull().default(0),
    unitPrice: real("unit_price").notNull(),
    optionsJson: text("options_json").notNull().default("[]"),
    lineTotal: real("line_total").notNull(),
    unitCostUsd: real("unit_cost_usd").notNull().default(0),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId), index("order_lines_product_idx").on(t.productId)],
);

export const payments = sqliteTable(
  "payments",
  {
    ...base,
    kind: text("kind", { enum: ["order", "client_payment", "topup"] }).notNull(),
    orderId: text("order_id"),
    clientId: text("client_id"),
    methodId: text("method_id").notNull().references(() => paymentMethods.id),
    boxId: text("box_id").references(() => cashBoxes.id),
    amount: real("amount").notNull(),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
    fxRate: real("fx_rate"),
    amountUsd: real("amount_usd").notNull(),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => users.id),
    businessDate: text("business_date").notNull(),
  },
  (t) => [index("payments_date_idx").on(t.businessDate), index("payments_client_idx").on(t.clientId)],
);

export const recurringOrders = sqliteTable(
  "recurring_orders",
  {
    ...base,
    clientId: text("client_id").notNull().references(() => clients.id),
    /** e.g. "0,1,2,3,4" — 0 = Sunday */
    days: text("days").notNull(),
    linesJson: text("lines_json").notNull(),
    note: text("note").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("recurring_client_idx").on(t.clientId)],
);

/* ---------- Stage 9: Costs & people ---------- */
export const expenses = sqliteTable(
  "expenses",
  {
    ...base,
    date: text("date").notNull(),
    categoryId: text("category_id").references(() => lookups.id),
    itemId: text("item_id").references(() => lookups.id),
    amount: real("amount").notNull(),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
    fxRate: real("fx_rate"),
    amountUsd: real("amount_usd").notNull(),
    boxId: text("box_id").references(() => cashBoxes.id),
    assetId: text("asset_id"),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => users.id),
    /** paid: money already left a box · due: owed, not paid yet */
    status: text("status", { enum: ["paid", "due"] }).notNull().default("paid"),
    dueDate: text("due_date"),
    paidDate: text("paid_date"),
    paidBy: text("paid_by").notNull().default(""),
    beneficiary: text("beneficiary").notNull().default(""),
    photo: text("photo").notNull().default(""),
    /** The rep / route this cost belongs to (fuel, delivery). */
    employeeId: text("employee_id"),
    recurringId: text("recurring_id"),
  },
  (t) => [index("expenses_date_idx").on(t.date)],
);

export const assets = sqliteTable("assets", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  price: real("price").notNull(),
  currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
  fxRate: real("fx_rate"),
  priceUsd: real("price_usd").notNull(),
  purchaseDate: text("purchase_date").notNull(),
  lifeMonths: integer("life_months").notNull(),
  salvageUsd: real("salvage_usd").notNull().default(0),
  note: text("note").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const employees = sqliteTable("employees", {
  ...base,
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  jobTitle: text("job_title").notNull().default(""),
  userId: text("user_id").references(() => users.id),
  payModel: text("pay_model", { enum: ["fixed", "commission", "both"] }).notNull().default("fixed"),
  baseSalary: real("base_salary").notNull().default(0),
  currency: text("currency", { enum: ["USD", "SYP"] }).notNull().default("USD"),
  /** Commission in USD for each new client who converts from a trial they gave. */
  commissionPerClientUsd: real("commission_per_client_usd").notNull().default(0),
  /** % of the sales of orders delivered by this person. */
  commissionPct: real("commission_pct").notNull().default(0),
  staffDiscountPct: real("staff_discount_pct").notNull().default(30),
  isDeliveryRep: integer("is_delivery_rep", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const advances = sqliteTable(
  "advances",
  {
    ...base,
    employeeId: text("employee_id").notNull().references(() => employees.id),
    date: text("date").notNull(),
    amount: real("amount").notNull(),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
    fxRate: real("fx_rate"),
    amountUsd: real("amount_usd").notNull(),
    remainingUsd: real("remaining_usd").notNull(),
    boxId: text("box_id").references(() => cashBoxes.id),
    note: text("note").notNull().default(""),
  },
  (t) => [index("advances_emp_idx").on(t.employeeId)],
);

export const payrollRuns = sqliteTable("payroll_runs", {
  ...base,
  month: text("month").notNull().unique(),
  status: text("status", { enum: ["draft", "paid"] }).notNull().default("draft"),
  paidAt: text("paid_at"),
  boxId: text("box_id").references(() => cashBoxes.id),
});

export const payslips = sqliteTable(
  "payslips",
  {
    ...base,
    runId: text("run_id").notNull().references(() => payrollRuns.id),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    baseUsd: real("base_usd").notNull(),
    commissionUsd: real("commission_usd").notNull(),
    advancesUsd: real("advances_usd").notNull(),
    staffPurchasesUsd: real("staff_purchases_usd").notNull(),
    netUsd: real("net_usd").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
  },
  (t) => [index("payslips_run_idx").on(t.runId)],
);

export const salesCalls = sqliteTable(
  "sales_calls",
  {
    ...base,
    employeeId: text("employee_id").references(() => employees.id),
    clientId: text("client_id").references(() => clients.id),
    prospectName: text("prospect_name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    date: text("date").notNull(),
    result: text("result", { enum: ["no_answer", "interested", "not_interested", "trial_given", "converted", "follow_up"] }).notNull(),
    nextFollowUp: text("next_follow_up"),
    note: text("note").notNull().default(""),
  },
  (t) => [index("sales_calls_date_idx").on(t.date)],
);

/* ======================================================================
   Wholesale & distribution pack
   ====================================================================== */

/** Named price lists (distributor, big shop, small shop…) assigned to clients. */
export const priceLists = sqliteTable("price_lists", {
  ...base,
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const priceListItems = sqliteTable(
  "price_list_items",
  {
    ...base,
    listId: text("list_id").notNull().references(() => priceLists.id),
    productId: text("product_id").notNull().references(() => products.id),
    price: real("price").notNull(),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
  },
  (t) => [index("pli_list_idx").on(t.listId, t.productId)],
);

/** A morning production run: several products made together, one batch per product. */
export const productionRuns = sqliteTable(
  "production_runs",
  {
    ...base,
    number: integer("number").notNull(),
    businessDate: text("business_date").notNull(),
    employeeId: text("employee_id"),
    itemsCount: integer("items_count").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => users.id),
  },
  (t) => [uniqueIndex("runs_number_uq").on(t.number), index("runs_date_idx").on(t.businessDate)],
);

/** Goods left with a shop that pays only for what it sells. */
export const consignments = sqliteTable(
  "consignments",
  {
    ...base,
    number: integer("number").notNull(),
    businessDate: text("business_date").notNull(),
    clientId: text("client_id").notNull().references(() => clients.id),
    repId: text("rep_id"),
    status: text("status", { enum: ["open", "settled", "cancelled"] }).notNull().default("open"),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
    fxRate: real("fx_rate"),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => users.id),
    settledAt: text("settled_at"),
    orderId: text("order_id"),
    returnId: text("return_id"),
  },
  (t) => [uniqueIndex("consign_number_uq").on(t.number), index("consign_client_idx").on(t.clientId, t.status)],
);

export const consignmentLines = sqliteTable(
  "consignment_lines",
  {
    ...base,
    consignmentId: text("consignment_id").notNull().references(() => consignments.id),
    productId: text("product_id").notNull().references(() => products.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    qty: integer("qty").notNull(),
    /** Agreed net price per piece, in the consignment currency. */
    unitPrice: real("unit_price").notNull(),
    unitCostUsd: real("unit_cost_usd").notNull().default(0),
    returnedQty: integer("returned_qty").notNull().default(0),
  },
  (t) => [index("consign_lines_idx").on(t.consignmentId)],
);

/** Goods a client gives back. Each line goes back to the fridge or is written off. */
export const returns = sqliteTable(
  "returns",
  {
    ...base,
    number: integer("number").notNull(),
    businessDate: text("business_date").notNull(),
    clientId: text("client_id").references(() => clients.id),
    orderId: text("order_id"),
    consignmentId: text("consignment_id"),
    currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
    fxRate: real("fx_rate"),
    total: real("total").notNull(),
    totalUsd: real("total_usd").notNull(),
    costUsd: real("cost_usd").notNull().default(0),
    /** credit: added to the client's account · refund: cash back from a box · none: nothing to pay back */
    settlement: text("settlement", { enum: ["credit", "refund", "none"] }).notNull(),
    boxId: text("box_id"),
    repId: text("rep_id"),
    note: text("note").notNull().default(""),
    userId: text("user_id").references(() => users.id),
  },
  (t) => [uniqueIndex("returns_number_uq").on(t.number), index("returns_date_idx").on(t.businessDate)],
);

export const returnLines = sqliteTable(
  "return_lines",
  {
    ...base,
    returnId: text("return_id").notNull().references(() => returns.id),
    productId: text("product_id").notNull().references(() => products.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: real("unit_price").notNull(),
    lineTotal: real("line_total").notNull(),
    unitCostUsd: real("unit_cost_usd").notNull().default(0),
    action: text("action", { enum: ["restock", "waste"] }).notNull(),
    batchId: text("batch_id"),
  },
  (t) => [index("return_lines_idx").on(t.returnId)],
);

/** Rent, salaries… that come back every month: a "due" expense is created on the day. */
export const recurringExpenses = sqliteTable("recurring_expenses", {
  ...base,
  categoryId: text("category_id"),
  itemId: text("item_id"),
  amount: real("amount").notNull(),
  currency: text("currency", { enum: ["USD", "SYP"] }).notNull(),
  dayOfMonth: integer("day_of_month").notNull().default(1),
  beneficiary: text("beneficiary").notNull().default(""),
  note: text("note").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastMonth: text("last_month"),
});

/** Every time a purchase changes what an ingredient costs. */
export const priceChanges = sqliteTable(
  "price_changes",
  {
    ...base,
    itemId: text("item_id").notNull().references(() => items.id),
    oldCostUsd: real("old_cost_usd").notNull(),
    newCostUsd: real("new_cost_usd").notNull(),
    changePct: real("change_pct").notNull(),
    purchaseId: text("purchase_id"),
    businessDate: text("business_date").notNull(),
  },
  (t) => [index("price_changes_date_idx").on(t.businessDate)],
);
