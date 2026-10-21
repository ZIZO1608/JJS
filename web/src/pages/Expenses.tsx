import { useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { LookupSelect } from "../components/LookupSelect";
import { Stat } from "../components/Tabs";
import { ConfirmDialog, Empty, Field, PageHeader, Select, Spinner, TextInput } from "../components/ui";
import { ApiError, del, post } from "../lib/api";
import { useAppSettings } from "../lib/appSettings";
import { useAuth } from "../lib/auth";
import { money, monthStartOf, num, today, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import type { CashBox, Named } from "../lib/types";
import { useData } from "../lib/useData";

interface Expense {
  id: string;
  date: string;
  categoryId: string | null;
  itemId: string | null;
  amount: number;
  currency: Currency;
  amountUsd: number;
  boxId: string | null;
  assetId: string | null;
  note: string;
  category: { nameAr: string; nameEn: string } | null;
  item: { nameAr: string; nameEn: string } | null;
  box: { nameAr: string; nameEn: string } | null;
  userName: string | null;
}

/** The add form — a card on the page (simple mode) or inside the admin list. */
function ExpenseForm({ onSaved, big }: { onSaved: () => void; big?: boolean }) {
  const { tr, pick, err, fieldErrors } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { s } = useAppSettings();
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  const assets = useData<{ rows: (Named & { active: boolean })[] }>(can("assets", "view") ? "/assets" : null);
  const mainBox = boxes.data?.rows.find((b) => b.systemKey === "main_cash");
  const blank = () => ({ date: today(), categoryId: "", itemId: "", amount: "", currency: (s?.defaultCurrency ?? "USD") as Currency, boxId: "", assetId: "", note: "" });
  const [f, setF] = useState(blank);
  const [boxTouched, setBoxTouched] = useState(false);
  const boxId = boxTouched ? f.boxId : f.boxId || mainBox?.id || "";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const amount = num(f.amount);

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      await post("/expenses", { ...f, amount, boxId: boxId || null, categoryId: f.categoryId || null, itemId: f.itemId || null, assetId: f.assetId || null });
      toast(tr("تم تسجيل المصروف", "Expense saved"));
      setF({ ...blank(), currency: f.currency, categoryId: f.categoryId });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`card grid gap-3 ${big ? "p-5" : ""}`}>
      <h2 className="font-semibold">{tr("مصروف جديد", "New expense")}</h2>
      <div className={`grid gap-3 ${big ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        <Field label={tr("البند", "What for")} htmlFor="x-item" hint={tr("آخر خيار «+ إضافة جديد» يضيف بند للقائمة", "The last option “+ Add new” adds to the list")}>
          <LookupSelect id="x-item" listType="expense_item" value={f.itemId} onChange={(v) => setF({ ...f, itemId: v })} />
        </Field>
        <Field label={tr("الفئة", "Category")} htmlFor="x-cat">
          <LookupSelect id="x-cat" listType="expense_category" value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={tr("المبلغ", "Amount")} htmlFor="x-amt" error={errors.amount}>
            <TextInput id="x-amt" dir="ltr" inputMode="decimal" className={`num ${big ? "text-lg" : ""}`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label={tr("العملة", "Currency")} htmlFor="x-cur">
            <Select id="x-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
              <option value="USD">USD</option>
              <option value="SYP">SYP</option>
            </Select>
          </Field>
        </div>
        <Field label={tr("دُفع من", "Paid from")} htmlFor="x-box">
          <Select
            id="x-box"
            value={boxId}
            onChange={(e) => {
              setBoxTouched(true);
              setF({ ...f, boxId: e.target.value });
            }}
          >
            <option value="">{tr("— ما طلع من صندوق —", "— not from a box —")}</option>
            {boxes.data?.rows
              .filter((b) => b.active && b.kind !== "rep")
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {pick(b)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={tr("التاريخ", "Date")} htmlFor="x-date" error={errors.date}>
          <TextInput id="x-date" type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        {assets.data && assets.data.rows.length > 0 && (
          <Field label={tr("مرتبط بأصل (صيانة…)", "For an asset (repair…)")} htmlFor="x-asset">
            <Select id="x-asset" value={f.assetId} onChange={(e) => setF({ ...f, assetId: e.target.value })}>
              <option value="">—</option>
              {assets.data.rows.map((a) => (
                <option key={a.id} value={a.id}>
                  {pick(a)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className={big ? "sm:col-span-2" : "sm:col-span-2"}>
          <Field label={tr("ملاحظة", "Note")} htmlFor="x-note" error={errors.note}>
            <TextInput id="x-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
      </div>
      <div>
        <button className={`btn btn-primary ${big ? "px-6 py-3 text-lg" : ""}`} onClick={save} disabled={saving || !(amount > 0) || (!f.itemId && !f.categoryId)}>
          {saving ? tr("جارٍ الحفظ…", "Saving…") : tr("سجّل المصروف", "Save expense")}
        </button>
      </div>
    </div>
  );
}

export function ExpensesPage() {
  const { tr, pick, err } = useI18n();
  const { can, simple } = useAuth();
  const toast = useToast();
  const [range, setRange] = useState(() => (simple ? { from: today(), to: today() } : { from: monthStartOf(today()), to: today() }));
  const { data, reload } = useData<{ rows: Expense[] }>(`/expenses?from=${range.from}&to=${range.to}`);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const byCat = useMemo(() => {
    const m = new Map<string, { label: { nameAr: string; nameEn: string } | null; usd: number; n: number }>();
    for (const e of data?.rows ?? []) {
      const k = e.categoryId ?? "-";
      const cur = m.get(k) ?? { label: e.category, usd: 0, n: 0 };
      cur.usd += e.amountUsd;
      cur.n += 1;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.usd - a.usd);
  }, [data]);

  const total = (data?.rows ?? []).reduce((s, e) => s + e.amountUsd, 0);

  const columns: Column<Expense>[] = [
    { key: "date", header: tr("التاريخ", "Date"), sortValue: (e) => e.date, render: (e) => <span className="num ltr">{e.date}</span> },
    {
      key: "what",
      header: tr("البند", "What"),
      sortValue: (e) => (e.item ? pick(e.item) : ""),
      render: (e) => (
        <div>
          <div className="font-semibold">{e.item ? pick(e.item) : e.category ? pick(e.category) : "—"}</div>
          <div className="text-xs text-faint">{[e.item && e.category ? pick(e.category) : null, e.note].filter(Boolean).join(" · ")}</div>
        </div>
      ),
    },
    { key: "box", header: tr("من", "From"), render: (e) => (e.box ? pick(e.box) : <span className="text-faint">—</span>) },
    { key: "by", header: tr("سجّله", "By"), render: (e) => <span className="text-muted">{e.userName ?? "—"}</span> },
    {
      key: "amt",
      header: tr("المبلغ", "Amount"),
      align: "end",
      sortValue: (e) => e.amountUsd,
      render: (e) => (
        <span className="num ltr whitespace-nowrap">
          {money(e.amount, e.currency)}
          {e.currency !== "USD" && <span className="block text-xs text-faint">{money(e.amountUsd)}</span>}
        </span>
      ),
    },
    {
      key: "act",
      header: "",
      align: "end",
      render: (e) =>
        can("expenses", "delete") && (
          <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setDeleting(e)}>
            {tr("حذف", "Delete")}
          </button>
        ),
    },
  ];

  const deleteDialog = deleting && (
    <ConfirmDialog
      text={tr("حذف هذا المصروف؟ المبلغ بيرجع للصندوق.", "Delete this expense? The money goes back to the box.")}
      onClose={() => setDeleting(null)}
      onConfirm={async () => {
        try {
          await del(`/expenses/${deleting.id}`);
          setDeleting(null);
          toast(tr("تم الحذف", "Deleted"));
          void reload();
        } catch (e) {
          toast(err(e), "error");
        }
      }}
    />
  );

  if (simple) {
    return (
      <>
        <PageHeader title={tr("المصاريف", "Expenses")} subtitle={tr("سجّل أي مبلغ طلع من الصندوق: غاز، توصيل، تصليح…", "Record any money that left the box: gas, delivery, repairs…")} />
        {can("expenses", "create") && <ExpenseForm big onSaved={() => void reload()} />}
        <h2 className="mb-2 mt-6 font-semibold">{tr("مصاريف اليوم", "Today's expenses")}</h2>
        {!data ? (
          <Spinner />
        ) : data.rows.length === 0 ? (
          <Empty text={tr("ما في مصاريف اليوم", "No expenses today")} />
        ) : (
          <div className="grid gap-2">
            {data.rows.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
                <div className="min-w-0">
                  <div className="font-semibold">{e.item ? pick(e.item) : e.category ? pick(e.category) : "—"}</div>
                  <div className="text-xs text-faint">{e.note}</div>
                </div>
                <span className="num ltr font-semibold">{money(e.amount, e.currency)}</span>
              </div>
            ))}
          </div>
        )}
        {deleteDialog}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={tr("المصاريف", "Expenses")}
        subtitle={tr("كل مبلغ طلع على المحل. البنود قابلة للإضافة من القائمة نفسها.", "Everything the shop spends. Add new items straight from the dropdown.")}
        actions={
          can("expenses", "create") && (
            <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
              {showForm ? tr("إخفاء النموذج", "Hide form") : tr("+ مصروف", "+ Add expense")}
            </button>
          )
        }
      />
      {showForm && (
        <div className="mb-5">
          <ExpenseForm onSaved={() => void reload()} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={tr("من", "From")} htmlFor="xr-from">
          <TextInput id="xr-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field label={tr("إلى", "To")} htmlFor="xr-to">
          <TextInput id="xr-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </Field>
      </div>
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_2fr]">
            <Stat label={tr("مجموع المصاريف", "Total spent")} value={money(total)} sub={tr(`${data.rows.length} مصروف`, `${data.rows.length} expense(s)`)} />
            <div className="card">
              <div className="mb-2 text-sm text-muted">{tr("حسب الفئة", "By category")}</div>
              {byCat.length === 0 ? (
                <p className="text-faint">—</p>
              ) : (
                <div className="grid gap-1.5">
                  {byCat.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="w-32 truncate">{c.label ? pick(c.label) : tr("بدون فئة", "No category")}</span>
                      <div className="h-2 flex-1 rounded-full bg-sunken">
                        <div className="h-2 rounded-full bg-ink" style={{ width: `${total > 0 ? Math.max(2, (c.usd / total) * 100) : 0}%` }} />
                      </div>
                      <span className="w-24 text-end num ltr">{money(c.usd)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DataTable rows={data.rows} columns={columns} rowKey={(e) => e.id} searchText={(e) => `${e.item?.nameAr ?? ""} ${e.item?.nameEn ?? ""} ${e.category?.nameAr ?? ""} ${e.category?.nameEn ?? ""} ${e.note}`} />
        </>
      )}
      {deleteDialog}
    </>
  );
}
