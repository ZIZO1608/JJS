import { count, eq } from "drizzle-orm";
import { DEFAULT_ROLE_PERMISSIONS, type SystemRoleKey } from "../../shared/permissions.js";
import { newId } from "../lib/util.js";
import { db } from "./client.js";
import { lookups, permissions, roles } from "./schema.js";

const SYSTEM_ROLES: { key: SystemRoleKey; nameAr: string; nameEn: string }[] = [
  { key: "admin", nameAr: "الإدارة", nameEn: "Admin" },
  { key: "manager", nameAr: "المدير", nameEn: "Manager" },
  { key: "member", nameAr: "موظف", nameEn: "Member" },
];

const LOOKUP_SEED: Record<string, [string, string][]> = {
  unit: [["كيلوغرام", "Kilogram"], ["غرام", "Gram"], ["قطعة", "Piece"], ["لتر", "Liter"], ["علبة", "Box"]],
  payment_method: [["كاش", "Cash"], ["شام كاش", "Sham Cash"], ["دين (على الحساب)", "On credit"]],
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

    const lookupCount = tx.select({ n: count() }).from(lookups).get()?.n ?? 0;
    if (lookupCount === 0) {
      for (const [listType, items] of Object.entries(LOOKUP_SEED)) {
        items.forEach(([nameAr, nameEn], i) => tx.insert(lookups).values({ id: newId(), listType, nameAr, nameEn, sort: i }).run());
      }
    }
  });
}
