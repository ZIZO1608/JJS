import { count, eq } from "drizzle-orm";
import { DEFAULT_ROLE_PERMISSIONS, type SystemRoleKey } from "../../shared/permissions.js";
import { newId } from "../lib/util.js";
import { db } from "./client.js";
import { getSetting } from "../lib/settings.js";
import { cashBoxes, clientTiers, locations, lookups, paymentMethods, permissions, roles, warehouses } from "./schema.js";

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
  });
}
