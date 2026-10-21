import { useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { Tabs } from "../components/Tabs";
import { Empty, Field, Modal, PageHeader, Select, Spinner, TextInput } from "../components/ui";
import { get, post, put } from "../lib/api";
import { useAppSettings } from "../lib/appSettings";
import { useAuth } from "../lib/auth";
import { money, num, pct, qty as fq, today, usd, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { useData } from "../lib/useData";
import type { CashBox, Location, StockItem, Warehouse } from "../lib/types";
import { ActionDialog, Check, CurrencySelect, DeleteConfirm, NumInput, RowActions, unitOf, useSaver } from "./kit";

type Item = StockItem & { packUnit?: string; packSize?: number; supplierId?: string | null };

interface Supplier {
  id: string;
  name: string;
  phone: string;
  note: string;
  active: boolean;
  openingBalance: number;
  openingCurrency: Currency;
  paymentTermsDays: number;
  dueUsd: number;
  overdueUsd: number;
  openInvoices: number;
}
interface PurchaseRow {
  id: string;
  number: number;
  date: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierRef: string;
  currency: Currency;
  total: number;
  paid: number;
  due: number;
  dueDate: string | null;
  late: boolean;
  photo: string;
  discount: number;
  transport: number;
  note: string;
}
interface PurchaseDetail extends PurchaseRow {
  lines: { id: string; itemId: string; nameAr: string; nameEn: string; unitCode: string; qty: number; unitPrice: number; expiresAt: string | null; location: { nameAr: string; nameEn: string } }[];
}

/** Shrink a photo of an invoice to a JPEG data URL (≤1600 px, ≲1 MB). */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = url;
    });
    let max = 1600;
    for (let q = 0.8; ; q -= 0.15) {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const d = c.toDataURL("image/jpeg", Math.max(0.4, q));
      if (d.length < 1_300_000 || q < 0.45) return d;
      max = Math.round(max * 0.8);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PhotoPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { tr } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      <button type="button" className="btn" onClick={() => ref.current?.click()}>
        {value ? tr("تغيير الصورة", "Change photo") : tr("+ صورة الفاتورة", "+ Invoice photo")}
      </button>
      {value && (
        <>
          <img src={value} alt="" className="h-12 w-12 rounded object-cover" />
          <button type="button" className="text-sm text-bad" onClick={() => onChange("")}>
            {tr("إزالة", "Remove")}
          </button>
        </>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onChange(await shrink(f));
        }}
      />
    </div>
  );
}

const usePlaces = () => {
  const locs = useData<{ rows: Location[] }>("/stock/locations");
  const whs = useData<{ rows: Warehouse[] }>("/stock/warehouses");
  return (locs.data?.rows ?? [])
    .filter((l) => l.active)
    .map((l) => ({ ...l, wh: whs.data?.rows.find((w) => w.id === l.warehouseId) }))
    .filter((l) => l.wh);
};

/* ---------- list ---------- */
function PayDialog({ p, onClose, onDone }: { p: PurchaseRow; onClose: () => void; onDone: () => void }) {
  const { tr, pick, lang } = useI18n();
  const { busy, run } = useSaver();
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  const [f, setF] = useState({ amount: String(p.due), boxId: "" });
  const save = async () => {
    if (await run(() => post(`/purchases/${p.id}/pay`, { amount: num(f.amount), boxId: f.boxId }), tr("انسجّلت الدفعة.", "Payment recorded."))) onDone();
  };
  return (
    <ActionDialog title={tr(`دفع فاتورة #${p.number}`, `Pay purchase #${p.number}`)} onClose={onClose} onSave={save} busy={busy} disabled={!f.boxId || !(num(f.amount) > 0) || num(f.amount) > p.due + 0.001}>
      <p className="text-sm text-muted">
        {tr("الباقي:", "Remaining:")} <b className="num ltr">{money(p.due, p.currency, lang)}</b>
      </p>
      <Field label={`${tr("المبلغ", "Amount")} (${p.currency})`} htmlFor="pp-a">
        <NumInput id="pp-a" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
      </Field>
      <Field label={tr("من صندوق", "From box")} htmlFor="pp-b">
        <Select id="pp-b" value={f.boxId} onChange={(e) => setF({ ...f, boxId: e.target.value })}>
          <option value="">—</option>
          {boxes.data?.rows
            .filter((b) => b.active)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {pick(b)}
              </option>
            ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

function DetailDialog({ id, onClose, onPay }: { id: string; onClose: () => void; onPay: (p: PurchaseRow) => void }) {
  const { tr, pick, lang, fmtDate } = useI18n();
  const { can } = useAuth();
  const d = useData<{ purchase: PurchaseDetail }>(`/purchases/${id}`);
  const [photo, setPhoto] = useState<string | null>(null);
  const p = d.data?.purchase;
  return (
    <Modal
      wide
      title={p ? tr(`فاتورة شراء #${p.number}`, `Purchase #${p.number}`) : "…"}
      onClose={onClose}
      footer={
        <>
          {p && p.due > 0.001 && can("purchasing", "edit") && (
            <button className="btn btn-primary" onClick={() => onPay(p)}>
              {tr("دفع الباقي", "Pay the rest")}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {tr("إغلاق", "Close")}
          </button>
        </>
      }
    >
      {!p ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-muted">{tr("المورّد", "Supplier")}</span>
            <span>{p.supplierName ?? "—"}</span>
            <span className="text-muted">{tr("رقم فاتورة المورّد", "Supplier invoice no.")}</span>
            <span className="ltr text-start">{p.supplierRef || "—"}</span>
            <span className="text-muted">{tr("التاريخ", "Date")}</span>
            <span>{fmtDate(p.date)}</span>
            <span className="text-muted">{tr("الاستحقاق", "Due date")}</span>
            <span className={p.late ? "font-semibold text-bad" : ""}>{p.dueDate ? fmtDate(p.dueDate) : "—"}</span>
          </div>
          <table className="w-full">
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td">{pick(l)}</td>
                  <td className="td num ltr">
                    {fq(l.qty)} {unitOf(l.unitCode, lang)}
                  </td>
                  <td className="td num ltr">× {money(l.unitPrice, p.currency, lang)}</td>
                  <td className="td text-muted">{pick(l.location)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid justify-end gap-1 text-end">
            {p.discount > 0 && (
              <div>
                {tr("خصم", "Discount")} <span className="num ltr">−{money(p.discount, p.currency, lang)}</span>
              </div>
            )}
            {p.transport > 0 && (
              <div>
                {tr("نقل", "Transport")} <span className="num ltr">+{money(p.transport, p.currency, lang)}</span>
              </div>
            )}
            <div className="text-lg font-bold">
              {tr("الإجمالي", "Total")} <span className="num ltr">{money(p.total, p.currency, lang)}</span>
            </div>
            <div>
              {tr("المدفوع", "Paid")} <span className="num ltr">{money(p.paid, p.currency, lang)}</span> · {tr("الباقي", "Remaining")}{" "}
              <span className={`num ltr font-semibold ${p.due > 0.001 ? "text-bad" : ""}`}>{money(p.due, p.currency, lang)}</span>
            </div>
          </div>
          {p.note && <p className="text-muted">{p.note}</p>}
          {p.photo &&
            (photo ? (
              <img src={photo} alt={tr("صورة الفاتورة", "Invoice photo")} className="max-h-[60vh] w-full rounded-lg object-contain" />
            ) : (
              <button className="btn w-fit" onClick={() => get<{ photo: string }>(`/purchases/${p.id}/photo`).then((r) => setPhoto(r.photo))}>
                {tr("شوف صورة الفاتورة", "Show invoice photo")}
              </button>
            ))}
        </div>
      )}
    </Modal>
  );
}

function ListTab() {
  const { tr, fmtDate, lang } = useI18n();
  const nav = useNavigate();
  const { can } = useAuth();
  const [from, setFrom] = useState(`${today().slice(0, 8)}01`);
  const [to, setTo] = useState(today());
  const list = useData<{ rows: PurchaseRow[] }>(`/purchases?from=${from}&to=${to}`);
  const [open, setOpen] = useState<string | null>(null);
  const [pay, setPay] = useState<PurchaseRow | null>(null);
  if (!list.data) return <Spinner />;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label={tr("من", "From")} htmlFor="pl-f">
          <TextInput id="pl-f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={tr("إلى", "To")} htmlFor="pl-t">
          <TextInput id="pl-t" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {can("purchasing", "create") && (
          <button className="btn btn-primary ms-auto" onClick={() => nav("/purchasing/new")}>
            {tr("+ فاتورة شراء", "+ Purchase")}
          </button>
        )}
      </div>
      <DataTable
        rows={list.data.rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpen(r.id)}
        searchText={(r) => `${r.number} ${r.supplierName ?? ""} ${r.supplierRef}`}
        columns={[
          { key: "n", header: "#", render: (r) => <span className="num">{r.number}</span>, sortValue: (r) => r.number },
          { key: "d", header: tr("التاريخ", "Date"), render: (r) => fmtDate(r.date), sortValue: (r) => r.date },
          {
            key: "s",
            header: tr("المورّد", "Supplier"),
            render: (r) => (
              <div>
                <div className="font-semibold">{r.supplierName ?? "—"}</div>
                {r.supplierRef && <div className="text-xs text-faint ltr text-start">{r.supplierRef}</div>}
              </div>
            ),
          },
          { key: "t", header: tr("الإجمالي", "Total"), align: "end", render: (r) => <span className="num ltr">{money(r.total, r.currency, lang)}</span>, sortValue: (r) => r.total },
          {
            key: "due",
            header: tr("الباقي", "Remaining"),
            align: "end",
            render: (r) =>
              r.due > 0.001 ? (
                <span className={`num ltr ${r.late ? "font-semibold text-bad" : ""}`}>
                  {money(r.due, r.currency, lang)}
                  {r.dueDate && <span className="block text-xs font-normal text-faint">{r.late ? tr("متأخر", "late") : fmtDate(r.dueDate)}</span>}
                </span>
              ) : (
                <span className="text-faint">{tr("مدفوعة", "Paid")}</span>
              ),
            sortValue: (r) => r.due,
          },
          { key: "ph", header: "", render: (r) => (r.photo ? <span className="chip">{tr("صورة", "Photo")}</span> : null) },
        ]}
      />
      {open && <DetailDialog id={open} onClose={() => setOpen(null)} onPay={(p) => (setOpen(null), setPay(p))} />}
      {pay && <PayDialog p={pay} onClose={() => setPay(null)} onDone={() => (setPay(null), void list.reload())} />}
    </>
  );
}

/* ---------- new purchase ---------- */
interface Line {
  itemId: string;
  qty: string;
  inPacks: boolean;
  unitPrice: string;
  locationId: string;
  expires: string;
}
const emptyLine = (): Line => ({ itemId: "", qty: "", inPacks: false, unitPrice: "", locationId: "", expires: "" });

function NewTab() {
  const { tr, pick, lang, err } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { s } = useAppSettings();
  const items = useData<{ rows: Item[] }>("/stock/items");
  const suppliers = useData<{ rows: Supplier[] }>("/purchases/suppliers");
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  const places = usePlaces();
  const [f, setF] = useState({ supplierId: "", supplierRef: "", currency: (s?.defaultCurrency ?? "SYP") as Currency, discount: "", transport: "", dueDate: "", paid: "", boxId: "", note: "", photo: "" });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const itemList = (items.data?.rows ?? []).filter((i) => i.kind !== "product" && i.active);
  const byId = new Map(itemList.map((i) => [i.id, i]));
  const sub = lines.reduce((t, l) => t + (num(l.qty) || 0) * (num(l.unitPrice) || 0), 0);
  const total = Math.max(0, sub - (num(f.discount) || 0) + (num(f.transport) || 0));
  const valid = lines.filter((l) => l.itemId && num(l.qty) > 0 && l.unitPrice !== "" && l.locationId);
  const setLine = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const supplier = suppliers.data?.rows.find((x) => x.id === f.supplierId);
  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ purchase: { number: number } }>("/purchases", {
        supplierId: f.supplierId || null,
        supplierRef: f.supplierRef.trim(),
        currency: f.currency,
        discount: num(f.discount) || 0,
        transport: num(f.transport) || 0,
        dueDate: f.dueDate || null,
        paid: num(f.paid) || 0,
        boxId: num(f.paid) > 0 ? f.boxId : null,
        note: f.note,
        photo: f.photo,
        lines: valid.map((l) => ({ itemId: l.itemId, qty: num(l.qty), inPacks: l.inPacks, unitPrice: num(l.unitPrice), locationId: l.locationId, expiresAt: l.expires ? new Date(`${l.expires}T23:59:00`).toISOString() : null })),
      });
      toast(tr(`انحفظت فاتورة الشراء #${r.purchase.number}`, `Purchase #${r.purchase.number} saved`));
      nav("/purchasing/list");
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };
  if (!items.data || !suppliers.data) return <Spinner />;
  return (
    <div className="grid max-w-5xl gap-4">
      <section className="card grid gap-3 sm:grid-cols-3">
        <Field label={tr("المورّد", "Supplier")} htmlFor="np-s" hint={supplier?.paymentTermsDays ? tr(`مهلة الدفع ${supplier.paymentTermsDays} يوم`, `${supplier.paymentTermsDays} days to pay`) : undefined}>
          <Select id="np-s" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
            <option value="">—</option>
            {suppliers.data.rows
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={tr("رقم فاتورة المورّد", "Supplier invoice no.")} htmlFor="np-r">
          <TextInput id="np-r" dir="ltr" value={f.supplierRef} onChange={(e) => setF({ ...f, supplierRef: e.target.value })} />
        </Field>
        <Field label={tr("العملة", "Currency")} htmlFor="np-c">
          <CurrencySelect id="np-c" value={f.currency} onChange={(c) => setF({ ...f, currency: c })} />
        </Field>
      </section>

      <section className="card grid gap-3">
        <h2 className="font-bold">{tr("المواد", "Items")}</h2>
        {lines.map((l, i) => {
          const it = byId.get(l.itemId);
          const pack = it?.packSize && it.packSize > 0 ? it : null;
          return (
            <div key={i} className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[2fr_1fr_1fr_1.4fr_1fr_auto] md:items-end">
              <Field label={tr("المادة", "Item")} htmlFor={`np-i${i}`}>
                <Select id={`np-i${i}`} value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value, inPacks: false })}>
                  <option value="">—</option>
                  {itemList.map((x) => (
                    <option key={x.id} value={x.id}>
                      {pick(x)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("الكمية", "Qty")} htmlFor={`np-q${i}`} hint={pack ? undefined : it ? unitOf(it.unitCode, lang) : undefined}>
                <NumInput id={`np-q${i}`} value={l.qty} onChange={(v) => setLine(i, { qty: v })} />
              </Field>
              <Field label={l.inPacks && pack ? tr(`سعر ${pack.packUnit || "العبوة"}`, `Price per ${pack.packUnit || "pack"}`) : tr("سعر الوحدة", "Unit price")} htmlFor={`np-p${i}`}>
                <NumInput id={`np-p${i}`} value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} />
              </Field>
              <Field label={tr("المكان", "Place")} htmlFor={`np-l${i}`}>
                <Select id={`np-l${i}`} value={l.locationId} onChange={(e) => setLine(i, { locationId: e.target.value })}>
                  <option value="">—</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {pick(p.wh!)} · {pick(p)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("ينتهي (اختياري)", "Expires (optional)")} htmlFor={`np-e${i}`}>
                <TextInput id={`np-e${i}`} type="date" value={l.expires} onChange={(e) => setLine(i, { expires: e.target.value })} />
              </Field>
              <button className="btn btn-ghost btn-danger px-2 py-2" aria-label={tr("حذف السطر", "Remove line")} onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [emptyLine()])}>
                ✕
              </button>
              {pack && (
                <div className="md:col-span-6">
                  <Check checked={l.inPacks} onChange={(v) => setLine(i, { inPacks: v })}>
                    {tr(`بالـ${pack.packUnit || "عبوة"} (1 = ${pack.packSize} ${unitOf(pack.unitCode, lang)})`, `In ${pack.packUnit || "packs"} (1 = ${pack.packSize} ${unitOf(pack.unitCode, lang)})`)}
                    {l.inPacks && num(l.qty) > 0 && <span className="text-faint"> → {fq(num(l.qty) * (pack.packSize ?? 1))} {unitOf(pack.unitCode, lang)}</span>}
                  </Check>
                </div>
              )}
            </div>
          );
        })}
        <button className="btn btn-ghost w-fit" onClick={() => setLines([...lines, emptyLine()])}>
          {tr("+ سطر", "+ Line")}
        </button>
      </section>

      <section className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={tr("خصم على الفاتورة", "Invoice discount")} htmlFor="np-d">
          <NumInput id="np-d" value={f.discount} onChange={(v) => setF({ ...f, discount: v })} placeholder="0" />
        </Field>
        <Field label={tr("مصاريف النقل", "Transport cost")} htmlFor="np-t" hint={tr("بتنضاف على تكلفة المواد", "Added to the items' cost")}>
          <NumInput id="np-t" value={f.transport} onChange={(v) => setF({ ...f, transport: v })} placeholder="0" />
        </Field>
        <Field label={tr("تاريخ الاستحقاق", "Due date")} htmlFor="np-dd" hint={tr("فاضي = حسب مهلة المورّد", "Empty = supplier's terms")}>
          <TextInput id="np-dd" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </Field>
        <div className="rounded-xl bg-sunken p-3">
          <div className="text-sm text-muted">{tr("الإجمالي", "Total")}</div>
          <div className="text-2xl font-bold num ltr text-start">{money(total, f.currency, lang)}</div>
        </div>
        <Field label={tr("المدفوع الآن", "Paid now")} htmlFor="np-pd">
          <NumInput id="np-pd" value={f.paid} onChange={(v) => setF({ ...f, paid: v })} placeholder="0" />
        </Field>
        {num(f.paid) > 0 && (
          <Field label={tr("من صندوق", "From box")} htmlFor="np-b">
            <Select id="np-b" value={f.boxId} onChange={(e) => setF({ ...f, boxId: e.target.value })}>
              <option value="">—</option>
              {boxes.data?.rows
                .filter((b) => b.active)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {pick(b)}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label={tr("ملاحظة", "Note")} htmlFor="np-n">
            <TextInput id="np-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <PhotoPick value={f.photo} onChange={(v) => setF({ ...f, photo: v })} />
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary px-6 py-3 text-lg" disabled={busy || !valid.length || num(f.paid) > total + 0.001 || (num(f.paid) > 0 && !f.boxId)} onClick={save}>
          {tr("حفظ فاتورة الشراء", "Save purchase")}
        </button>
        {num(f.paid) < total && valid.length > 0 && <span className="text-sm text-muted">{tr(`الباقي ${money(total - (num(f.paid) || 0), f.currency, lang)} بيصير دين للمورّد`, `The remaining ${money(total - (num(f.paid) || 0), f.currency, lang)} is owed to the supplier`)}</span>}
      </div>
    </div>
  );
}

/* ---------- suppliers ---------- */
function SupplierDialog({ sup, onClose, onSaved }: { sup: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useI18n();
  const { errors, busy, run } = useSaver();
  const [f, setF] = useState({ name: sup?.name ?? "", phone: sup?.phone ?? "", note: sup?.note ?? "", active: sup?.active ?? true, openingBalance: String(sup?.openingBalance ?? 0), openingCurrency: sup?.openingCurrency ?? ("SYP" as Currency), paymentTermsDays: String(sup?.paymentTermsDays ?? 0) });
  const save = async () => {
    const body = { name: f.name, phone: f.phone, note: f.note, active: f.active, openingBalance: num(f.openingBalance) || 0, openingCurrency: f.openingCurrency, paymentTermsDays: Math.round(num(f.paymentTermsDays) || 0) };
    if (await run(() => (sup ? put(`/purchases/suppliers/${sup.id}`, body) : post("/purchases/suppliers", body)))) onSaved();
  };
  return (
    <ActionDialog title={sup ? tr("تعديل مورّد", "Edit supplier") : tr("مورّد جديد", "New supplier")} onClose={onClose} onSave={save} busy={busy} disabled={!f.name.trim()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("الاسم", "Name")} htmlFor="su-n" error={errors.name}>
          <TextInput id="su-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={tr("الهاتف", "Phone")} htmlFor="su-p">
          <TextInput id="su-p" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label={tr("علينا إله من قبل", "We already owed")} htmlFor="su-o" hint={tr("رصيد افتتاحي", "Opening balance")}>
          <NumInput id="su-o" value={f.openingBalance} onChange={(v) => setF({ ...f, openingBalance: v })} />
        </Field>
        <Field label={tr("العملة", "Currency")} htmlFor="su-c">
          <CurrencySelect id="su-c" value={f.openingCurrency} onChange={(c) => setF({ ...f, openingCurrency: c })} />
        </Field>
        <Field label={tr("مهلة الدفع (أيام)", "Days to pay")} htmlFor="su-t" hint={tr("0 = نقداً", "0 = cash")}>
          <NumInput id="su-t" step="1" value={f.paymentTermsDays} onChange={(v) => setF({ ...f, paymentTermsDays: v })} />
        </Field>
        <Field label={tr("ملاحظة", "Note")} htmlFor="su-no">
          <TextInput id="su-no" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
      <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
        {tr("فعّال", "Active")}
      </Check>
    </ActionDialog>
  );
}

function PaySupplierDialog({ sup, onClose, onDone }: { sup: Supplier; onClose: () => void; onDone: () => void }) {
  const { tr, pick } = useI18n();
  const { busy, run } = useSaver();
  const { s } = useAppSettings();
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  const [f, setF] = useState({ amount: "", currency: (s?.defaultCurrency ?? "SYP") as Currency, boxId: "", note: "" });
  const save = async () => {
    if (await run(() => post(`/purchases/suppliers/${sup.id}/pay`, { amount: num(f.amount), currency: f.currency, boxId: f.boxId, note: f.note || undefined }), tr("انسجّلت الدفعة.", "Payment recorded."))) onDone();
  };
  return (
    <ActionDialog title={tr(`دفع لـ ${sup.name}`, `Pay ${sup.name}`)} onClose={onClose} onSave={save} busy={busy} disabled={!f.boxId || !(num(f.amount) > 0)}>
      <p className="text-sm text-muted">
        {tr("علينا:", "We owe:")} <b className="num ltr">{usd(sup.dueUsd)}</b> · {tr("بتنسدّ أقدم فاتورة أولاً.", "The oldest invoice is paid first.")}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("المبلغ", "Amount")} htmlFor="ps-a">
          <NumInput id="ps-a" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label={tr("العملة", "Currency")} htmlFor="ps-c">
          <CurrencySelect id="ps-c" value={f.currency} onChange={(c) => setF({ ...f, currency: c })} />
        </Field>
      </div>
      <Field label={tr("من صندوق", "From box")} htmlFor="ps-b">
        <Select id="ps-b" value={f.boxId} onChange={(e) => setF({ ...f, boxId: e.target.value })}>
          <option value="">—</option>
          {boxes.data?.rows
            .filter((b) => b.active)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {pick(b)}
              </option>
            ))}
        </Select>
      </Field>
      <Field label={tr("ملاحظة", "Note")} htmlFor="ps-n">
        <TextInput id="ps-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </ActionDialog>
  );
}

interface Statement {
  openingUsd: number;
  closingUsd: number;
  lines: { date: string; kind: "purchase" | "payment"; ref: string; owedUsd: number; paidUsd: number; amount: number; currency: Currency; balanceUsd: number }[];
}
function StatementDialog({ sup, onClose }: { sup: Supplier; onClose: () => void }) {
  const { tr, fmtDate, lang } = useI18n();
  const d = useData<Statement>(`/purchases/suppliers/${sup.id}/statement`);
  return (
    <Modal wide title={tr(`كشف حساب ${sup.name}`, `Statement · ${sup.name}`)} onClose={onClose} footer={<button className="btn" onClick={onClose}>{tr("إغلاق", "Close")}</button>}>
      {!d.data ? (
        <Spinner />
      ) : (
        <div className="max-h-[60vh] overflow-auto text-sm">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">{tr("التاريخ", "Date")}</th>
                <th className="th">{tr("البيان", "Entry")}</th>
                <th className="th text-end">{tr("المبلغ", "Amount")}</th>
                <th className="th text-end">{tr("علينا", "We owe")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="td" colSpan={3}>
                  {tr("رصيد افتتاحي", "Opening balance")}
                </td>
                <td className="td text-end num ltr">{usd(d.data.openingUsd)}</td>
              </tr>
              {d.data.lines.map((l, i) => (
                <tr key={i}>
                  <td className="td whitespace-nowrap">{fmtDate(l.date)}</td>
                  <td className="td">
                    {l.kind === "purchase" ? tr("فاتورة", "Purchase") : tr("دفعة", "Payment")} {l.ref}
                  </td>
                  <td className={`td text-end num ltr ${l.kind === "payment" ? "text-good" : ""}`}>{money(l.amount, l.currency, lang)}</td>
                  <td className="td text-end num ltr font-semibold">{usd(l.balanceUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.data.lines.length === 0 && <p className="mt-3 text-faint">{tr("ما في حركات.", "No entries.")}</p>}
        </div>
      )}
    </Modal>
  );
}

function SuppliersTab() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const list = useData<{ rows: Supplier[] }>("/purchases/suppliers");
  const [dlg, setDlg] = useState<Supplier | "new" | null>(null);
  const [pay, setPay] = useState<Supplier | null>(null);
  const [st, setSt] = useState<Supplier | null>(null);
  const [del, setDel] = useState<Supplier | null>(null);
  if (!list.data) return <Spinner />;
  const reload = () => void list.reload();
  return (
    <>
      <DataTable
        rows={list.data.rows}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.name} ${r.phone}`}
        toolbar={
          can("purchasing", "create") && (
            <button className="btn btn-primary" onClick={() => setDlg("new")}>
              {tr("+ مورّد", "+ Supplier")}
            </button>
          )
        }
        columns={[
          {
            key: "n",
            header: tr("المورّد", "Supplier"),
            render: (r) => (
              <div className={r.active ? "" : "opacity-60"}>
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-faint ltr text-start">{r.phone}</div>
              </div>
            ),
            sortValue: (r) => r.name,
          },
          { key: "t", header: tr("مهلة الدفع", "Terms"), render: (r) => (r.paymentTermsDays ? tr(`${r.paymentTermsDays} يوم`, `${r.paymentTermsDays} days`) : tr("نقداً", "Cash")) },
          {
            key: "d",
            header: tr("علينا", "We owe"),
            align: "end",
            render: (r) => (r.dueUsd > 0.009 ? <span className={`num ltr ${r.overdueUsd > 0.009 ? "font-semibold text-bad" : ""}`}>{usd(r.dueUsd)}</span> : <span className="text-faint">—</span>),
            sortValue: (r) => r.dueUsd,
          },
          {
            key: "a",
            header: "",
            render: (r) => (
              <RowActions
                canEdit={can("purchasing", "edit")}
                canDelete={can("purchasing", "delete")}
                onEdit={() => setDlg(r)}
                onDelete={() => setDel(r)}
                extra={
                  <>
                    <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setSt(r)}>
                      {tr("كشف حساب", "Statement")}
                    </button>
                    {can("purchasing", "edit") && r.dueUsd > 0.009 && (
                      <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setPay(r)}>
                        {tr("دفع", "Pay")}
                      </button>
                    )}
                  </>
                }
              />
            ),
          },
        ]}
      />
      {dlg && <SupplierDialog sup={dlg === "new" ? null : dlg} onClose={() => setDlg(null)} onSaved={() => (setDlg(null), reload())} />}
      {pay && <PaySupplierDialog sup={pay} onClose={() => setPay(null)} onDone={() => (setPay(null), reload())} />}
      {st && <StatementDialog sup={st} onClose={() => setSt(null)} />}
      {del && <DeleteConfirm name={del.name} path={`/purchases/suppliers/${del.id}`} onClose={() => setDel(null)} onDone={reload} />}
    </>
  );
}

/* ---------- debts ---------- */
interface Debt {
  id: string;
  name: string;
  phone: string;
  openingDueUsd: number;
  totalDueUsd: number;
  overdueUsd: number;
  open: { id: string; number: number; date: string; supplierRef: string; currency: Currency; due: number; dueDate: string; late: boolean }[];
}
function DebtsTab() {
  const { tr, fmtDate, lang } = useI18n();
  const d = useData<{ rows: Debt[]; totalUsd: number; overdueUsd: number }>("/purchases/debts");
  if (!d.data) return <Spinner />;
  return (
    <div className="max-w-4xl">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="card">
          <div className="text-sm text-muted">{tr("علينا للموردين", "We owe suppliers")}</div>
          <div className="text-2xl font-bold num ltr text-start">{usd(d.data.totalUsd)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-muted">{tr("منها متأخر", "Of which late")}</div>
          <div className={`text-2xl font-bold num ltr text-start ${d.data.overdueUsd > 0.009 ? "text-bad" : ""}`}>{usd(d.data.overdueUsd)}</div>
        </div>
      </div>
      {d.data.rows.length === 0 ? (
        <Empty text={tr("ما علينا شي لحدا.", "We owe nobody.")} />
      ) : (
        <div className="grid gap-3">
          {d.data.rows.map((r) => (
            <div key={r.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold">{r.name}</div>
                <div className={`text-lg font-bold num ltr ${r.overdueUsd > 0.009 ? "text-bad" : ""}`}>{usd(r.totalDueUsd)}</div>
              </div>
              <ul className="mt-2 grid gap-1 text-sm">
                {r.openingDueUsd > 0.009 && (
                  <li className="flex justify-between">
                    <span>{tr("رصيد افتتاحي", "Opening balance")}</span>
                    <span className="num ltr">{usd(r.openingDueUsd)}</span>
                  </li>
                )}
                {r.open.map((o) => (
                  <li key={o.id} className={`flex justify-between ${o.late ? "text-bad" : ""}`}>
                    <span>
                      #{o.number}
                      {o.supplierRef && ` (${o.supplierRef})`} · {tr("يستحق", "due")} {fmtDate(o.dueDate)}
                    </span>
                    <span className="num ltr">{money(o.due, o.currency, lang)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- price changes ---------- */
function PricesTab() {
  const { tr, pick, lang, fmtDate } = useI18n();
  const d = useData<{ rows: { id: string; nameAr: string; nameEn: string; unitCode: string; oldCostUsd: number; newCostUsd: number; changePct: number; businessDate: string }[] }>("/purchases/price-changes");
  const rows = useMemo(() => d.data?.rows ?? [], [d.data]);
  if (!d.data) return <Spinner />;
  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-muted">{tr("كل مرة فاتورة شراء بتغيّر تكلفة مادة. أثرها على الأصناف بـ التكاليف ← تغيّر الأسعار.", "Every time a purchase changed what an ingredient costs. The effect on products is in Costing → Price changes.")}</p>
      {rows.length === 0 ? (
        <Empty text={tr("ما في تغيّرات.", "No changes.")} />
      ) : (
        <div className="card p-0">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="td">{fmtDate(c.businessDate)}</td>
                  <td className="td font-semibold">{pick(c)}</td>
                  <td className="td text-end num ltr">
                    {usd(c.oldCostUsd)} → {usd(c.newCostUsd)} / {unitOf(c.unitCode, lang)}
                  </td>
                  <td className={`td text-end num ltr font-semibold ${c.changePct > 0 ? "text-bad" : "text-good"}`}>
                    {c.changePct > 0 ? "+" : ""}
                    {pct(c.changePct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PurchasingPage() {
  const { tr } = useI18n();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title={tr("المشتريات", "Purchasing")} subtitle={tr("فواتير الموردين، اللي علينا، وأسعار المواد.", "Supplier invoices, what we owe, and ingredient prices.")} />
      <Tabs
        base="/purchasing"
        tabs={[
          { key: "list", label: tr("الفواتير", "Invoices") },
          ...(can("purchasing", "create") ? [{ key: "new", label: tr("فاتورة جديدة", "New purchase") }] : []),
          { key: "suppliers", label: tr("الموردون", "Suppliers") },
          { key: "debts", label: tr("ديون الموردين", "Supplier debts") },
          { key: "prices", label: tr("تغيّر الأسعار", "Price changes") },
        ]}
      />
      <Routes>
        <Route index element={<Navigate to="list" replace />} />
        <Route path="list" element={<ListTab />} />
        <Route path="new" element={<NewTab />} />
        <Route path="suppliers" element={<SuppliersTab />} />
        <Route path="debts" element={<DebtsTab />} />
        <Route path="prices" element={<PricesTab />} />
      </Routes>
    </>
  );
}
