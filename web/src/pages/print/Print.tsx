import JsBarcode from "jsbarcode";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAppSettings, type AppSettings } from "../../lib/appSettings";
import { money, qty as fq, today, usd, type Currency } from "../../lib/format";
import { useI18n, type Lang } from "../../lib/i18n";
import { useData } from "../../lib/useData";
import type { Batch, PeriodReport } from "../../lib/types";
import { waLink } from "../distribution/common";
import { discountWords, type AppliedTax, type LineOption, type OrderRow } from "../orders/shared";

/* ------------------------------------------------------------------ */
/* Shared print plumbing                                               */
/* ------------------------------------------------------------------ */

const L = (lang: Lang) => (ar: string, en: string) => (lang === "ar" ? ar : en);
const pickL = (lang: Lang) => (o: { nameAr?: string; nameEn?: string }) => (lang === "ar" ? (o.nameAr ?? o.nameEn ?? "") : (o.nameEn ?? o.nameAr ?? ""));
const dateL = (lang: Lang, iso: string, withTime = false) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleString(lang === "ar" ? "ar-SY-u-nu-latn" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });

/** Sets the paper size and prints once when `ready` turns true. */
function usePrintOnce(ready: boolean, page: string) {
  const done = useRef(false);
  useEffect(() => {
    const st = document.createElement("style");
    st.textContent = `@page { ${page} } html, body { background: #fff !important; color: #000 !important; } @media print { .no-print { display: none !important; } }`;
    document.head.appendChild(st);
    return () => st.remove();
  }, [page]);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const t = setTimeout(() => window.print(), 450);
    return () => clearTimeout(t);
  }, [ready]);
}

function Toolbar({ children }: { children?: ReactNode }) {
  const { tr } = useI18n();
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-surface p-2">
      <button className="btn btn-primary px-3 py-1.5" onClick={() => window.print()}>
        {tr("اطبع", "Print")}
      </button>
      {children}
      <button className="btn btn-ghost ms-auto px-3 py-1.5" onClick={() => (window.opener ? window.close() : window.history.back())}>
        {tr("إغلاق", "Close")}
      </button>
    </div>
  );
}

function Loading() {
  return <p className="p-6 text-center text-faint">…</p>;
}

function Logo({ s, className }: { s: AppSettings | null; className: string }) {
  return <img src={s?.business.logo || "/logo.png"} alt="" className={className} />;
}

/* ------------------------------------------------------------------ */
/* Receipt / invoice                                                   */
/* ------------------------------------------------------------------ */

interface Receipt {
  business: AppSettings["business"];
  printing: AppSettings["printing"];
  order: OrderRow & { taxes: AppliedTax[] };
  lines: { id: string; nameAr: string; nameEn: string; qty: number; freeQty: number; unitPrice: number; lineTotal: number; options: LineOption[] }[];
  client: { name: string; phone: string; address: string; contactPerson: string; language: Lang; balanceUsd: number } | null;
  loyalty: { enabled: boolean; buyQty: number; progress: number; available: number } | null;
  payment: { paid: number; remaining: number };
  account: { beforeUsd: number; afterUsd: number; nowUsd: number } | null;
}

export function PrintReceipt() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const ui = useI18n();
  const { s } = useAppSettings();
  const r = useData<{ receipt: Receipt }>(`/orders/${id}/receipt`);
  const rc = r.data?.receipt;
  const size = (sp.get("size") ?? s?.printing.invoiceSize ?? rc?.printing.invoiceSize ?? "thermal") === "a4" ? "a4" : "thermal";
  const width = rc?.printing.receiptWidthMm ?? 80;
  usePrintOnce(!!rc, size === "a4" ? "size: A4; margin: 12mm" : `size: ${width}mm auto; margin: 2mm`);
  if (r.error) return <p className="p-6 text-bad">{ui.err(r.error)}</p>;
  if (!rc) return <Loading />;
  const lang: Lang = rc.client?.language ?? ui.lang;
  const t = L(lang);
  const o = rc.order;
  const m = (v: number) => money(v, o.currency, lang);
  const summary = [
    `${pickL(lang)(rc.business)} · ${t("فاتورة", "Invoice")} #${o.number}`,
    `${t("المجموع", "Total")}: ${m(o.total)}`,
    rc.payment.paid ? `${t("المدفوع", "Paid")}: ${m(rc.payment.paid)}` : "",
    rc.payment.remaining ? `${t("الباقي", "Remaining")}: ${m(rc.payment.remaining)}` : "",
    rc.account ? `${t("رصيدكم", "Your balance")}: ${usd(rc.account.afterUsd)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className={size === "a4" ? "bg-white" : "bg-white"} dir={lang === "ar" ? "rtl" : "ltr"}>
      <Toolbar>
        <div className="inline-flex rounded-lg bg-sunken p-0.5" role="group">
          {(["thermal", "a4"] as const).map((k) => (
            <button
              key={k}
              className={`rounded-md px-2.5 py-1 text-sm font-semibold ${size === k ? "bg-surface shadow-sm" : "text-muted"}`}
              onClick={() => {
                const n = new URLSearchParams(sp);
                n.set("size", k);
                setSp(n, { replace: true });
              }}
            >
              {k === "a4" ? "A4" : ui.tr(`حراري ${width} ملم`, `Thermal ${width} mm`)}
            </button>
          ))}
        </div>
        {rc.client?.phone && (
          <a className="btn px-3 py-1.5" href={waLink(rc.client.phone, summary)} target="_blank" rel="noreferrer">
            {ui.tr("واتساب", "WhatsApp")}
          </a>
        )}
      </Toolbar>
      {size === "a4" ? <InvoiceA4 rc={rc} lang={lang} s={s} /> : <ReceiptThermal rc={rc} lang={lang} s={s} width={width} />}
    </div>
  );
}

/** −14.2 → "owes $14.20", +3 → "credit $3.00" (in USD, plus SYP when the invoice is in SYP). */
function balanceWords(vUsd: number, lang: Lang, rate: number | null, syp: boolean) {
  const t = L(lang);
  const amt = (v: number) => (syp && rate ? `${usd(v)} (${money(v * rate, "SYP", lang)})` : usd(v));
  if (vUsd < -0.009) return `${t("عليه", "owes")} ${amt(-vUsd)}`;
  if (vUsd > 0.009) return `${t("له", "credit")} ${amt(vUsd)}`;
  return t("صفر", "zero");
}

function Cancelled({ lang }: { lang: Lang }) {
  return <div className="my-2 border-4 border-black py-1 text-center text-2xl font-black tracking-widest">{L(lang)("ملغاة", "CANCELLED")}</div>;
}

function lineOptions(l: Receipt["lines"][number], lang: Lang) {
  return l.options.length ? l.options.map((x) => pickL(lang)(x)).join("، ") : "";
}

function ReceiptThermal({ rc, lang, s, width }: { rc: Receipt; lang: Lang; s: AppSettings | null; width: number }) {
  const t = L(lang);
  const pk = pickL(lang);
  const o = rc.order;
  const m = (v: number) => money(v, o.currency, lang);
  const bw = (v: number) => balanceWords(v, lang, o.fxRate, o.currency === "SYP");
  const row = (a: ReactNode, b: ReactNode, bold = false) => (
    <div className={`flex justify-between gap-2 ${bold ? "text-[15px] font-bold" : ""}`}>
      <span>{a}</span>
      <span className="num ltr">{b}</span>
    </div>
  );
  return (
    <div className="mx-auto bg-white p-1 text-[12px] leading-snug text-black" style={{ width: `${width - 4}mm` }}>
      <div className="text-center">
        <Logo s={s} className="mx-auto mb-1 h-12 w-auto grayscale" />
        <div className="text-[15px] font-bold">{pk(rc.business)}</div>
        {rc.business.phone && (
          <div>
            <span className="ltr">{rc.business.phone}</span>
          </div>
        )}
        {rc.business.address && <div>{rc.business.address}</div>}
      </div>
      <div className="my-1.5 border-t border-dashed border-black" />
      {row(`${t("فاتورة", "Invoice")} #${o.number}`, dateL(lang, o.createdAt ?? o.businessDate, true))}
      {rc.client && row(t("الزبون", "Client"), rc.client.name)}
      {o.type !== "normal" && <div className="font-bold">{discountWords(o.type, t) || o.type}</div>}
      {o.status === "cancelled" && <Cancelled lang={lang} />}
      <div className="my-1.5 border-t border-dashed border-black" />
      {rc.lines.map((l) => (
        <div key={l.id} className="mb-1">
          <div className="flex justify-between gap-2">
            <span className="font-semibold">
              {l.qty} × {pk(l)}
            </span>
            <span className="num ltr">{m(l.lineTotal)}</span>
          </div>
          {lineOptions(l, lang) && <div className="ps-3 text-[11px]">+ {lineOptions(l, lang)}</div>}
          {l.freeQty > 0 && <div className="ps-3 text-[11px]">{t(`منها ${l.freeQty} مجاناً`, `${l.freeQty} free`)}</div>}
          <div className="ps-3 text-[11px] num ltr text-start">@ {m(l.unitPrice)}</div>
        </div>
      ))}
      <div className="my-1.5 border-t border-dashed border-black" />
      {row(t("المجموع الفرعي", "Subtotal"), m(o.subtotal))}
      {o.discount > 0 && row(`${t("خصم", "Discount")}${o.discountReason ? ` (${discountWords(o.discountReason, t)})` : ""}`, `− ${m(o.discount)}`)}
      {o.taxes.map((x) => row(`${pk(x)}${x.kind === "percent" ? ` ${x.value}%` : ""}`, m(x.amount)))}
      {o.deliveryFee > 0 && row(t("التوصيل", "Delivery"), m(o.deliveryFee))}
      {row(t("المجموع", "Total"), m(o.total), true)}
      {o.currency === "SYP" && o.fxRate ? <div className="text-end text-[11px] num ltr">≈ {usd(o.totalUsd)}</div> : null}
      <div className="my-1.5 border-t border-dashed border-black" />
      {o.method && row(t("طريقة الدفع", "Payment"), pk(o.method))}
      {rc.payment.paid > 0 && row(t("المدفوع", "Paid"), m(rc.payment.paid))}
      {rc.payment.remaining > 0 && row(t("الباقي على الحساب", "Remaining on account"), m(rc.payment.remaining), true)}
      {rc.account && (
        <>
          {row(t("الرصيد السابق", "Previous balance"), bw(rc.account.beforeUsd))}
          {row(t("الرصيد الجديد", "New balance"), bw(rc.account.afterUsd), true)}
        </>
      )}
      {rc.loyalty?.enabled && (
        <div className="mt-1 text-center text-[11px]">
          {t("الولاء", "Loyalty")}:{" "}
          <span className="num ltr">
            {rc.loyalty.progress} / {rc.loyalty.buyQty}
          </span>
          {rc.loyalty.available > 0 && ` · ${t(`لك ${rc.loyalty.available} مجاناً`, `${rc.loyalty.available} free waiting`)}`}
        </div>
      )}
      <div className="my-1.5 border-t border-dashed border-black" />
      <div className="text-center">{lang === "ar" ? rc.printing.receiptFooterAr : rc.printing.receiptFooterEn}</div>
    </div>
  );
}

function InvoiceA4({ rc, lang, s }: { rc: Receipt; lang: Lang; s: AppSettings | null }) {
  const t = L(lang);
  const pk = pickL(lang);
  const o = rc.order;
  const m = (v: number) => money(v, o.currency, lang);
  const bw = (v: number) => balanceWords(v, lang, o.fxRate, o.currency === "SYP");
  const row = (a: ReactNode, b: ReactNode, bold = false) => (
    <div className={`flex justify-between gap-4 py-0.5 ${bold ? "border-t border-black pt-1 text-[15px] font-bold" : ""}`}>
      <span>{a}</span>
      <span className="num ltr">{b}</span>
    </div>
  );
  return (
    <div className="mx-auto max-w-[186mm] bg-white p-2 text-[12.5px] text-black">
      <div className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div className="flex items-center gap-3">
          <Logo s={s} className="h-16 w-auto" />
          <div>
            <div className="text-xl font-bold">{pk(rc.business)}</div>
            {rc.business.phone && (
              <div>
                <span className="ltr">{rc.business.phone}</span>
              </div>
            )}
            {rc.business.address && <div>{rc.business.address}</div>}
          </div>
        </div>
        <div className="text-end">
          <div className="text-2xl font-bold">{t("فاتورة مبيع", "Sales invoice")}</div>
          <div>
            # <b className="num">{o.number}</b>
          </div>
          <div>{dateL(lang, o.createdAt ?? o.businessDate, true)}</div>
        </div>
      </div>
      {o.status === "cancelled" && <Cancelled lang={lang} />}
      <div className="mt-3 grid grid-cols-2 gap-6">
        <div>
          <div className="text-[11px] text-gray-600">{t("إلى", "Bill to")}</div>
          {rc.client ? (
            <>
              <div className="text-[15px] font-bold">{rc.client.name}</div>
              {rc.client.contactPerson && <div>{rc.client.contactPerson}</div>}
              {rc.client.phone && (
                <div>
                  <span className="ltr">{rc.client.phone}</span>
                </div>
              )}
              {rc.client.address && <div>{rc.client.address}</div>}
            </>
          ) : (
            <div className="font-bold">{t("زبون عابر", "Walk-in client")}</div>
          )}
        </div>
        <div className="text-end">
          {o.method && (
            <div>
              {t("طريقة الدفع", "Payment")}: <b>{pk(o.method)}</b>
            </div>
          )}
          {o.fulfilment === "delivery" && (
            <div>
              {t("توصيل", "Delivery")}
              {o.assignedName ? ` · ${o.assignedName}` : ""}
            </div>
          )}
          {o.type !== "normal" && <div className="font-bold">{discountWords(o.type, t)}</div>}
        </div>
      </div>
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="py-1.5 text-start">{t("الصنف", "Item")}</th>
            <th className="w-16 px-2 py-1.5 text-end">{t("الكمية", "Qty")}</th>
            <th className="w-28 py-1.5 text-end">{t("سعر الوحدة", "Unit price")}</th>
            <th className="w-32 py-1.5 text-end">{t("الإجمالي", "Total")}</th>
          </tr>
        </thead>
        <tbody>
          {rc.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-300 align-top">
              <td className="py-1.5">
                <div className="font-semibold">{pk(l)}</div>
                {lineOptions(l, lang) && <div className="text-[11px]">+ {lineOptions(l, lang)}</div>}
                {l.freeQty > 0 && <div className="text-[11px]">{t(`منها ${l.freeQty} مجاناً`, `${l.freeQty} free`)}</div>}
              </td>
              <td className="px-2 py-1.5 text-end num">{l.qty}</td>
              <td className="py-1.5 text-end num ltr">{m(l.unitPrice)}</td>
              <td className="py-1.5 text-end num ltr">{m(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 grid grid-cols-2 gap-8">
        <div>
          {rc.account && (
            <div className="rounded border border-black p-2">
              <div className="mb-1 font-bold">{t("حساب الزبون", "Client account")}</div>
              {row(t("الرصيد السابق", "Previous balance"), bw(rc.account.beforeUsd))}
              {row(t("هذه الفاتورة على الحساب", "On account from this invoice"), m(rc.payment.remaining))}
              {row(t("الرصيد الجديد", "New balance"), bw(rc.account.afterUsd), true)}
            </div>
          )}
        </div>
        <div>
          {row(t("المجموع الفرعي", "Subtotal"), m(o.subtotal))}
          {o.discount > 0 && row(`${t("خصم", "Discount")}${o.discountReason ? ` (${discountWords(o.discountReason, t)})` : ""}`, `− ${m(o.discount)}`)}
          {o.taxes.map((x) => row(`${pk(x)}${x.kind === "percent" ? ` ${x.value}%` : ""}`, m(x.amount)))}
          {o.deliveryFee > 0 && row(t("التوصيل", "Delivery"), m(o.deliveryFee))}
          {row(t("المجموع", "Total"), m(o.total), true)}
          {o.currency === "SYP" && o.fxRate ? row("≈ USD", usd(o.totalUsd)) : null}
          {row(t("المدفوع", "Paid"), m(rc.payment.paid))}
          {rc.payment.remaining > 0 && row(t("الباقي", "Remaining"), m(rc.payment.remaining), true)}
        </div>
      </div>
      {o.note && (
        <div className="mt-3">
          {t("ملاحظة", "Note")}: {o.note}
        </div>
      )}
      <div className="mt-10 grid grid-cols-2 gap-10 text-[11px]">
        <div className="border-t border-black pt-1">{t("توقيع المستلم", "Received by")}</div>
        <div className="border-t border-black pt-1">
          {t("عن", "For")} {pk(rc.business)}
        </div>
      </div>
      <div className="mt-6 text-center">{lang === "ar" ? rc.printing.receiptFooterAr : rc.printing.receiptFooterEn}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Expiry labels                                                       */
/* ------------------------------------------------------------------ */

function Barcode({ value, height }: { value: string; height: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: "CODE128", height, width: 1.4, margin: 0, fontSize: 10, textMargin: 1, displayValue: true });
    } catch {
      /* invalid code: label still prints without the bars */
    }
  }, [value, height]);
  return <svg ref={ref} className="mx-auto block max-w-full" />;
}

export function PrintLabels() {
  const [sp] = useSearchParams();
  const ui = useI18n();
  const { s } = useAppSettings();
  const ids = useMemo(() => (sp.get("batches") ?? "").split(",").filter(Boolean), [sp]);
  const copiesParam = sp.get("copies");
  const all = useData<{ rows: Batch[] }>("/stock/batches?includeEmpty=1");
  const w = s?.printing.labelWidthMm ?? 50;
  const h = s?.printing.labelHeightMm ?? 30;
  const list = all.data?.rows.filter((b) => ids.includes(b.id)) ?? [];
  const labels = list.flatMap((b) => {
    const n = copiesParam ? Math.max(1, Math.min(500, Number(copiesParam) || 1)) : b.item.kind === "product" ? Math.max(1, Math.min(200, Math.round(b.qtyLeft || b.qtyIn))) : 1;
    return Array.from({ length: n }, (_, i) => ({ b, key: `${b.id}-${i}` }));
  });
  usePrintOnce(!!all.data && !!s, `size: ${w}mm ${h}mm; margin: 0`);
  if (!all.data || !s) return <Loading />;
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="bg-white">
      <Toolbar>
        <span className="text-sm text-muted">{ui.tr(`${labels.length} ملصق · ${w}×${h} ملم`, `${labels.length} labels · ${w}×${h} mm`)}</span>
      </Toolbar>
      {labels.length === 0 && <p className="p-6 text-center text-faint">{ui.tr("ما في دفعات", "No batches")}</p>}
      <div className="flex flex-col items-center gap-2 print:block print:gap-0">
        {labels.map(({ b, key }) => (
          <div
            key={key}
            className="flex flex-col justify-between overflow-hidden border border-dashed border-gray-400 bg-white p-[1.2mm] text-black print:border-0"
            style={{ width: `${w}mm`, height: `${h}mm`, pageBreakAfter: "always", breakAfter: "page" }}
          >
            <div className="text-center leading-tight">
              <div className="truncate text-[9pt] font-bold" dir="rtl">
                {b.item.nameAr}
              </div>
              <div className="truncate text-[7pt]" dir="ltr">
                {b.item.nameEn}
              </div>
            </div>
            <div className="flex justify-between text-[6.5pt] leading-tight" dir="ltr">
              <span>
                PROD <b>{fmt(b.producedAt)}</b>
              </span>
              {b.expiresAt && (
                <span>
                  EXP <b className="text-[8pt]">{fmt(b.expiresAt)}</b>
                </span>
              )}
            </div>
            {b.allergens && (
              <div className="truncate text-center text-[6pt]" dir="ltr">
                {b.allergens}
              </div>
            )}
            <Barcode value={b.batchCode} height={Math.max(14, Math.round(h * 0.9))} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Client statement                                                    */
/* ------------------------------------------------------------------ */

interface Statement {
  client: { id: string; name: string; contactPerson: string; phone: string; address: string; receiptLanguage: Lang; creditLimitUsd: number };
  from: string;
  to: string;
  openingUsd: number;
  closingUsd: number;
  lines: { id: string; businessDate: string; type: string; amount: number; currency: Currency; amountUsd: number; note: string; balanceUsd: number }[];
  orders: { id: string; number: number; date: string; total: number; currency: Currency; itemsCount: number }[];
  returns: { id: string; number: number; businessDate: string; total: number; currency: Currency }[];
  aging: { overdueDays: number; oldestUnpaidDate: string | null; termsDays: number };
}

const MOVE_LABEL: Record<string, [string, string]> = {
  charge: ["فاتورة على الحساب", "Invoice on account"],
  payment: ["دفعة", "Payment"],
  topup: ["شحن رصيد", "Top-up"],
  refund: ["إلغاء فاتورة", "Invoice cancelled"],
  adjust: ["تعديل", "Adjustment"],
  subscription: ["اشتراك شهري", "Monthly subscription"],
  return: ["مرتجع", "Return"],
  opening: ["رصيد افتتاحي", "Opening balance"],
};

export function PrintStatement() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const ui = useI18n();
  const { s } = useAppSettings();
  const from = sp.get("from") ?? `${today().slice(0, 8)}01`;
  const to = sp.get("to") ?? today();
  const d = useData<Statement>(`/clients/${id}/statement?from=${from}&to=${to}`);
  usePrintOnce(!!d.data, "size: A4; margin: 12mm");
  if (d.error) return <p className="p-6 text-bad">{ui.err(d.error)}</p>;
  if (!d.data) return <Loading />;
  const st = d.data;
  const lang: Lang = st.client.receiptLanguage ?? ui.lang;
  const t = L(lang);
  const bal = (v: number) => (v < -0.009 ? `${usd(-v)} ${t("عليه", "due")}` : v > 0.009 ? `${usd(v)} ${t("له", "credit")}` : usd(0));
  return (
    <div className="bg-white" dir={lang === "ar" ? "rtl" : "ltr"}>
      <Toolbar>
        {st.client.phone && (
          <a
            className="btn px-3 py-1.5"
            href={waLink(
              st.client.phone,
              `${pickL(lang)(s?.business ?? { nameAr: "JJ's", nameEn: "JJ's" })} · ${t("كشف حساب", "Statement")} ${st.from} → ${st.to}\n${t("الرصيد", "Balance")}: ${bal(st.closingUsd)}`,
            )}
            target="_blank"
            rel="noreferrer"
          >
            {ui.tr("واتساب", "WhatsApp")}
          </a>
        )}
      </Toolbar>
      <div className="mx-auto max-w-[186mm] p-2 text-[12px] text-black">
        <div className="flex items-start justify-between border-b-2 border-black pb-2">
          <div className="flex items-center gap-3">
            <Logo s={s} className="h-14 w-auto" />
            <div>
              <div className="text-lg font-bold">{s ? pickL(lang)(s.business) : "JJ's"}</div>
              <div>{t("كشف حساب", "Account statement")}</div>
            </div>
          </div>
          <div className="text-end">
            <div className="text-[15px] font-bold">{st.client.name}</div>
            {st.client.phone && (
              <div>
                <span className="ltr">{st.client.phone}</span>
              </div>
            )}
            <div>
              {dateL(lang, st.from)} → {dateL(lang, st.to)}
            </div>
          </div>
        </div>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1 text-start">{t("التاريخ", "Date")}</th>
              <th className="py-1 text-start">{t("البيان", "Details")}</th>
              <th className="py-1 text-end">{t("عليه", "Debit")}</th>
              <th className="py-1 text-end">{t("له", "Credit")}</th>
              <th className="py-1 text-end">{t("الرصيد", "Balance")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-300">
              <td className="py-1" colSpan={4}>
                {t("الرصيد الافتتاحي", "Opening balance")}
              </td>
              <td className="py-1 text-end num ltr">{bal(st.openingUsd)}</td>
            </tr>
            {st.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-300">
                <td className="py-1 whitespace-nowrap">{dateL(lang, l.businessDate)}</td>
                <td className="py-1">
                  {t(...(MOVE_LABEL[l.type] ?? [l.type, l.type]))} {l.note && <span className="text-gray-600">{l.note}</span>}
                </td>
                <td className="py-1 text-end num ltr">{l.amountUsd < 0 ? usd(-l.amountUsd) : ""}</td>
                <td className="py-1 text-end num ltr">{l.amountUsd > 0 ? usd(l.amountUsd) : ""}</td>
                <td className="py-1 text-end num ltr">{bal(l.balanceUsd)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-black font-bold">
              <td className="py-1.5" colSpan={4}>
                {t("الرصيد الختامي", "Closing balance")}
              </td>
              <td className="py-1.5 text-end num ltr">{bal(st.closingUsd)}</td>
            </tr>
          </tbody>
        </table>
        {st.aging.overdueDays > 0 && (
          <p className="mt-2 font-bold">
            {t(
              `متأخر عن الدفع ${st.aging.overdueDays} يوم (مدة السداد ${st.aging.termsDays} يوم).`,
              `Payment is ${st.aging.overdueDays} days late (terms: ${st.aging.termsDays} days).`,
            )}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div>
            <div className="mb-1 font-bold">{t("الفواتير بالفترة", "Invoices in the period")}</div>
            {st.orders.length === 0 ? (
              <div className="text-gray-600">—</div>
            ) : (
              st.orders.map((o) => (
                <div key={o.id} className="flex justify-between border-b border-gray-200 py-0.5">
                  <span>
                    #{o.number} · {dateL(lang, o.date)} · {o.itemsCount} {t("قطعة", "pcs")}
                  </span>
                  <span className="num ltr">{money(o.total, o.currency, lang)}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="mb-1 font-bold">{t("المرتجعات بالفترة", "Returns in the period")}</div>
            {st.returns.length === 0 ? (
              <div className="text-gray-600">—</div>
            ) : (
              st.returns.map((r) => (
                <div key={r.id} className="flex justify-between border-b border-gray-200 py-0.5">
                  <span>
                    R{r.number} · {dateL(lang, r.businessDate)}
                  </span>
                  <span className="num ltr">{money(r.total, r.currency, lang)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <p className="mt-6 text-center text-[11px] text-gray-600">{t("المبالغ بالدولار حسب سعر يوم كل عملية.", "Amounts in USD at each day's rate.")}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Day / period report                                                 */
/* ------------------------------------------------------------------ */

export function PrintReport() {
  const [sp] = useSearchParams();
  const ui = useI18n();
  const { tr, pick, lang } = ui;
  const { s } = useAppSettings();
  const from = sp.get("from") ?? today();
  const to = sp.get("to") ?? from;
  const r = useData<
    PeriodReport & {
      returnsUsd?: number;
      netSalesUsd?: number;
      collectedUsd?: number;
      purchasesUsd?: number;
      withdrawalsUsd?: number;
      internalUse?: { orders: number; items: number; costUsd: number };
      operatingProfitUsd?: number;
      dueExpensesUsd?: number;
      avgRate?: number | null;
    }
  >(`/reports/range?from=${from}&to=${to}`);
  usePrintOnce(!!r.data, "size: A4; margin: 12mm");
  if (r.error) return <p className="p-6 text-bad">{ui.err(r.error)}</p>;
  if (!r.data) return <Loading />;
  const d = r.data;
  const line = (a: string, v: number | undefined, bold = false) =>
    v === undefined ? null : (
      <div className={`flex justify-between border-b border-gray-200 py-0.5 ${bold ? "font-bold" : ""}`}>
        <span>{a}</span>
        <span className="num ltr">{usd(v)}</span>
      </div>
    );
  const methodName = (m: PeriodReport["byMethod"][number]) =>
    m.methodId ? pick({ nameAr: m.nameAr ?? "", nameEn: m.nameEn ?? "" }) : tr("بدون دفع (مجاني / تجربة)", "No payment (free / trial)");
  return (
    <div className="bg-white">
      <Toolbar />
      <div className="mx-auto max-w-[186mm] p-2 text-[12px] text-black">
        <div className="flex items-start justify-between border-b-2 border-black pb-2">
          <div className="flex items-center gap-3">
            <Logo s={s} className="h-12 w-auto" />
            <div>
              <div className="text-lg font-bold">{s ? pick(s.business) : "JJ's"}</div>
              <div>{from === to ? tr("تقرير اليوم", "Day report") : tr("تقرير الفترة", "Period report")}</div>
            </div>
          </div>
          <div className="text-end font-bold">{from === to ? dateL(lang, from) : `${dateL(lang, from)} → ${dateL(lang, to)}`}</div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-3 text-center">
          {[
            [tr("الفواتير", "Invoices"), String(d.orders)],
            [tr("القطع", "Items"), String(d.items)],
            [tr("صافي المبيعات", "Net sales"), usd(d.netSalesUsd ?? d.salesUsd)],
            [tr("المقبوض فعلياً", "Collected"), usd(d.collectedUsd ?? 0)],
          ].map(([a, b]) => (
            <div key={a} className="rounded border border-black p-2">
              <div className="text-[11px]">{a}</div>
              <div className="text-[16px] font-bold num ltr">{b}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div>
            <div className="mb-1 font-bold">{tr("المبيعات والأرباح", "Sales & profit")}</div>
            {line(tr("المبيعات", "Sales"), d.salesUsd)}
            {line(tr("المرتجعات", "Returns"), d.returnsUsd)}
            {line(tr("صافي المبيعات", "Net sales"), d.netSalesUsd, true)}
            {line(tr("الخصومات", "Discounts"), d.discountUsd)}
            {line(tr("الضرائب", "Taxes"), d.taxUsd)}
            {line(tr("رسوم التوصيل", "Delivery fees"), d.deliveryUsd)}
            {!d.hiddenCosts && line(tr("تكلفة البضاعة", "Goods cost"), d.costUsd)}
            {!d.hiddenCosts && line(tr("الربح الإجمالي", "Gross profit"), d.grossProfitUsd, true)}
            {line(tr("المصاريف", "Expenses"), d.expensesUsd)}
            {line(tr("الهدر", "Waste"), d.wasteUsd)}
            {!d.hiddenCosts && line(tr("الرواتب", "Salaries"), d.salariesUsd)}
            {!d.hiddenCosts && line(tr("الاستهلاك", "Depreciation"), d.depreciationUsd)}
            {!d.hiddenCosts && line(tr("صافي الربح", "Net profit"), d.netUsd, true)}
          </div>
          <div>
            <div className="mb-1 font-bold">{tr("المال", "Money")}</div>
            {d.byMethod.map((m) => (
              <div key={m.methodId ?? "none"} className="flex justify-between border-b border-gray-200 py-0.5">
                <span>
                  {methodName(m)} ({m.n})
                </span>
                <span className="num ltr">{usd(m.usd)}</span>
              </div>
            ))}
            {line(tr("المشتريات", "Purchases"), d.purchasesUsd)}
            {line(tr("مصاريف مستحقة غير مدفوعة", "Expenses still due"), d.dueExpensesUsd)}
            {!d.hiddenCosts && line(tr("السحوبات الشخصية", "Personal withdrawals"), d.withdrawalsUsd)}
            {!d.hiddenCosts &&
              d.internalUse &&
              line(tr(`استهلاك داخلي وتذوّق (${d.internalUse.items} قطعة)`, `Internal use & tasting (${d.internalUse.items} pcs)`), d.internalUse.costUsd)}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div>
            <div className="mb-1 font-bold">{tr("حسب الصنف", "By product")}</div>
            {d.byProduct.map((p) => (
              <div key={p.productId} className="flex justify-between border-b border-gray-200 py-0.5">
                <span>
                  {pick(p)} × {p.qty}
                </span>
                <span className="num ltr">{usd(p.revenueUsd)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1 font-bold">{tr("حسب الزبون", "By client")}</div>
            {d.byClient.slice(0, 20).map((c) => (
              <div key={c.clientId ?? "walk"} className="flex justify-between border-b border-gray-200 py-0.5">
                <span>
                  {c.name ?? tr("زبائن عابرون", "Walk-in")} ({c.orders})
                </span>
                <span className="num ltr">{usd(c.salesUsd)}</span>
              </div>
            ))}
          </div>
        </div>
        {(d.waste.length > 0 || d.expenses.length > 0) && (
          <div className="mt-4 grid grid-cols-2 gap-6">
            <div>
              <div className="mb-1 font-bold">{tr("الهدر", "Waste")}</div>
              {d.waste.map((w) => (
                <div key={w.itemId} className="flex justify-between border-b border-gray-200 py-0.5">
                  <span>
                    {pick(w)} · {fq(w.qty)}
                  </span>
                  <span className="num ltr">{usd(w.usd)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 font-bold">{tr("المصاريف", "Expenses")}</div>
              {d.expenses.map((e) => (
                <div key={e.categoryId ?? "none"} className="flex justify-between border-b border-gray-200 py-0.5">
                  <span>
                    {e.nameAr ? pick({ nameAr: e.nameAr, nameEn: e.nameEn ?? "" }) : tr("بدون فئة", "No category")} ({e.n})
                  </span>
                  <span className="num ltr">{usd(e.usd)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-6 text-center text-[11px] text-gray-600">
          {tr("المبالغ بالدولار حسب سعر يوم كل عملية", "Amounts in USD at each day's rate")}
          {d.avgRate ? ` · ${tr("متوسط السعر", "average rate")} ${Math.round(d.avgRate).toLocaleString("en-US")}` : ""}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-10 text-[11px]">
          <div className="border-t border-black pt-1">{tr("أعدّه", "Prepared by")}</div>
          <div className="border-t border-black pt-1">{tr("راجعه", "Checked by")}</div>
        </div>
      </div>
    </div>
  );
}
