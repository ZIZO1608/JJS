// Single source of truth for modules, actions and the seeded role matrix.
// Imported by the server (enforcement) and the web app (hiding UI).

export const MODULES = [
  "home",
  "dashboard",
  "orders",
  "daily_close",
  "clients",
  "menu",
  "warehouse",
  "purchasing",
  "costing",
  "expenses",
  "assets",
  "people",
  "reports",
  "settings",
  "users",
  "roles",
  "audit",
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ["view", "create", "edit", "delete", "export", "see_cost"] as const;
export type Action = (typeof ACTIONS)[number];

export type Permission = `${Module}:${Action}`;
export const perm = (m: Module, a: Action): Permission => `${m}:${a}`;

/** Which stage builds each module — used to show "coming in a later stage" placeholders. */
export const MODULE_STAGE: Record<Module, number> = {
  home: 1,
  settings: 1,
  users: 1,
  roles: 1,
  audit: 1,
  menu: 2,
  warehouse: 3,
  purchasing: 4,
  costing: 4,
  clients: 5,
  orders: 6,
  daily_close: 8,
  dashboard: 8,
  reports: 8,
  expenses: 9,
  assets: 9,
  people: 9,
};

export const MODULE_LABEL: Record<Module, { ar: string; en: string }> = {
  home: { ar: "الرئيسية", en: "Home" },
  dashboard: { ar: "لوحة التحكم", en: "Dashboard" },
  orders: { ar: "الطلبات", en: "Orders" },
  daily_close: { ar: "الإغلاق اليومي", en: "Daily close" },
  clients: { ar: "الزبائن", en: "Clients" },
  menu: { ar: "القائمة", en: "Menu" },
  warehouse: { ar: "المستودع والبرّاد", en: "Warehouse & fridge" },
  purchasing: { ar: "المشتريات", en: "Purchasing" },
  costing: { ar: "التكاليف", en: "Costing" },
  expenses: { ar: "المصاريف", en: "Expenses" },
  assets: { ar: "الأصول", en: "Assets" },
  people: { ar: "الموظفون والرواتب", en: "People & payroll" },
  reports: { ar: "التقارير", en: "Reports" },
  settings: { ar: "الإعدادات", en: "Settings" },
  users: { ar: "المستخدمون", en: "Users" },
  roles: { ar: "الأدوار والصلاحيات", en: "Roles & permissions" },
  audit: { ar: "سجل العمليات", en: "Audit log" },
};

export const ACTION_LABEL: Record<Action, { ar: string; en: string }> = {
  view: { ar: "عرض", en: "View" },
  create: { ar: "إضافة", en: "Create" },
  edit: { ar: "تعديل", en: "Edit" },
  delete: { ar: "حذف", en: "Delete" },
  export: { ar: "تصدير", en: "Export" },
  see_cost: { ar: "رؤية التكاليف", en: "See costs" },
};

export type SystemRoleKey = "admin" | "manager" | "member";

const all = (m: Module): Permission[] => ACTIONS.map((a) => perm(m, a));

/** Seeded permissions for the three system roles (spec: Roles & permissions). */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleKey, Permission[]> = {
  admin: MODULES.flatMap(all),
  manager: [
    perm("home", "view"),
    ...["view", "create", "edit", "delete"].map((a) => perm("orders", a as Action)),
    perm("daily_close", "view"),
    perm("daily_close", "create"), // close the day (reopen = edit, admin only)
    perm("clients", "view"),
    perm("clients", "create"), // record payments
    perm("menu", "view"),
    ...["view", "create", "edit", "delete"].map((a) => perm("warehouse", a as Action)),
    perm("expenses", "view"),
    perm("expenses", "create"),
    perm("reports", "view"),
  ],
  member: [
    perm("home", "view"),
    perm("orders", "view"),
    perm("orders", "create"),
    perm("menu", "view"),
    perm("warehouse", "view"),
    perm("warehouse", "create"),
  ],
};

/** "Simple mode" (big buttons, no charts/costs) is for anyone who cannot see costs. */
export const usesSimpleMode = (perms: Iterable<string>) => !new Set(perms).has(perm("costing", "see_cost"));

export const LOOKUP_TYPES = [
  "expense_item",
  "expense_category",
  "unit",
  "payment_method",
  "client_tag",
  "waste_reason",
] as const;
export type LookupType = (typeof LOOKUP_TYPES)[number];

export const LOOKUP_LABEL: Record<LookupType, { ar: string; en: string }> = {
  expense_item: { ar: "بنود المصاريف", en: "Expense items" },
  expense_category: { ar: "فئات المصاريف", en: "Expense categories" },
  unit: { ar: "وحدات القياس", en: "Units" },
  payment_method: { ar: "طرق الدفع", en: "Payment methods" },
  client_tag: { ar: "تصنيفات الزبائن", en: "Client tags" },
  waste_reason: { ar: "أسباب الهدر", en: "Waste reasons" },
};
