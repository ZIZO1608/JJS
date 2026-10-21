import { Fragment, useCallback, useEffect, useState } from "react";
import { Field, PageHeader, Select, Spinner, TextInput } from "../components/ui";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n, type TKey } from "../lib/i18n";
import { useToast } from "../lib/toast";

interface Entry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  userName: string | null;
  createdAt: string;
  before: unknown;
  after: unknown;
}
const ACTIONS = ["create", "edit", "delete", "login", "logout", "setup", "backup"];
const ENTITIES = ["user", "role", "tax", "settings.business", "settings.currency", "settings.fx.manual", "settings.fx.config", "system"];
const ENTITY_LABEL: Record<string, { ar: string; en: string }> = {
  user: { ar: "مستخدم", en: "User" },
  role: { ar: "دور", en: "Role" },
  tax: { ar: "ضريبة", en: "Tax" },
  "settings.business": { ar: "بيانات المحل", en: "Business info" },
  "settings.currency": { ar: "العملة الأساسية", en: "Main currency" },
  "settings.fx.manual": { ar: "سعر صرف يدوي", en: "Manual rate" },
  "settings.fx.config": { ar: "إعداد API سعر الصرف", en: "Rate API settings" },
  system: { ar: "النظام", en: "System" },
  "lookup.expense_item": { ar: "قائمة بنود المصاريف", en: "Expense items list" },
  "lookup.expense_category": { ar: "قائمة فئات المصاريف", en: "Expense categories list" },
  "lookup.unit": { ar: "قائمة الوحدات", en: "Units list" },
  "lookup.client_tag": { ar: "قائمة تصنيفات الزبائن", en: "Client tags list" },
  "lookup.waste_reason": { ar: "قائمة أسباب الهدر", en: "Waste reasons list" },
  category: { ar: "فئة", en: "Category" },
  product: { ar: "منتج", en: "Product" },
  option_group: { ar: "مجموعة إضافات", en: "Add-on group" },
  option: { ar: "إضافة", en: "Add-on" },
  warehouse: { ar: "مستودع / برّاد", en: "Store / fridge" },
  location: { ar: "مكان", en: "Place" },
  item: { ar: "مادة", en: "Stock item" },
  "stock.receive": { ar: "استلام مخزون", en: "Stock received" },
  "stock.production": { ar: "تحضير", en: "Made" },
  "stock.waste": { ar: "هدر", en: "Waste" },
  "stock.transfer": { ar: "نقل مخزون", en: "Stock moved" },
  "stock.count": { ar: "جرد", en: "Stock count" },
  supplier: { ar: "مورّد", en: "Supplier" },
  purchase: { ar: "فاتورة شراء", en: "Purchase" },
  client: { ar: "زبون", en: "Client" },
  client_tier: { ar: "فئة زبائن", en: "Client tier" },
  subscription_plan: { ar: "خطة اشتراك", en: "Subscription plan" },
  subscription: { ar: "اشتراك", en: "Subscription" },
  sales_call: { ar: "اتصال مبيعات", en: "Sales call" },
  "client.payment": { ar: "دفعة زبون", en: "Client payment" },
  "client.adjust": { ar: "تعديل رصيد زبون", en: "Client balance adjustment" },
  "client.prices": { ar: "أسعار خاصة", en: "Special prices" },
  "category.groups": { ar: "إضافات الفئة", en: "Category add-ons" },
  "option.recipe": { ar: "وصفة إضافة", en: "Add-on recipe" },
  "item.cost": { ar: "سعر مادة", en: "Item cost" },
  "purchase.payment": { ar: "دفعة مشتريات", en: "Purchase payment" },
  "day.close": { ar: "إقفال اليوم", en: "Day closed" },
  "day.reopen": { ar: "إعادة فتح اليوم", en: "Day reopened" },
  recurring_order: { ar: "طلب ثابت", en: "Standing order" },
  order: { ar: "طلب", en: "Order" },
  cash_box: { ar: "صندوق", en: "Cash box" },
  payment_method: { ar: "طريقة دفع", en: "Payment method" },
  "money.transfer": { ar: "تحويل بين الصناديق", en: "Box transfer" },
  "money.handover": { ar: "تسليم كاش المندوب", en: "Cash handover" },
  "money.opening": { ar: "رصيد افتتاحي", en: "Opening balance" },
  expense: { ar: "مصروف", en: "Expense" },
  asset: { ar: "أصل", en: "Asset" },
  employee: { ar: "موظف", en: "Employee" },
  advance: { ar: "سلفة", en: "Advance" },
  payroll: { ar: "رواتب", en: "Payroll" },
  "settings.loyalty": { ar: "برنامج الولاء", en: "Loyalty" },
  "settings.orders": { ar: "إعدادات الطلبات", en: "Order settings" },
  "settings.printing": { ar: "الطباعة", en: "Printing" },
  "settings.network": { ar: "الشبكة", en: "Network" },
  "settings.sync": { ar: "النسخة السحابية", en: "Cloud copy" },
  "system.demo_data": { ar: "بيانات تجريبية", en: "Sample data" },
};

export function AuditPage() {
  const { t, err, fmtDate, pick } = useI18n();
  const entityName = (e: string) => (ENTITY_LABEL[e] ? pick(ENTITY_LABEL[e]) : e);
  const { can } = useAuth();
  const toast = useToast();
  const [filters, setFilters] = useState({ entity: "", userId: "", action: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; entries: Entry[] } | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (can("users", "view")) get<{ users: { id: string; name: string }[] }>("/users").then((r) => setUsers(r.users)).catch(() => undefined);
  }, [can]);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: "50" });
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    setData(await get(`/audit?${qs}`));
  }, [filters, page]);
  useEffect(() => {
    load().catch((e) => toast(err(e), "error"));
  }, [load, toast, err]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const setF = (k: keyof typeof filters, v: string) => {
    setFilters({ ...filters, [k]: v });
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <div className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t("audit.entity")} htmlFor="f-entity">
          <Select id="f-entity" value={filters.entity} onChange={(e) => setF("entity", e.target.value)}>
            <option value="">{t("common.all")}</option>
            {ENTITIES.map((x) => (
              <option key={x} value={x}>
                {entityName(x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("audit.who")} htmlFor="f-user">
          <Select id="f-user" value={filters.userId} onChange={(e) => setF("userId", e.target.value)}>
            <option value="">{t("common.all")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("audit.what")} htmlFor="f-action">
          <Select id="f-action" value={filters.action} onChange={(e) => setF("action", e.target.value)}>
            <option value="">{t("common.all")}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`audit.actions.${a}` as TKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.from")} htmlFor="f-from">
          <TextInput id="f-from" type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} />
        </Field>
        <Field label={t("common.to")} htmlFor="f-to">
          <TextInput id="f-to" type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} />
        </Field>
      </div>

      {!data ? (
        <Spinner />
      ) : (
        <div className="card p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="th">{t("audit.when")}</th>
                  <th className="th">{t("audit.who")}</th>
                  <th className="th">{t("audit.what")}</th>
                  <th className="th">{t("audit.entity")}</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="hover:bg-sunken">
                      <td className="td whitespace-nowrap text-muted">{fmtDate(e.createdAt, true)}</td>
                      <td className="td">{e.userName ?? t("audit.system")}</td>
                      <td className="td">{t(`audit.actions.${e.action}` as TKey)}</td>
                      <td className="td text-muted">{entityName(e.entity)}</td>
                      <td className="td text-end">
                        {(e.before !== null || e.after !== null) && (
                          <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                            {t("audit.details")}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === e.id && (
                      <tr>
                        <td colSpan={5} className="td bg-sunken">
                          <div className="grid gap-3 md:grid-cols-2">
                            {(["before", "after"] as const).map((k) => (
                              <div key={k} className="min-w-0">
                                <div className="mb-1 text-xs font-semibold text-muted">{t(`audit.${k}`)}</div>
                                <pre dir="ltr" className="max-h-64 overflow-auto rounded-lg bg-surface p-3 text-xs">
                                  {e[k] === null ? "—" : JSON.stringify(e[k], null, 2)}
                                </pre>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2 p-3 text-sm text-muted">
            <span>{t("common.total", { n: data.total })}</span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost px-2 py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {t("common.prev")}
                </button>
                <span className="num">{t("common.page", { page, pages })}</span>
                <button className="btn btn-ghost px-2 py-1" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  {t("common.next")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
