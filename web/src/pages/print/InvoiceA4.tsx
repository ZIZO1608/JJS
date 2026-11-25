import type { CSSProperties, ReactNode } from "react";
import type { InvoiceTemplate } from "@shared/invoiceTemplate";
import { money, num, type Currency } from "../../lib/format";
import type { Lang } from "../../lib/i18n";

/**
 * An A4 invoice as a document: every text and number is a field, so the admin can change it
 * like a Word page before printing. Nothing here touches the real order, stock or balance.
 */
export interface DocLine {
  key: string;
  name: string;
  /** Small line under the name: add-ons, "2 free"… */
  sub: string;
  qty: number;
  unitPrice: number;
}
export interface InvoiceDoc {
  lang: Lang;
  currency: Currency;
  logoSrc: string;
  businessName: string;
  businessLines: string;
  title: string;
  numberText: string;
  dateText: string;
  billTo: string;
  meta: string;
  intro: string;
  lines: DocLine[];
  discountLabel: string;
  discount: number;
  taxes: { key: string; label: string; amount: number }[];
  deliveryFee: number;
  paid: number;
  /** Paid in full when printed: after edits the paid amount follows the new total until it is typed in. */
  paidFull: boolean;
  /** Client account box, already worded (previous / new balance). */
  account: { before: string; after: string } | null;
  /** "≈ $12.40" under a SYP total. */
  usdText: string | null;
  note: string;
  footer: string;
  cancelled: boolean;
  /** The printed numbers as saved, used until a line or amount is changed. */
  fixed: { subtotal: number; total: number; remaining: number };
  edited: boolean;
  t: InvoiceTemplate;
}

const round = (v: number, c: Currency) => (c === "SYP" ? Math.round(v) : Math.round(v * 100) / 100);

export function docTotals(d: InvoiceDoc) {
  if (!d.edited) return { ...d.fixed, paid: d.paid };
  const subtotal = round(d.lines.reduce((s, l) => s + round(l.qty * l.unitPrice, d.currency), 0), d.currency);
  const total = round(Math.max(0, subtotal - d.discount + d.taxes.reduce((s, x) => s + x.amount, 0) + d.deliveryFee), d.currency);
  const paid = d.paidFull ? total : d.paid;
  return { subtotal, total, paid, remaining: round(Math.max(0, total - paid), d.currency) };
}

type Set = (patch: Partial<InvoiceDoc>) => void;

/** A text that becomes a box while editing. */
function Ed({ value, onChange, editing, multiline, className = "", placeholder, style }: { value: string; onChange: (v: string) => void; editing: boolean; multiline?: boolean; className?: string; placeholder?: string; style?: CSSProperties }) {
  if (!editing) return value ? <span className={`whitespace-pre-line ${className}`} style={style}>{value}</span> : null;
  return multiline ? (
    <textarea className={`inv-ed ${className}`} style={style} rows={Math.max(1, value.split("\n").length)} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className={`inv-ed ${className}`} style={style} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

/** A number that becomes a box while editing. */
function NumEd({ value, onChange, editing, show, className = "" }: { value: number; onChange: (v: number) => void; editing: boolean; show: string; className?: string }) {
  if (!editing) return <span className={`num ltr ${className}`}>{show}</span>;
  return (
    <input
      className={`inv-ed num ltr w-24 text-end ${className}`}
      inputMode="decimal"
      defaultValue={String(value)}
      onChange={(e) => {
        const n = num(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

export function InvoiceA4View({ d, editing, set }: { d: InvoiceDoc; editing: boolean; set: Set }) {
  const t = (ar: string, en: string) => (d.lang === "ar" ? ar : en);
  const m = (v: number) => money(v, d.currency, d.lang);
  const tot = docTotals(d);
  const accent = d.t.accent || "#000000";
  const line: CSSProperties = { borderColor: accent };
  const setNum = (patch: Partial<InvoiceDoc>) => set({ ...patch, edited: true });
  const setLine = (key: string, patch: Partial<DocLine>) => set({ lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)), ...("qty" in patch || "unitPrice" in patch ? { edited: true } : {}) });
  const row = (a: ReactNode, b: ReactNode, bold = false) => (
    <div className={`flex items-center justify-between gap-4 py-0.5 ${bold ? "border-t pt-1 text-[15px] font-bold" : ""}`} style={bold ? line : undefined}>
      <span>{a}</span>
      <span className="num ltr">{b}</span>
    </div>
  );
  return (
    <div className="mx-auto max-w-[186mm] bg-white p-2 text-[12.5px] text-black">
      <div className="flex items-start justify-between gap-6 border-b-2 pb-3" style={line}>
        <div className="flex items-center gap-3">
          {d.t.showLogo && <img src={d.logoSrc} alt="" className="h-16 w-auto" />}
          <div>
            <div className="text-xl font-bold">{d.businessName}</div>
            <Ed editing={editing} multiline value={d.businessLines} onChange={(v) => set({ businessLines: v })} />
          </div>
        </div>
        <div className="text-end">
          <div className="text-2xl font-bold" style={{ color: accent }}>
            {editing ? <Ed editing value={d.title} onChange={(v) => set({ title: v })} className="text-end" /> : d.title}
          </div>
          <div>
            <Ed editing={editing} value={d.numberText} onChange={(v) => set({ numberText: v })} className="text-end font-bold" />
          </div>
          <div>
            <Ed editing={editing} value={d.dateText} onChange={(v) => set({ dateText: v })} className="text-end" />
          </div>
        </div>
      </div>
      {d.cancelled && <div className="my-2 border-4 border-black py-1 text-center text-2xl font-black tracking-widest">{t("ملغاة", "CANCELLED")}</div>}
      <div className="mt-3 grid grid-cols-2 gap-6">
        <div>
          <div className="text-[11px] text-gray-600">{t("إلى", "Bill to")}</div>
          <Ed editing={editing} multiline value={d.billTo} onChange={(v) => set({ billTo: v })} className="block text-[14px] [&:first-line]:font-bold" />
        </div>
        <div className="text-end">
          <Ed editing={editing} multiline value={d.meta} onChange={(v) => set({ meta: v })} className="block text-end" />
        </div>
      </div>
      {(d.intro || editing) && (
        <div className="mt-3">
          <Ed editing={editing} multiline value={d.intro} placeholder={t("نص قبل الأصناف (اختياري)", "Text before the items (optional)")} onChange={(v) => set({ intro: v })} className="block w-full" />
        </div>
      )}
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y" style={line}>
            <th className="py-1.5 text-start">{t("الصنف", "Item")}</th>
            <th className="w-16 px-2 py-1.5 text-end">{t("الكمية", "Qty")}</th>
            {d.t.showUnitPrice && <th className="w-28 py-1.5 text-end">{t("سعر الوحدة", "Unit price")}</th>}
            <th className="w-32 py-1.5 text-end">{t("الإجمالي", "Total")}</th>
            {editing && <th className="no-print w-8" />}
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.key} className="border-b border-gray-300 align-top">
              <td className="py-1.5">
                <div className="font-semibold">
                  <Ed editing={editing} value={l.name} onChange={(v) => setLine(l.key, { name: v })} />
                </div>
                {(l.sub || editing) && (
                  <div className="text-[11px]">
                    <Ed editing={editing} value={l.sub} placeholder={t("سطر صغير (اختياري)", "Small line (optional)")} onChange={(v) => setLine(l.key, { sub: v })} />
                  </div>
                )}
              </td>
              <td className="px-2 py-1.5 text-end">
                <NumEd editing={editing} value={l.qty} show={String(l.qty)} onChange={(v) => setLine(l.key, { qty: v })} className={editing ? "!w-16" : ""} />
              </td>
              {d.t.showUnitPrice && (
                <td className="py-1.5 text-end">
                  <NumEd editing={editing} value={l.unitPrice} show={m(l.unitPrice)} onChange={(v) => setLine(l.key, { unitPrice: v })} />
                </td>
              )}
              <td className="py-1.5 text-end num ltr">{m(round(l.qty * l.unitPrice, d.currency))}</td>
              {editing && (
                <td className="no-print py-1.5 text-end">
                  <button className="rounded px-1.5 text-red-700 hover:bg-red-50" title={t("احذف السطر", "Remove line")} onClick={() => set({ lines: d.lines.filter((x) => x.key !== l.key), edited: true })}>
                    ✕
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <button
          className="no-print mt-2 rounded border border-dashed border-gray-400 px-3 py-1 text-sm hover:bg-gray-50"
          onClick={() => set({ lines: [...d.lines, { key: `n${Date.now()}`, name: t("صنف جديد", "New item"), sub: "", qty: 1, unitPrice: 0 }], edited: true })}
        >
          {t("+ سطر", "+ Line")}
        </button>
      )}
      <div className="mt-3 grid grid-cols-2 gap-8">
        <div>
          {d.t.showAccount && d.account && (
            <div className="rounded border p-2" style={line}>
              <div className="mb-1 font-bold">{t("حساب الزبون", "Client account")}</div>
              {row(t("الرصيد السابق", "Previous balance"), d.account.before)}
              {row(t("هذه الفاتورة على الحساب", "On account from this invoice"), m(tot.remaining))}
              {row(t("الرصيد الجديد", "New balance"), d.account.after, true)}
            </div>
          )}
        </div>
        <div>
          {row(t("المجموع الفرعي", "Subtotal"), m(tot.subtotal))}
          {(d.discount > 0 || editing) &&
            row(
              <Ed editing={editing} value={d.discountLabel} onChange={(v) => set({ discountLabel: v })} />,
              editing ? <NumEd editing value={d.discount} show="" onChange={(v) => setNum({ discount: Math.max(0, v) })} /> : `− ${m(d.discount)}`,
            )}
          {d.taxes.map((x) =>
            row(
              <Ed editing={editing} value={x.label} onChange={(v) => set({ taxes: d.taxes.map((y) => (y.key === x.key ? { ...y, label: v } : y)) })} />,
              <NumEd editing={editing} value={x.amount} show={m(x.amount)} onChange={(v) => setNum({ taxes: d.taxes.map((y) => (y.key === x.key ? { ...y, amount: v } : y)) })} />,
            ),
          )}
          {(d.deliveryFee > 0 || editing) && row(t("التوصيل", "Delivery"), <NumEd editing={editing} value={d.deliveryFee} show={m(d.deliveryFee)} onChange={(v) => setNum({ deliveryFee: Math.max(0, v) })} />)}
          {row(t("المجموع", "Total"), m(tot.total), true)}
          {d.usdText && !d.edited && row("≈ USD", d.usdText)}
          {d.t.showPayment && (
            <>
              {row(t("المدفوع", "Paid"), <NumEd key={d.paidFull ? `full${tot.total}` : "typed"} editing={editing} value={tot.paid} show={m(tot.paid)} onChange={(v) => setNum({ paid: Math.max(0, v), paidFull: false })} />)}
              {tot.remaining > 0 && row(t("الباقي", "Remaining"), m(tot.remaining), true)}
            </>
          )}
        </div>
      </div>
      {(d.note || editing) && (
        <div className="mt-3">
          {t("ملاحظة", "Note")}: <Ed editing={editing} value={d.note} onChange={(v) => set({ note: v })} />
        </div>
      )}
      {d.t.showSignatures && (
        <div className="mt-10 grid grid-cols-2 gap-10 text-[11px]">
          <div className="border-t pt-1" style={line}>
            {t("توقيع المستلم", "Received by")}
          </div>
          <div className="border-t pt-1" style={line}>
            {t("عن", "For")} {d.businessName}
          </div>
        </div>
      )}
      <div className="mt-6 text-center">
        <Ed editing={editing} multiline value={d.footer} onChange={(v) => set({ footer: v })} className="block text-center" />
      </div>
    </div>
  );
}

/** The bar above the page while editing (never printed): what shows, the colour, save as this client's design. */
export function InvoiceEditBar({
  d,
  set,
  clientName,
  onSaveDesign,
  onReset,
  saving,
  ui,
  designing,
}: {
  d: InvoiceDoc;
  set: Set;
  clientName: string | null;
  onSaveDesign: (() => void) | null;
  onReset: () => void;
  saving: boolean;
  ui: (ar: string, en: string) => string;
  /** The client's design page: the sample items are only an example. */
  designing?: boolean;
}) {
  const flag = (k: "showLogo" | "showUnitPrice" | "showAccount" | "showPayment" | "showSignatures", label: string) => (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-ink" checked={d.t[k]} onChange={(e) => set({ t: { ...d.t, [k]: e.target.checked } })} />
      {label}
    </label>
  );
  return (
    <div className="no-print mx-auto mb-4 grid max-w-[186mm] gap-2 rounded-xl border border-line bg-surface p-3 text-ink">
      <div className="text-sm text-muted">
        {designing
          ? ui("غيّر العنوان والنصوص واللون والأقسام، واحفظ. الأصناف هون مثال بس — كل فاتورة بتطلع بأصنافها الحقيقية.", "Change the title, texts, colour and parts, then save. The items here are only an example — each invoice shows its real items.")
          : ui("عدّل أي نص أو رقم بالصفحة. التعديل بيغيّر النسخة المطبوعة بس — الفاتورة الأصلية والمخزون والرصيد ما بيتغيّروا.", "Change any text or number on the page. This only changes the printed copy — the real invoice, stock and balance stay the same.")}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {flag("showLogo", ui("الشعار", "Logo"))}
        {flag("showUnitPrice", ui("سعر الوحدة", "Unit price"))}
        {flag("showAccount", ui("حساب الزبون", "Client account"))}
        {flag("showPayment", ui("المدفوع والباقي", "Paid & remaining"))}
        {flag("showSignatures", ui("التواقيع", "Signatures"))}
        <label className="inline-flex items-center gap-1.5 text-sm">
          {ui("اللون", "Colour")}
          <input type="color" className="h-7 w-10 cursor-pointer rounded border border-line bg-surface" value={d.t.accent} onChange={(e) => set({ t: { ...d.t, accent: e.target.value } })} />
        </label>
      </div>
      {d.edited && d.account && d.t.showAccount && <div className="text-xs text-warn">{ui("غيّرت المبالغ: «الرصيد الجديد» بيضل الرصيد الحقيقي. خفّي «حساب الزبون» إذا بدك.", "You changed the amounts: “New balance” still shows the real balance. Hide “Client account” if you like.")}</div>}
      <div className="flex flex-wrap gap-2">
        {onSaveDesign && clientName && (
          <button className="btn btn-primary px-3 py-1.5 text-sm" disabled={saving} onClick={onSaveDesign} title={ui("بيحفظ العنوان والنصوص والألوان والأقسام الظاهرة (مش الأصناف والأسعار)", "Saves the title, texts, colour and shown parts (not the items or prices)")}>
            {ui(`احفظ كتصميم فواتير ${clientName}`, `Save as ${clientName}'s invoice design`)}
          </button>
        )}
        <button className="btn px-3 py-1.5 text-sm" onClick={onReset}>
          {ui("رجّع الأصل", "Undo all changes")}
        </button>
      </div>
    </div>
  );
}
