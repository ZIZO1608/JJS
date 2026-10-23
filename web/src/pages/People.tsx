import { useMemo, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { DataTable, type Column } from "../components/DataTable";
import { Stat, Tabs } from "../components/Tabs";
import { ConfirmDialog, Empty, Field, Modal, PageHeader, Select, Spinner, TextInput } from "../components/ui";
import { ApiError, del, post, put } from "../lib/api";
import { useAppSettings } from "../lib/appSettings";
import { useAuth } from "../lib/auth";
import { money, num, thisMonth, today, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import type { CashBox, ClientSummary, Employee } from "../lib/types";
import { useData } from "../lib/useData";

/* ---------------- employees ---------------- */

function EmployeeDialog({ emp, onClose, onSaved }: { emp: Employee | null; onClose: () => void; onSaved: () => void }) {
  const { tr, err, fieldErrors } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { s } = useAppSettings();
  const users = useData<{ users: { id: string; name: string; username: string }[] }>(can("users", "view") ? "/users" : null);
  const [f, setF] = useState({
    name: emp?.name ?? "",
    phone: emp?.phone ?? "",
    jobTitle: emp?.jobTitle ?? "",
    userId: emp?.userId ?? "",
    payModel: emp?.payModel ?? ("fixed" as Employee["payModel"]),
    baseSalary: String(emp?.baseSalary ?? ""),
    currency: emp?.currency ?? ((s?.defaultCurrency ?? "USD") as Currency),
    commissionPct: String(emp?.commissionPct ?? 0),
    commissionPerClientUsd: String(emp?.commissionPerClientUsd ?? 0),
    staffDiscountPct: String(emp?.staffDiscountPct ?? 30),
    isDeliveryRep: emp?.isDeliveryRep ?? false,
    active: emp?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const n0 = (v: string) => (Number.isNaN(num(v)) ? 0 : num(v));

  const save = async () => {
    setErrors({});
    const body = {
      ...f,
      userId: f.userId || null,
      baseSalary: n0(f.baseSalary),
      commissionPct: n0(f.commissionPct),
      commissionPerClientUsd: n0(f.commissionPerClientUsd),
      staffDiscountPct: n0(f.staffDiscountPct),
    };
    try {
      if (emp) await put(`/people/employees/${emp.id}`, body);
      else await post("/people/employees", body);
      toast(tr("تم الحفظ", "Saved"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    }
  };
  const showFixed = f.payModel !== "commission";
  const showComm = f.payModel !== "fixed";
  return (
    <Modal
      wide
      title={emp ? tr("تعديل الموظف", "Edit employee") : tr("موظف جديد", "New employee")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!f.name.trim()}>
            {tr("حفظ", "Save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("الاسم", "Name")} htmlFor="e-name" error={errors.name}>
          <TextInput id="e-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={tr("الهاتف", "Phone")} htmlFor="e-phone">
          <TextInput id="e-phone" dir="ltr" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={tr("الوظيفة", "Job title")} htmlFor="e-job">
          <TextInput id="e-job" value={f.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
        </Field>
        {can("users", "view") && (
          <Field label={tr("حساب الدخول (اختياري)", "Login account (optional)")} htmlFor="e-user">
            <Select id="e-user" value={f.userId} onChange={(e) => set("userId", e.target.value)}>
              <option value="">—</option>
              {users.data?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.username})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label={tr("طريقة الراتب", "How they are paid")} htmlFor="e-model">
            <div className="flex flex-wrap gap-2" id="e-model">
              {(
                [
                  ["fixed", tr("راتب ثابت", "Fixed salary")],
                  ["commission", tr("عمولة فقط", "Commission only")],
                  ["both", tr("ثابت + عمولة", "Fixed + commission")],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={f.payModel === k} className={`btn ${f.payModel === k ? "btn-primary" : ""}`} onClick={() => set("payModel", k)}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>
        {showFixed && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label={tr("الراتب الشهري", "Monthly salary")} htmlFor="e-base" error={errors.baseSalary}>
              <TextInput id="e-base" dir="ltr" inputMode="decimal" className="num" value={f.baseSalary} onChange={(e) => set("baseSalary", e.target.value)} />
            </Field>
            <Field label={tr("العملة", "Currency")} htmlFor="e-cur">
              <Select id="e-cur" value={f.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
                <option value="USD">USD</option>
                <option value="SYP">SYP</option>
              </Select>
            </Field>
          </div>
        )}
        {showComm && (
          <>
            <Field label={tr("عمولة ٪ من مبيعات التوصيل", "Commission % of delivered sales")} htmlFor="e-pct" error={errors.commissionPct}>
              <TextInput id="e-pct" dir="ltr" inputMode="decimal" className="num" value={f.commissionPct} onChange={(e) => set("commissionPct", e.target.value)} />
            </Field>
            <Field label={tr("$ عن كل زبون جديد (بعد التجربة)", "$ per new client won (after a trial)")} htmlFor="e-per" error={errors.commissionPerClientUsd}>
              <TextInput
                id="e-per"
                dir="ltr"
                inputMode="decimal"
                className="num"
                value={f.commissionPerClientUsd}
                onChange={(e) => set("commissionPerClientUsd", e.target.value)}
              />
            </Field>
          </>
        )}
        <Field label={tr("خصم الموظف ٪", "Staff discount %")} htmlFor="e-staff" hint={tr("على مشترياته من المحل", "On what they buy from the shop")}>
          <TextInput id="e-staff" dir="ltr" inputMode="decimal" className="num" value={f.staffDiscountPct} onChange={(e) => set("staffDiscountPct", e.target.value)} />
        </Field>
        <div className="grid content-end gap-2">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.isDeliveryRep} onChange={(e) => set("isDeliveryRep", e.target.checked)} />
            {tr("مندوب مبيعات وتوصيل (له صندوق نقد)", "Sales & delivery person (gets a cash box)")}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
            {tr("فعّال", "Active")}
          </label>
        </div>
      </div>
    </Modal>
  );
}

function Employees() {
  const { tr, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useData<{ rows: Employee[] }>("/people/employees");
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  if (!data) return <Spinner />;
  const model = (m: Employee["payModel"]) => ({ fixed: tr("ثابت", "Fixed"), commission: tr("عمولة", "Commission"), both: tr("ثابت + عمولة", "Fixed + commission") })[m];
  const columns: Column<Employee>[] = [
    {
      key: "name",
      header: tr("الاسم", "Name"),
      sortValue: (e) => e.name,
      render: (e) => (
        <div>
          <div className="font-semibold">
            {e.name} {e.isDeliveryRep && <span className="chip ms-1">{tr("مندوب توصيل", "Delivery rep")}</span>}{" "}
            {!e.active && <span className="chip ms-1">{tr("موقوف", "inactive")}</span>}
          </div>
          <div className="text-xs text-faint">{[e.jobTitle, e.phone, e.userName && `@${e.userName}`].filter(Boolean).join(" · ")}</div>
        </div>
      ),
    },
    { key: "model", header: tr("الراتب", "Pay"), render: (e) => model(e.payModel) },
    {
      key: "base",
      header: tr("الثابت", "Base"),
      align: "end",
      render: (e) => (e.payModel === "commission" ? "—" : <span className="num ltr">{money(e.baseSalary, e.currency)}</span>),
    },
    {
      key: "comm",
      header: tr("العمولة", "Commission"),
      render: (e) => (e.payModel === "fixed" ? "—" : <span className="num ltr text-sm">{`${e.commissionPct}% + ${money(e.commissionPerClientUsd)}/${tr("زبون", "client")}`}</span>),
    },
    { key: "disc", header: tr("خصم الموظف", "Staff discount"), align: "end", render: (e) => <span className="num">{e.staffDiscountPct}%</span> },
    {
      key: "act",
      header: "",
      align: "end",
      render: (e) => (
        <span className="whitespace-nowrap">
          {can("people", "edit") && (
            <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(e)}>
              {tr("تعديل", "Edit")}
            </button>
          )}
          {can("people", "delete") && (
            <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setDeleting(e)}>
              {tr("حذف", "Delete")}
            </button>
          )}
        </span>
      ),
    },
  ];
  const repCount = data.rows.filter((e) => e.isDeliveryRep && e.active).length;
  return (
    <>
      <p className="mb-3 max-w-2xl text-sm text-muted">
        {tr(
          `المندوبين الفعّالين: ${repCount}. لإضافة مندوب: «+ موظف» وعلّم «مندوب مبيعات وتوصيل» — بياخد صندوق نقد وبيظهر بخط التوزيع. لإيقافه: «تعديل» وشيل «فعّال».`,
          `Active delivery reps: ${repCount}. To add one: “+ Employee” and tick “Sales & delivery person” — they get a cash box and appear on the route sheet. To stop one: “Edit” and untick “Active”.`,
        )}
      </p>
      <DataTable
        rows={data.rows}
        columns={columns}
        rowKey={(e) => e.id}
        searchText={(e) => `${e.name} ${e.jobTitle} ${e.phone}`}
        toolbar={
          can("people", "create") && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              {tr("+ موظف", "+ Employee")}
            </button>
          )
        }
      />
      {editing && (
        <EmployeeDialog
          emp={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          text={tr(`حذف ${deleting.name}؟`, `Delete ${deleting.name}?`)}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await del(`/people/employees/${deleting.id}`);
              setDeleting(null);
              void reload();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </>
  );
}

/* ---------------- advances (سلف) ---------------- */

interface Advance {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  amount: number;
  currency: Currency;
  amountUsd: number;
  remainingUsd: number;
  note: string;
}

function AdvanceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { tr, pick, err, fieldErrors } = useI18n();
  const toast = useToast();
  const { s } = useAppSettings();
  const emps = useData<{ rows: Employee[] }>("/people/employees");
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  const active = (emps.data?.rows ?? []).filter((e) => e.active);
  const [f, setF] = useState({ employeeId: "", amount: "", currency: (s?.defaultCurrency ?? "USD") as Currency, boxId: "", note: "" });
  const employeeId = f.employeeId || active[0]?.id || "";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    setErrors({});
    try {
      await post("/people/advances", { ...f, employeeId, amount: num(f.amount), boxId: f.boxId || null });
      toast(tr("تم تسجيل السلفة", "Advance recorded"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    }
  };
  return (
    <Modal
      title={tr("سلفة جديدة", "New advance")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!employeeId || !(num(f.amount) > 0)}>
            {tr("حفظ", "Save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={tr("الموظف", "Employee")} htmlFor="ad-emp">
          <Select id="ad-emp" value={employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            {active.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={tr("المبلغ", "Amount")} htmlFor="ad-amt" error={errors.amount}>
            <TextInput id="ad-amt" dir="ltr" inputMode="decimal" className="num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label={tr("العملة", "Currency")} htmlFor="ad-cur">
            <Select id="ad-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
              <option value="USD">USD</option>
              <option value="SYP">SYP</option>
            </Select>
          </Field>
        </div>
        <Field label={tr("دُفعت من صندوق", "Paid from box")} htmlFor="ad-box" hint={tr("اتركه فاضي إذا ما طلعت من الصندوق", "Leave empty if it didn't come from a box")}>
          <Select id="ad-box" value={f.boxId} onChange={(e) => setF({ ...f, boxId: e.target.value })}>
            <option value="">—</option>
            {boxes.data?.rows
              .filter((b) => b.active && b.kind !== "rep")
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {pick(b)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={tr("ملاحظة", "Note")} htmlFor="ad-note">
          <TextInput id="ad-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <p className="text-sm text-muted">{tr("السلفة بتنخصم تلقائياً من الراتب لما تدفع الرواتب.", "The advance is deducted automatically when you pay salaries.")}</p>
      </div>
    </Modal>
  );
}

function Advances() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const [openOnly, setOpenOnly] = useState(false);
  const { data, reload } = useData<{ rows: Advance[] }>(`/people/advances${openOnly ? "?open=1" : ""}`);
  const [adding, setAdding] = useState(false);
  if (!data) return <Spinner />;
  const open = data.rows.reduce((s, a) => s + a.remainingUsd, 0);
  const columns: Column<Advance>[] = [
    { key: "date", header: tr("التاريخ", "Date"), sortValue: (a) => a.date, render: (a) => <span className="num ltr">{a.date}</span> },
    { key: "emp", header: tr("الموظف", "Employee"), sortValue: (a) => a.employeeName, render: (a) => a.employeeName },
    { key: "amt", header: tr("المبلغ", "Amount"), align: "end", render: (a) => <span className="num ltr">{money(a.amount, a.currency)}</span> },
    {
      key: "left",
      header: tr("الباقي", "Still to deduct"),
      align: "end",
      sortValue: (a) => a.remainingUsd,
      render: (a) => (a.remainingUsd > 0.001 ? <span className="num ltr font-semibold">{money(a.remainingUsd)}</span> : <span className="chip">{tr("مسددة", "settled")}</span>),
    },
    { key: "note", header: tr("ملاحظة", "Note"), render: (a) => <span className="text-muted">{a.note}</span> },
  ];
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("سلف لم تُخصم بعد", "Advances still open")} value={money(open)} />
      </div>
      <DataTable
        rows={data.rows}
        columns={columns}
        rowKey={(a) => a.id}
        searchText={(a) => `${a.employeeName} ${a.note}`}
        toolbar={
          <>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-ink" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
              {tr("غير المسددة فقط", "Open only")}
            </label>
            {can("people", "create") && (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                {tr("+ سلفة", "+ Advance")}
              </button>
            )}
          </>
        }
      />
      {adding && (
        <AdvanceDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void reload();
          }}
        />
      )}
    </>
  );
}

/* ---------------- payroll ---------------- */

interface PayRow {
  employeeId: string;
  name: string;
  baseUsd: number;
  commissionUsd: number;
  staffPurchasesUsd: number;
  advancesUsd: number;
  netUsd: number;
  deliveredSalesUsd?: number;
  deliveredOrders?: number;
  convertedClients?: number;
  openAdvancesUsd?: number;
  details?: { deliveredSalesUsd: number; deliveredOrders: number; convertedClients: number };
}
interface Payroll {
  month: string;
  status: "preview" | "paid";
  run?: { paidAt: string; boxId: string };
  rows: PayRow[];
}

function PayrollTab() {
  const { tr, pick, err, fmtDate } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const { data, reload } = useData<Payroll>(`/people/payroll/${month}`);
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  const [boxId, setBoxId] = useState("");
  const [confirm, setConfirm] = useState(false);
  const payBoxes = (boxes.data?.rows ?? []).filter((b) => b.active && b.kind !== "rep");
  const chosenBox = boxId || payBoxes[0]?.id || "";

  const totals = useMemo(() => {
    const r = data?.rows ?? [];
    const sum = (k: keyof PayRow) => r.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    return { base: sum("baseUsd"), comm: sum("commissionUsd"), staff: sum("staffPurchasesUsd"), adv: sum("advancesUsd"), net: sum("netUsd") };
  }, [data]);

  const pay = async () => {
    try {
      await post(`/people/payroll/${month}/pay`, { boxId: chosenBox });
      setConfirm(false);
      toast(tr("تم دفع الرواتب", "Salaries paid"));
      void reload();
    } catch (e) {
      toast(err(e), "error");
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={tr("الشهر", "Month")} htmlFor="pr-month">
          <TextInput id="pr-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </Field>
        {data?.status === "paid" ? (
          <span className="chip mb-2">
            ✓ {tr("مدفوعة", "Paid")} {data.run?.paidAt ? fmtDate(data.run.paidAt, true) : ""}
          </span>
        ) : (
          can("people", "edit") &&
          (data?.rows.length ?? 0) > 0 && (
            <>
              <Field label={tr("الدفع من صندوق", "Pay from box")} htmlFor="pr-box">
                <Select id="pr-box" value={chosenBox} onChange={(e) => setBoxId(e.target.value)}>
                  {payBoxes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {pick(b)}
                    </option>
                  ))}
                </Select>
              </Field>
              <button className="btn btn-primary" onClick={() => setConfirm(true)} disabled={!chosenBox}>
                {tr("ادفع الرواتب", "Pay salaries")}
              </button>
            </>
          )
        )}
      </div>
      {!data ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <Empty text={tr("ما في موظفين فعّالين", "No active employees")} />
      ) : (
        <>
          {data.status === "preview" && (
            <p className="text-sm text-muted">
              {tr("هذه معاينة محسوبة لحد اليوم. الأرقام بتتثبت لما تدفع.", "This is a preview calculated up to today. Numbers are fixed when you pay.")}
            </p>
          )}
          <div className="card overflow-x-auto p-0">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="th">{tr("الموظف", "Employee")}</th>
                  <th className="th text-end">{tr("الثابت", "Base")}</th>
                  <th className="th text-end">{tr("العمولة", "Commission")}</th>
                  <th className="th text-end">{tr("مشتريات الموظف", "Staff purchases")}</th>
                  <th className="th text-end">{tr("سلف", "Advances")}</th>
                  <th className="th text-end">{tr("الصافي", "Net pay")}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const det = r.details ?? { deliveredSalesUsd: r.deliveredSalesUsd ?? 0, deliveredOrders: r.deliveredOrders ?? 0, convertedClients: r.convertedClients ?? 0 };
                  return (
                    <tr key={r.employeeId}>
                      <td className="td font-semibold">{r.name}</td>
                      <td className="td text-end num ltr">{money(r.baseUsd)}</td>
                      <td className="td text-end">
                        <span className="num ltr">{money(r.commissionUsd)}</span>
                        {(det.deliveredOrders > 0 || det.convertedClients > 0) && (
                          <span className="block text-xs text-faint">
                            {tr(
                              `توصيل ${det.deliveredOrders} طلب (${money(det.deliveredSalesUsd)}) · ${det.convertedClients} زبون جديد`,
                              `${det.deliveredOrders} deliveries (${money(det.deliveredSalesUsd)}) · ${det.convertedClients} new client(s)`,
                            )}
                          </span>
                        )}
                      </td>
                      <td className="td text-end num ltr">{r.staffPurchasesUsd ? `−${money(r.staffPurchasesUsd)}` : "—"}</td>
                      <td className="td text-end num ltr">
                        {r.advancesUsd ? `−${money(r.advancesUsd)}` : "—"}
                        {r.openAdvancesUsd !== undefined && r.openAdvancesUsd > r.advancesUsd + 0.001 && (
                          <span className="block text-xs text-warn">
                            {tr(`باقي ${money(r.openAdvancesUsd - r.advancesUsd)} للشهر الجاي`, `${money(r.openAdvancesUsd - r.advancesUsd)} carries to next month`)}
                          </span>
                        )}
                      </td>
                      <td className="td text-end num ltr text-base font-bold">{money(r.netUsd)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-sunken font-semibold">
                  <td className="td">{tr("المجموع", "Total")}</td>
                  <td className="td text-end num ltr">{money(totals.base)}</td>
                  <td className="td text-end num ltr">{money(totals.comm)}</td>
                  <td className="td text-end num ltr">{money(totals.staff)}</td>
                  <td className="td text-end num ltr">{money(totals.adv)}</td>
                  <td className="td text-end num ltr">{money(totals.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      {confirm && (
        <Modal
          title={tr(`دفع رواتب ${month}؟`, `Pay salaries for ${month}?`)}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>
                {tr("رجوع", "Back")}
              </button>
              <button className="btn btn-primary" onClick={pay}>
                {tr("ادفع", "Pay")} <span className="num ltr">{money(totals.net)}</span>
              </button>
            </>
          }
        >
          <p className="text-muted">
            {tr(
              "بيطلع المبلغ من الصندوق، وبتنخصم السلف، وما بتقدر تدفع نفس الشهر مرتين.",
              "The money leaves the box, advances are settled, and the same month cannot be paid twice.",
            )}
          </p>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- sales calls ---------------- */

type CallResult = "no_answer" | "interested" | "not_interested" | "trial_given" | "converted" | "follow_up";
interface SalesCall {
  id: string;
  employeeId: string | null;
  clientId: string | null;
  prospectName: string;
  phone: string;
  date: string;
  result: CallResult;
  nextFollowUp: string | null;
  note: string;
  clientName: string | null;
  employeeName: string | null;
}
const RESULTS: CallResult[] = ["no_answer", "interested", "not_interested", "trial_given", "converted", "follow_up"];

function useResultLabel() {
  const { tr } = useI18n();
  return (r: CallResult) =>
    ({
      no_answer: tr("ما رد", "No answer"),
      interested: tr("مهتم", "Interested"),
      not_interested: tr("مو مهتم", "Not interested"),
      trial_given: tr("أخذ تجربة مجانية", "Free trial given"),
      converted: tr("صار زبون", "Became a client"),
      follow_up: tr("متابعة لاحقاً", "Follow up later"),
    })[r];
}

function CallDialog({ call, onClose, onSaved }: { call: SalesCall | null; onClose: () => void; onSaved: () => void }) {
  const { tr, err, fieldErrors } = useI18n();
  const toast = useToast();
  const label = useResultLabel();
  const emps = useData<{ rows: Employee[] }>("/people/employees");
  const clients = useData<{ rows: ClientSummary[] }>("/clients");
  const [f, setF] = useState({
    date: call?.date ?? today(),
    employeeId: call?.employeeId ?? "",
    clientId: call?.clientId ?? "",
    prospectName: call?.prospectName ?? "",
    phone: call?.phone ?? "",
    result: call?.result ?? ("interested" as CallResult),
    nextFollowUp: call?.nextFollowUp ?? "",
    note: call?.note ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    setErrors({});
    const body = { ...f, employeeId: f.employeeId || null, clientId: f.clientId || null, nextFollowUp: f.nextFollowUp || null };
    try {
      if (call) await put(`/clients/calls/${call.id}`, body);
      else await post("/clients/calls", body);
      toast(tr("تم الحفظ", "Saved"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    }
  };
  return (
    <Modal
      wide
      title={call ? tr("تعديل المكالمة", "Edit call") : tr("مكالمة بيع جديدة", "New sales call")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!f.clientId && !f.prospectName.trim()}>
            {tr("حفظ", "Save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("التاريخ", "Date")} htmlFor="sc-date" error={errors.date}>
          <TextInput id="sc-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label={tr("مين اتصل", "Called by")} htmlFor="sc-emp">
          <Select id="sc-emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            <option value="">—</option>
            {emps.data?.rows
              .filter((e) => e.active)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={tr("زبون موجود", "Existing client")} htmlFor="sc-client" hint={tr("أو اكتب اسم الزبون المحتمل تحت", "Or type a prospect's name below")}>
          <Select id="sc-client" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
            <option value="">—</option>
            {clients.data?.rows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("اسم الزبون المحتمل", "Prospect name")} htmlFor="sc-pros" error={errors.prospectName}>
          <TextInput id="sc-pros" disabled={!!f.clientId} value={f.prospectName} onChange={(e) => setF({ ...f, prospectName: e.target.value })} />
        </Field>
        <Field label={tr("الهاتف", "Phone")} htmlFor="sc-phone">
          <TextInput id="sc-phone" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label={tr("النتيجة", "Result")} htmlFor="sc-res">
          <Select id="sc-res" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as CallResult })}>
            {RESULTS.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("موعد المتابعة", "Next follow-up")} htmlFor="sc-next">
          <TextInput id="sc-next" type="date" value={f.nextFollowUp} onChange={(e) => setF({ ...f, nextFollowUp: e.target.value })} />
        </Field>
        <Field label={tr("ملاحظة", "Note")} htmlFor="sc-note">
          <TextInput id="sc-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function SalesCalls() {
  const { tr, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const label = useResultLabel();
  const { data, reload } = useData<{ rows: SalesCall[] }>("/clients/calls");
  const [result, setResult] = useState<CallResult | "" | "due">("");
  const [editing, setEditing] = useState<SalesCall | "new" | null>(null);
  const [deleting, setDeleting] = useState<SalesCall | null>(null);
  if (!data) return <Spinner />;
  const t = today();
  const isDue = (c: SalesCall) => !!c.nextFollowUp && c.nextFollowUp <= t && c.result !== "converted" && c.result !== "not_interested";
  const rows = data.rows.filter((c) => (result === "due" ? isDue(c) : result ? c.result === result : true));
  const trials = data.rows.filter((c) => c.result === "trial_given").length;
  const converted = data.rows.filter((c) => c.result === "converted").length;

  const columns: Column<SalesCall>[] = [
    { key: "date", header: tr("التاريخ", "Date"), sortValue: (c) => c.date, render: (c) => <span className="num ltr">{c.date}</span> },
    {
      key: "who",
      header: tr("الزبون", "Who"),
      sortValue: (c) => c.clientName ?? c.prospectName,
      render: (c) => (
        <div>
          <div className="font-semibold">
            {c.clientId ? (
              <Link to={`/clients/${c.clientId}`} className="underline-offset-2 hover:underline">
                {c.clientName}
              </Link>
            ) : (
              c.prospectName
            )}
          </div>
          <div className="text-xs text-faint">
            <span className="ltr">{c.phone}</span> {c.employeeName && `· ${c.employeeName}`}
          </div>
        </div>
      ),
    },
    { key: "res", header: tr("النتيجة", "Result"), sortValue: (c) => c.result, render: (c) => <span className="chip">{label(c.result)}</span> },
    {
      key: "next",
      header: tr("المتابعة", "Follow-up"),
      sortValue: (c) => c.nextFollowUp ?? "",
      render: (c) => (c.nextFollowUp ? <span className={`num ltr ${isDue(c) ? "font-semibold text-warn" : ""}`}>{c.nextFollowUp}</span> : <span className="text-faint">—</span>),
    },
    { key: "note", header: tr("ملاحظة", "Note"), render: (c) => <span className="text-muted">{c.note}</span> },
    {
      key: "act",
      header: "",
      align: "end",
      render: (c) => (
        <span className="whitespace-nowrap">
          {c.clientId && can("orders", "create") && c.result !== "converted" && (
            <Link className="btn btn-ghost px-2 py-1 text-sm" to={`/orders/new?client=${c.clientId}&type=trial`}>
              {tr("أعطِ تجربة مجانية", "Give free trial")}
            </Link>
          )}
          {can("clients", "edit") && (
            <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(c)}>
              {tr("تعديل", "Edit")}
            </button>
          )}
          {can("clients", "delete") && (
            <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setDeleting(c)}>
              {tr("حذف", "Delete")}
            </button>
          )}
        </span>
      ),
    },
  ];
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("مكالمات", "Calls")} value={String(data.rows.length)} />
        <Stat label={tr("متابعات مستحقة", "Follow-ups due")} value={String(data.rows.filter(isDue).length)} tone={data.rows.some(isDue) ? "warn" : undefined} />
        <Stat label={tr("تجارب مجانية", "Free trials given")} value={String(trials)} />
        <Stat label={tr("صاروا زبائن", "Became clients")} value={String(converted)} />
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(c) => c.id}
        searchText={(c) => `${c.clientName ?? ""} ${c.prospectName} ${c.phone} ${c.note}`}
        toolbar={
          <>
            <Select className="input w-auto" value={result} onChange={(e) => setResult(e.target.value as CallResult | "" | "due")} aria-label={tr("فلتر", "Filter")}>
              <option value="">{tr("كل النتائج", "All results")}</option>
              <option value="due">{tr("متابعات مستحقة", "Follow-ups due")}</option>
              {RESULTS.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </Select>
            {can("clients", "create") && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                {tr("+ مكالمة", "+ Call")}
              </button>
            )}
          </>
        }
      />
      {editing && (
        <CallDialog
          call={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          text={tr("حذف هذه المكالمة؟", "Delete this call?")}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await del(`/clients/calls/${deleting.id}`);
              setDeleting(null);
              void reload();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </>
  );
}

export function PeoplePage() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const tabs = [
    { key: "employees", label: tr("الموظفين", "Employees") },
    { key: "advances", label: tr("السلف", "Advances") },
    { key: "payroll", label: tr("الرواتب", "Payroll") },
    ...(can("clients", "view") ? [{ key: "calls", label: tr("مكالمات البيع", "Sales calls") }] : []),
  ];
  return (
    <>
      <PageHeader
        title={tr("الموظفين والرواتب", "People & pay")}
        subtitle={tr("الرواتب الثابتة والعمولات والسلف ومكالمات البيع والتجارب المجانية.", "Salaries, commissions, advances, sales calls and free trials.")}
      />
      <Tabs tabs={tabs} base="/people" />
      <Routes>
        <Route index element={<Navigate to="employees" replace />} />
        <Route path="employees" element={<Employees />} />
        <Route path="advances" element={<Advances />} />
        <Route path="payroll" element={<PayrollTab />} />
        <Route path="calls" element={<SalesCalls />} />
        <Route path="*" element={<Navigate to="employees" replace />} />
      </Routes>
    </>
  );
}
