import { count, eq } from "drizzle-orm";
import { DEFAULT_ROLE_PERMISSIONS, type SystemRoleKey } from "../../shared/permissions.js";
import { hashPassword } from "../lib/auth.js";
import { newId } from "../lib/util.js";
import { db } from "./client.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { cashBoxes, clientTiers, locations, lookups, paymentMethods, permissions, roles, users, warehouses } from "./schema.js";

const SYSTEM_ROLES: { key: SystemRoleKey; nameAr: string; nameEn: string }[] = [
  { key: "admin", nameAr: "الإدارة", nameEn: "Admin" },
  { key: "manager", nameAr: "المدير", nameEn: "Manager" },
  { key: "member", nameAr: "موظف", nameEn: "Member" },
];

const LOOKUP_SEED: Record<string, [string, string][]> = {
  unit: [["كيلوغرام", "Kilogram"], ["غرام", "Gram"], ["قطعة", "Piece"], ["لتر", "Liter"], ["علبة", "Box"]],
  expense_category: [["مواد غذائية", "Food supplies"], ["تغليف", "Packaging"], ["توصيل وسكوتر", "Delivery & scooter"], ["إيجار وفواتير", "Rent & bills"], ["أخرى", "Other"]],
  expense_item: [["بندورة", "Tomatoes"], ["خس", "Lettuce"], ["وقود السكوتر", "Scooter fuel"], ["ورق تغليف", "Wrap paper"]],
  client_tag: [["Study zone", "Study zone"], ["مقهى", "Café"], ["محل", "Shop"], ["مستقل", "Freelancer"]],
  waste_reason: [["منتهي الصلاحية", "Expired"], ["تالف", "Damaged"], ["خطأ في التحضير", "Prep mistake"]],
};

const LOOKUP_SEED_V2: Record<string, [string, string][]> = {
  expense_category: [
    ["إيجار", "Rent"], ["رواتب", "Salaries"], ["نقل وتوزيع", "Transport & distribution"], ["وقود", "Fuel"], ["كهرباء", "Electricity"],
    ["صيانة", "Maintenance"], ["تنظيف", "Cleaning"], ["اتصالات", "Telecom"], ["ضيافة", "Hospitality"], ["رسوم وتراخيص", "Fees & licenses"],
    ["مصاريف إدارية", "Admin"], ["مصاريف أخرى", "Other"],
  ],
  unit: [["مليلتر", "Milliliter"], ["عبوة", "Pack"], ["كرتونة", "Carton"]],
  waste_reason: [["مرتجع من زبون", "Returned by client"], ["تذوّق", "Tasting"]],
  area: [["المنطقة 1", "Area 1"]],
  cancel_reason: [["خطأ بالإدخال", "Entry mistake"], ["الزبون ألغى الطلب", "Client cancelled"], ["تكرار", "Duplicate"]],
};

/** Idempotent: safe to run on every start. */
export function seed() {
  db.transaction((tx) => {
    for (const r of SYSTEM_ROLES) {
      const existing = tx.select().from(roles).where(eq(roles.systemKey, r.key)).get();
      const roleId = existing?.id ?? newId();
      if (!existing) tx.insert(roles).values({ id: roleId, nameAr: r.nameAr, nameEn: r.nameEn, systemKey: r.key }).run();
      // Admin always holds every permission, so new modules added in later stages reach it automatically.
      if (!existing || r.key === "admin") {
        const have = new Set(
          tx.select().from(permissions).where(eq(permissions.roleId, roleId)).all().map((p) => `${p.module}:${p.action}`),
        );
        for (const p of DEFAULT_ROLE_PERMISSIONS[r.key]) {
          if (have.has(p)) continue;
          const [module, action] = p.split(":") as [string, string];
          tx.insert(permissions).values({ id: newId(), roleId, module, action }).run();
        }
      }
    }

    // Money: main cash box + Sham Cash wallet, and the payment methods that feed them.
    if ((tx.select({ n: count() }).from(cashBoxes).get()?.n ?? 0) === 0) {
      const cur = getSetting("currency.default");
      const main = newId();
      const sham = newId();
      tx.insert(cashBoxes).values([
        { id: main, nameAr: "الصندوق الرئيسي (كاش)", nameEn: "Main cash box", kind: "cash", currency: cur, systemKey: "main_cash" },
        { id: sham, nameAr: "محفظة شام كاش", nameEn: "Sham Cash wallet", kind: "wallet", currency: cur, systemKey: "sham" },
      ]).run();
      tx.insert(paymentMethods).values([
        { id: newId(), nameAr: "كاش", nameEn: "Cash", kind: "box", boxId: main, systemKey: "cash", sort: 0 },
        { id: newId(), nameAr: "شام كاش", nameEn: "Sham Cash", kind: "box", boxId: sham, systemKey: "sham", sort: 1 },
        { id: newId(), nameAr: "دين (على الحساب)", nameEn: "On credit", kind: "credit", systemKey: "credit", sort: 2 },
        { id: newId(), nameAr: "خصم من الراتب", nameEn: "Deduct from salary", kind: "salary", systemKey: "salary", sort: 3 },
      ]).run();
    }
    if ((tx.select({ n: count() }).from(clientTiers).get()?.n ?? 0) === 0) {
      tx.insert(clientTiers).values([
        { id: newId(), nameAr: "عادي", nameEn: "Normal", discountPct: 0, sort: 0 },
        { id: newId(), nameAr: "مميز", nameEn: "Favourite", discountPct: 10, sort: 1 },
      ]).run();
    }
    if ((tx.select({ n: count() }).from(warehouses).get()?.n ?? 0) === 0) {
      const wh = (nameAr: string, nameEn: string, kind: "store" | "fridge" | "freezer", sort: number, locs: [string, string][]) => {
        const id = newId();
        tx.insert(warehouses).values({ id, nameAr, nameEn, kind, sort }).run();
        for (const [ar, en] of locs) tx.insert(locations).values({ id: newId(), warehouseId: id, nameAr: ar, nameEn: en }).run();
      };
      wh("برّاد 1", "Fridge 1", "fridge", 0, [["الرف العلوي", "Top shelf"], ["الدرج السفلي", "Bottom drawer"]]);
      wh("برّاد 2", "Fridge 2", "fridge", 1, [["الباب", "Door"], ["الرف الأوسط", "Middle shelf"]]);
      wh("الفريزر", "Freezer", "freezer", 2, [["الرف العلوي", "Top shelf"]]);
      wh("المستودع", "Main store", "store", 3, [["رف A", "Shelf A"], ["رف B", "Shelf B"]]);
    }

    const lookupCount = tx.select({ n: count() }).from(lookups).get()?.n ?? 0;
    if (lookupCount === 0) {
      for (const [listType, items] of Object.entries(LOOKUP_SEED)) {
        items.forEach(([nameAr, nameEn], i) => tx.insert(lookups).values({ id: newId(), listType, nameAr, nameEn, sort: i }).run());
      }
    }

    // v2 (wholesale pack): the expense categories from JJ's requirements, areas, cancel reasons.
    if (getSetting("seed.version") < 2) {
      for (const [listType, items] of Object.entries(LOOKUP_SEED_V2)) {
        const have = new Set(tx.select().from(lookups).where(eq(lookups.listType, listType)).all().map((l) => l.nameEn.toLowerCase()));
        let sort = have.size;
        for (const [nameAr, nameEn] of items) if (!have.has(nameEn.toLowerCase())) tx.insert(lookups).values({ id: newId(), listType, nameAr, nameEn, sort: sort++ }).run();
      }
      setSetting("seed.version", 2, tx);
    }
  });
}

/**
 * Online server: one login per system role from JJS_<ROLE>_USERNAME / _PASSWORD / _NAME
 * (ADMIN, MANAGER, MEMBER), so nobody who opens the public site first can claim the setup page.
 * A user is created only if that username doesn't exist yet; existing passwords are never touched.
 */
export function seedUsersFromEnv() {
  const firstStart = (db.select({ n: count() }).from(users).get()?.n ?? 0) === 0;
  const wanted = (["admin", "manager", "member"] as const).flatMap((key) => {
    const env = (field: string) => process.env[`JJS_${key.toUpperCase()}_${field}`]?.trim();
    const username = env("USERNAME")?.toLowerCase();
    const password = env("PASSWORD");
    if (!username && !password) return [];
    const prefix = `JJS_${key.toUpperCase()}`;
    if (!username || !/^[a-z0-9._-]{2,30}$/.test(username)) throw new Error(`${prefix}_USERNAME: 2–30 English letters, numbers, dot, dash or underscore`);
    if (!password || password.length < 6) throw new Error(`${prefix}_PASSWORD must be at least 6 characters`);
    return [{ key, username, password, name: env("NAME") || username }];
  });
  if (new Set(wanted.map((w) => w.username)).size !== wanted.length) throw new Error("JJS_*_USERNAME: each role needs a different username");

  db.transaction((tx) => {
    for (const w of wanted) {
      if (tx.select().from(users).where(eq(users.username, w.username)).get()) continue;
      const role = tx.select().from(roles).where(eq(roles.systemKey, w.key)).get();
      if (!role) throw new Error(`The ${w.key} role is missing`);
      tx.insert(users).values({ id: newId(), name: w.name, username: w.username, passwordHash: hashPassword(w.password), roleId: role.id, language: "ar" }).run();
      console.log(`[jjs] ${w.key} "${w.username}" created from environment`);
    }
    const nameEn = process.env.JJS_BUSINESS_NAME_EN?.trim();
    const nameAr = process.env.JJS_BUSINESS_NAME_AR?.trim();
    if (firstStart && (nameEn || nameAr)) setSetting("business", { ...getSetting("business"), ...(nameAr && { nameAr }), ...(nameEn && { nameEn }) }, tx);
  });
}
