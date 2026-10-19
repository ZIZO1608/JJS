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
