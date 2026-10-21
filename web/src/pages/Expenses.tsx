import { useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { LookupSelect } from "../components/LookupSelect";
import { Stat } from "../components/Tabs";
import { ConfirmDialog, Empty, Field, Modal, PageHeader, Select, Spinner, TextInput } from "../components/ui";
import { Tabs } from "../components/Tabs";
import { ApiError, del, get, post, put } from "../lib/api";
import { useAppSettings } from "../lib/appSettings";
import { useAuth } from "../lib/auth";
import { money, monthStartOf, num, today, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import type { CashBox, Employee, Named } from "../lib/types";
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
  status?: "paid" | "due";
  dueDate?: string | null;
  paidDate?: string | null;
  paidBy?: string;
  beneficiary?: string;
  photo?: string;
  employeeId?: string | null;
  employeeName?: string | null;
  recurringId?: string | null;
}

/** Shrink a photo of a receipt to at most 1600 px and return it as a JPEG data URL. */
function resizeImage(file: File, maxPx = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = 0.8;
      let out = c.toDataURL("image/jpeg", q);
      while (out.length > 1_400_000 && q > 0.3) {
        q -= 0.15;
        out = c.toDataURL("image/jpeg", q);
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error("bad image"));
    img.src = url;
  });
}

/** Delivery people, for linking fuel / road costs to a route. */
function useReps() {
  const { can } = useAuth();
  const emps = useData<{ rows: Employee[] }>(can("people", "view") ? "/people/employees" : null);
  const reps = useData<{ rows: { id: string; name: string }[] }>(can("people", "view") ? null : "/money/reps");
  return emps.data ? emps.data.rows.filter((e) => e.isDeliveryRep && e.active).map((e) => ({ id: e.id, name: e.name })) : (reps.data?.rows ?? []);
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
  const reps = useReps();
  const blank = () => ({
    date: today(),
    categoryId: "",
    itemId: "",
    amount: "",
    currency: (s?.defaultCurrency ?? "USD") as Currency,
    boxId: "",
    assetId: "",
    note: "",
    status: "paid" as "paid" | "due",
    dueDate: today(),
    paidBy: "",
    beneficiary: "",
    employeeId: "",
    photo: "",
  });
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
      await post("/expenses", {
        ...f,
        amount,
        boxId: f.status === "paid" ? boxId || null : null,
        dueDate: f.status === "due" ? f.dueDate || null : null,
        categoryId: f.categoryId || null,
        itemId: f.itemId || null,
        assetId: f.assetId || null,
        employeeId: f.employeeId || null,
      });
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{tr("مصروف جديد", "New expense")}</h2>
        <div className="inline-flex rounded-lg bg-sunken p-0.5" role="group" aria-label={tr("الدفع", "Payment")}>
          {(["paid", "due"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={f.status === k}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${f.status === k ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
              onClick={() => setF({ ...f, status: k })}
            >
              {k === "paid" ? tr("مدفوع الآن", "Paid now") : tr("لسا ما انْدفع", "Not paid yet")}
            </button>
          ))}
        </div>
      </div>
      <div className={`grid gap-3 ${big ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        <Field label={tr("البند", "What for")} htmlFor="x-item" hint={tr("آخر خيار «+ إضافة جديد» يضيف بند للقائمة", "The last option “+ Add new” adds to the list")}>
          <LookupSelect id="x-item" listType="expense_item" value={f.itemId} onChange={(v) => setF({ ...f, itemId: v })} />
        </Field>
        <Field label={tr("الفئة", "Category")} htmlFor="x-cat">
          <LookupSelect id="x-cat" listType="expense_category" value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={tr("المبلغ", "Amount")} htmlFor="x-amt" error={errors.amount}>
            <TextInput
              id="x-amt"
              dir="ltr"
              inputMode="decimal"
              className={`num ${big ? "text-lg" : ""}`}
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          </Field>
          <Field label={tr("العملة", "Currency")} htmlFor="x-cur">
            <Select id="x-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
              <option value="USD">USD</option>
              <option value="SYP">SYP</option>
            </Select>
          </Field>
        </div>
        {f.status === "due" ? (
          <Field label={tr("تاريخ الاستحقاق", "Due date")} htmlFor="x-due">
            <TextInput id="x-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </Field>
        ) : (
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
        )}
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
        {f.status === "paid" && (
          <Field label={tr("مين دفع", "Paid by")} htmlFor="x-paidby">
            <TextInput id="x-paidby" value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value })} />
          </Field>
        )}
        <Field label={tr("المستفيد", "Paid to")} htmlFor="x-ben" hint={tr("مثلاً: صاحب المحل، شركة الكهرباء", "e.g. landlord, electricity company")}>
          <TextInput id="x-ben" value={f.beneficiary} onChange={(e) => setF({ ...f, beneficiary: e.target.value })} />
        </Field>
        {reps.length > 0 && (
          <Field label={tr("للمندوب / خط التوزيع", "For a rep / route")} htmlFor="x-rep" hint={tr("للوقود ومصاريف الطريق", "For fuel and road costs")}>
            <Select id="x-rep" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
              <option value="">—</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={tr("صورة الفاتورة", "Receipt photo")} htmlFor="x-photo">
          <div className="flex items-center gap-2">
            <input
              id="x-photo"
              type="file"
              accept="image/*"
              className="block w-full text-sm"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setF({ ...f, photo: await resizeImage(file) });
                } catch {
                  toast(tr("ما قدرنا نقرأ الصورة", "Could not read that image"), "error");
                }
              }}
            />
            {f.photo && <span className="chip">✓</span>}
          </div>
        </Field>
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

/** Pay an expense that was recorded as "not paid yet". */
function PayDialog({ e, onClose, onDone }: { e: Expense; onClose: () => void; onDone: () => void }) {
  const { tr, pick, err } = useI18n();
  const toast = useToast();
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  const main = boxes.data?.rows.find((b) => b.systemKey === "main_cash");
  const [box, setBox] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const boxId = box || main?.id || "";
  const pay = async () => {
    try {
      await post(`/expenses/${e.id}/pay`, { boxId: boxId || null, paidBy });
      toast(tr("تم الدفع", "Paid"));
      onDone();
    } catch (x) {
      toast(err(x), "error");
    }
  };
  return (
    <Modal
      title={tr("دفع مصروف مستحق", "Pay a due expense")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={pay}>
            {tr("ادفع", "Pay")} <span className="num ltr">{money(e.amount, e.currency)}</span>
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm text-muted">
          {e.item ? pick(e.item) : e.category ? pick(e.category) : "—"}
          {e.beneficiary ? ` · ${e.beneficiary}` : ""}
        </p>
        <Field label={tr("من صندوق", "From box")} htmlFor="xp-box">
          <Select id="xp-box" value={boxId} onChange={(x) => setBox(x.target.value)}>
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
        <Field label={tr("مين دفع", "Paid by")} htmlFor="xp-by">
          <TextInput id="xp-by" value={paidBy} onChange={(x) => setPaidBy(x.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function PhotoModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { tr } = useI18n();
  const { data } = useData<{ photo: string }>(`/expenses/${id}/photo`);
  return (
    <Modal
      wide
      title={tr("صورة الفاتورة", "Receipt photo")}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {tr("إغلاق", "Close")}
        </button>
      }
    >
      {data ? <img src={data.photo} alt={tr("صورة الفاتورة", "Receipt photo")} className="mx-auto max-h-[70vh] rounded-lg" /> : <Spinner />}
    </Modal>
  );
}

interface Recurring {
  id: string;
  categoryId: string | null;
  itemId: string | null;
  amount: number;
  currency: Currency;
  dayOfMonth: number;
  beneficiary: string;
  note: string;
  active: boolean;
  lastMonth: string | null;
}

/** Rent, salaries…: entered once, a "due" expense appears on that day every month. */
function MonthlyTab() {
  const { tr, pick, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { s } = useAppSettings();
  const { data, reload } = useData<{ rows: Recurring[] }>("/expenses/recurring");
  const cats = useData<{ items: (Named & { id: string })[] }>("/lookups?type=expense_category");
  const items = useData<{ items: (Named & { id: string })[] }>("/lookups?type=expense_item");
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const [deleting, setDeleting] = useState<Recurring | null>(null);
  const name = (r: Recurring) => {
    const it = items.data?.items.find((x) => x.id === r.itemId);
    const c = cats.data?.items.find((x) => x.id === r.categoryId);
    return it ? pick(it) : c ? pick(c) : "—";
  };
  const run = async () => {
    try {
      const r = await post<{ created: number }>("/expenses/recurring/run");
      toast(r.created ? tr(`انعمل ${r.created} مصروف مستحق`, `${r.created} due expense(s) created`) : tr("ما في شي جديد لهالشهر", "Nothing new for this month"));
    } catch (e) {
      toast(err(e), "error");
    }
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="max-w-xl text-sm text-muted">
          {tr(
            "المصاريف اللي بتتكرر كل شهر (إيجار، رواتب، إنترنت). بيومها بتطلع «مستحقة» لحتى تدفعها.",
            "Expenses that come every month (rent, salaries, internet). On their day they appear as “due” until you pay them.",
          )}
        </p>
        <div className="ms-auto flex gap-2">
          {can("expenses", "create") && (
            <button className="btn" onClick={run}>
              {tr("أنشئ مصاريف هالشهر الآن", "Create this month's now")}
            </button>
          )}
          {can("expenses", "create") && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              {tr("+ مصروف شهري", "+ Monthly expense")}
            </button>
          )}
        </div>
      </div>
      {!data ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <Empty text={tr("ما في مصاريف شهرية", "No monthly expenses")} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th">{tr("البند", "What")}</th>
                <th className="th">{tr("كل شهر بتاريخ", "Day of month")}</th>
                <th className="th">{tr("المستفيد", "Paid to")}</th>
                <th className="th text-end">{tr("المبلغ", "Amount")}</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={r.active ? "" : "text-faint"}>
                  <td className="td font-semibold">
                    {name(r)} {!r.active && <span className="chip">{tr("موقوف", "paused")}</span>}
                    {r.note && <div className="text-xs font-normal text-faint">{r.note}</div>}
                  </td>
                  <td className="td num">{r.dayOfMonth}</td>
                  <td className="td">{r.beneficiary || "—"}</td>
                  <td className="td text-end num ltr">{money(r.amount, r.currency)}</td>
                  <td className="td whitespace-nowrap text-end">
                    {can("expenses", "edit") && (
                      <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(r)}>
                        {tr("تعديل", "Edit")}
                      </button>
                    )}
                    {can("expenses", "delete") && (
                      <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setDeleting(r)}>
                        {tr("حذف", "Delete")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <RecurringDialog
          rec={editing === "new" ? null : editing}
          defaultCurrency={s?.defaultCurrency ?? "USD"}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), void reload())}
        />
      )}
      {deleting && (
        <ConfirmDialog
          text={tr("حذف هذا المصروف الشهري؟", "Delete this monthly expense?")}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await del(`/expenses/recurring/${deleting.id}`);
              setDeleting(null);
              void reload();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </div>
  );
}

function RecurringDialog({ rec, defaultCurrency, onClose, onSaved }: { rec: Recurring | null; defaultCurrency: Currency; onClose: () => void; onSaved: () => void }) {
  const { tr, err, fieldErrors } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({
    categoryId: rec?.categoryId ?? "",
    itemId: rec?.itemId ?? "",
    amount: rec ? String(rec.amount) : "",
    currency: rec?.currency ?? defaultCurrency,
    dayOfMonth: String(rec?.dayOfMonth ?? 1),
    beneficiary: rec?.beneficiary ?? "",
    note: rec?.note ?? "",
    active: rec?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    setErrors({});
    const body = { ...f, categoryId: f.categoryId || null, itemId: f.itemId || null, amount: num(f.amount), dayOfMonth: Math.round(num(f.dayOfMonth)) };
    try {
      if (rec) await put(`/expenses/recurring/${rec.id}`, body);
      else await post("/expenses/recurring", body);
      toast(tr("تم الحفظ", "Saved"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    }
  };
  const day = num(f.dayOfMonth);
  return (
    <Modal
      title={rec ? tr("تعديل مصروف شهري", "Edit monthly expense") : tr("مصروف شهري جديد", "New monthly expense")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!(num(f.amount) > 0) || !(day >= 1 && day <= 28) || (!f.itemId && !f.categoryId)}>
            {tr("حفظ", "Save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={tr("البند", "What for")} htmlFor="rx-item">
          <LookupSelect id="rx-item" listType="expense_item" value={f.itemId} onChange={(v) => setF({ ...f, itemId: v })} />
        </Field>
        <Field label={tr("الفئة", "Category")} htmlFor="rx-cat">
          <LookupSelect id="rx-cat" listType="expense_category" value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={tr("المبلغ", "Amount")} htmlFor="rx-amt" error={errors.amount}>
            <TextInput id="rx-amt" dir="ltr" inputMode="decimal" className="num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label={tr("العملة", "Currency")} htmlFor="rx-cur">
            <Select id="rx-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
              <option value="USD">USD</option>
              <option value="SYP">SYP</option>
            </Select>
          </Field>
        </div>
        <Field label={tr("كل شهر بتاريخ (1–28)", "Every month on day (1–28)")} htmlFor="rx-day" error={errors.dayOfMonth}>
          <TextInput id="rx-day" type="number" min={1} max={28} dir="ltr" className="num" value={f.dayOfMonth} onChange={(e) => setF({ ...f, dayOfMonth: e.target.value })} />
        </Field>
        <Field label={tr("المستفيد", "Paid to")} htmlFor="rx-ben">
          <TextInput id="rx-ben" value={f.beneficiary} onChange={(e) => setF({ ...f, beneficiary: e.target.value })} />
        </Field>
        <Field label={tr("ملاحظة", "Note")} htmlFor="rx-note">
          <TextInput id="rx-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          {tr("فعّال", "Active")}
        </label>
      </div>
    </Modal>
  );
}

export function ExpensesPage() {
  const { tr, pick, err } = useI18n();
  const { can, simple } = useAuth();
  const toast = useToast();
  const [range, setRange] = useState(() => (simple ? { from: today(), to: today() } : { from: monthStartOf(today()), to: today() }));
  const [tab, setTab] = useState<"list" | "due" | "monthly">("list");
  const { data, reload } = useData<{ rows: Expense[] }>(tab === "due" ? "/expenses?status=due" : `/expenses?from=${range.from}&to=${range.to}`);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [paying, setPaying] = useState<Expense | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

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
          <div className="text-xs text-faint">
            {[e.item && e.category ? pick(e.category) : null, e.beneficiary ? `→ ${e.beneficiary}` : null, e.employeeName, e.note].filter(Boolean).join(" · ")}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: tr("الحالة", "Status"),
      render: (e) =>
        e.status === "due" ? (
          <span className="chip !bg-warn/15 !text-warn">{tr(`مستحق${e.dueDate ? ` ${e.dueDate}` : ""}`, `Due${e.dueDate ? ` ${e.dueDate}` : ""}`)}</span>
        ) : (
          <span className="text-sm">{e.box ? pick(e.box) : tr("مدفوع", "Paid")}</span>
        ),
    },
    { key: "by", header: tr("دفع / سجّل", "Paid / entered by"), render: (e) => <span className="text-muted">{[e.paidBy, e.userName].filter(Boolean).join(" · ") || "—"}</span> },
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
      render: (e) => (
        <span className="inline-flex gap-1 whitespace-nowrap">
          {e.photo && (
            <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setPhoto(e.id)}>
              {tr("الصورة", "Photo")}
            </button>
          )}
          {e.status === "due" && can("expenses", "create") && (
            <button className="btn btn-primary px-3 py-1 text-sm" onClick={() => setPaying(e)}>
              {tr("ادفع", "Pay")}
            </button>
          )}
          {can("expenses", "delete") && (
            <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setDeleting(e)}>
              {tr("حذف", "Delete")}
            </button>
          )}
        </span>
      ),
    },
  ];

  const extraDialogs = (
    <>
      {paying && (
        <PayDialog
          e={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            void reload();
          }}
        />
      )}
      {photo && <PhotoModal id={photo} onClose={() => setPhoto(null)} />}
    </>
  );
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
        <PageHeader
          title={tr("المصاريف", "Expenses")}
          subtitle={tr("سجّل أي مبلغ طلع من الصندوق: غاز، توصيل، تصليح…", "Record any money that left the box: gas, delivery, repairs…")}
        />
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
                <span className="num ltr font-semibold">
                  {money(e.amount, e.currency)}
                  {e.status === "due" && <span className="ms-2 chip !bg-warn/15 !text-warn">{tr("مستحق", "Due")}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        {deleteDialog}
        {extraDialogs}
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
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "list", label: tr("المصاريف", "Expenses") },
          { key: "due", label: tr("مستحقة (غير مدفوعة)", "Due (not paid)") },
          { key: "monthly", label: tr("الشهرية", "Monthly") },
        ]}
      />
      {tab === "monthly" ? (
        <MonthlyTab />
      ) : (
        <>
          {tab === "list" && (
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <Field label={tr("من", "From")} htmlFor="xr-from">
                <TextInput id="xr-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              </Field>
              <Field label={tr("إلى", "To")} htmlFor="xr-to">
                <TextInput id="xr-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              </Field>
            </div>
          )}
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
              <DataTable
                rows={data.rows}
                columns={columns}
                rowKey={(e) => e.id}
                searchText={(e) => `${e.item?.nameAr ?? ""} ${e.item?.nameEn ?? ""} ${e.category?.nameAr ?? ""} ${e.category?.nameEn ?? ""} ${e.beneficiary ?? ""} ${e.note}`}
              />
            </>
          )}
        </>
      )}
      {deleteDialog}
      {extraDialogs}
    </>
  );
}
