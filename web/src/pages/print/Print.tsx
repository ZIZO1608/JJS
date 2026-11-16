import JsBarcode from "jsbarcode";
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAppSettings, type AppSettings } from "../../lib/appSettings";
import { money, qty as fq, today, usd, type Currency } from "../../lib/format";
import { useI18n, type Lang } from "../../lib/i18n";
import { desktop, getRoll, readDevicePrinters, setRoll, type PrintKind, type RollState } from "../../lib/print";
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

/**
 * Print-only rules for every print view: white page, no buttons, and nothing but the app itself,
 * so icons that browser extensions add to every page (they sit outside #root) never reach the paper.
 */
const PRINT_CSS = "html, body { background: #fff !important; color: #000 !important; margin: 0 !important; } @media print { .no-print { display: none !important; } body > *:not(#root), html > *:not(head):not(body) { display: none !important; } }";

/** Sets the paper size and prints once when `ready` turns true. */
function usePrintOnce(ready: boolean, page: string) {
  const done = useRef(false);
  useEffect(() => {
    const st = document.createElement("style");
    st.textContent = `@page { ${page} } ${PRINT_CSS}`;
    document.head.appendChild(st);
    return () => st.remove();
  }, [page]);
  useEffect(() => {
    if (!ready || done.current) return;
    const t = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      window.print();
    }, 450);
    return () => clearTimeout(t);
  }, [ready]);
}

/** A label or receipt job: which printer it needs and its paper size. `heightMm: "auto"` measures the receipt. */
interface Job {
  kind: PrintKind;
  widthMm: number;
  heightMm: number | "auto";
}
type Stage = "idle" | "swap" | "printing" | "done" | "error";

/**
 * Like usePrintOnce, but in the desktop app a label or receipt goes straight to this PC's chosen printer.
 * When labels and receipts share one printer and the other roll is in, it first asks to swap the roll.
 * Anywhere else (a browser, no printer chosen, A4) it opens the normal print window.
 */
function useSmartPrint(ready: boolean, page: string, job: Job | null) {
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const done = useRef(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<RollState | null>(null);
  const cfg = useMemo(readDevicePrinters, []);
  const api = desktop();
  const device = job ? cfg[job.kind] : "";
  const direct = !!(api && job && device && cfg.direct);

  useEffect(() => {
    const st = document.createElement("style");
    st.textContent = `@page { ${page} } ${PRINT_CSS}`;
    document.head.appendChild(st);
    styleRef.current = st;
    return () => st.remove();
  }, [page]);

  /** Sets the page to the job's exact size (receipts measured), so neither Electron nor Chrome's print window needs a paper size picked. */
  const exactPage = (j: Job) => {
    let height = j.heightMm;
    if (height === "auto") {
      const root = document.getElementById("print-root");
      // px → mm, plus a few mm so the last line clears the tear bar
      height = Math.ceil(((root?.offsetHeight ?? 400) * 25.4) / 96) + 4;
    }
    if (styleRef.current) styleRef.current.textContent = `@page { size: ${j.widthMm}mm ${height}mm; margin: 0 } ${PRINT_CSS}`;
    return height;
  };

  const send = async () => {
    if (!job) return;
    const height = exactPage(job);
    if (!direct || !api) {
      // browser (or no printer chosen): the print window opens at the right size; the hint says which printer to pick
      setStage("idle");
      window.print();
      return;
    }
    setStage("printing");
    const r = await api.print({ deviceName: device, widthMm: job.widthMm, heightMm: height });
    if (r.ok) {
      setStage("done");
      if (window.opener) setTimeout(() => window.close(), 1500);
    } else {
      setError(r.error ?? "");
      setStage("error");
    }
  };

  const start = async () => {
    if (!job) {
      window.print();
      return;
    }
    if (cfg.sharedRoll) {
      try {
        const r = await getRoll();
        if (r.roll !== job.kind) {
          setLoaded(r);
          setStage("swap");
          return;
        }
      } catch {
        /* server unreachable: print anyway rather than block the sale */
      }
    }
    await send();
  };

  const swapped = async () => {
    if (!job) return;
    try {
      await setRoll(job.kind);
    } catch {
      /* the print still goes out; the next job will ask again */
    }
    await send();
  };

  // Exact size and zero margin as soon as the content is there, so even Ctrl+P gets no browser header/footer.
  useEffect(() => {
    if (!ready || !job) return;
    const f = requestAnimationFrame(() => exactPage(job));
    return () => cancelAnimationFrame(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, job?.kind, job?.widthMm, job?.heightMm]);

  useEffect(() => {
    if (!ready || done.current) return;
    // mark "done" only when the timer fires: a cleared timer (React re-running effects) must not eat the print
    const t = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      void start();
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const panel = (
    <PrintStatus
      stage={stage}
      job={job}
      device={device || (job ? DEFAULT_PRINTER[job.kind] : "")}
      direct={direct}
      loaded={loaded}
      error={error}
      onSwapped={swapped}
      onCancel={() => setStage("idle")}
    />
  );
  return { print: () => void start(), dialog: () => window.print(), direct, panel };
}

const ROLL_NAME: Record<PrintKind, [string, string]> = { label: ["رول الملصقات", "label roll"], receipt: ["رول الفواتير 80 ملم", "80 mm receipt roll"] };
/** The Windows names set up for the XP-236B; used in the browser hint when this PC has none saved. */
const DEFAULT_PRINTER: Record<PrintKind, string> = { label: "XP-236B Labels", receipt: "XP-236B Invoices" };

function PrintStatus({
  stage,
  job,
  device,
  direct,
  loaded,
  error,
  onSwapped,
  onCancel,
}: {
  stage: Stage;
  job: Job | null;
  device: string;
  direct: boolean;
  loaded: RollState | null;
  error: string;
  onSwapped: () => void;
  onCancel: () => void;
}) {
  const { tr } = useI18n();
  if (!job) return null;
  if (stage === "idle") {
    if (direct) return null;
    // browser: the print window can't be told which printer, so say it plainly
    return (
      <div className="no-print mx-2 mb-3 rounded-lg border border-line bg-sunken px-3 py-2 text-sm" role="note">
        <b>{tr("بنافذة الطباعة:", "In the print window:")}</b> {tr("الطابعة", "Printer")} <b className="ltr">{device}</b> · {tr("الهوامش «بلا»", "Margins “None”")} ·{" "}
        {tr("شيل «الرأس والتذييل»", "untick “Headers and footers”")}
      </div>
    );
  }
  if (stage === "swap") {
    const need = ROLL_NAME[job.kind];
    const have = ROLL_NAME[loaded?.roll ?? (job.kind === "label" ? "receipt" : "label")];
    return (
      <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
        <div className="card grid w-full max-w-sm gap-3 text-center">
          <div className="text-4xl" aria-hidden>
            🔄
          </div>
          <h2 className="text-lg font-bold">{tr("بدّل الرول أولاً", "Swap the roll first")}</h2>
          <p className="text-sm">
            {tr(`بالطابعة هلق ${have[0]}. هالطباعة بدها ${need[0]}.`, `The ${have[1]} is in the printer. This print needs the ${need[1]}.`)}
          </p>
          <ol className="grid gap-1 text-start text-sm">
            <li>1. {tr(`طلّع ${have[0]} وحط ${need[0]}`, `Take out the ${have[1]} and put in the ${need[1]}`)}</li>
            <li>2. {tr("سكّر الغطا واضغط FEED لحتى تزمّر", "Close the cover and hold FEED until it beeps")}</li>
            <li>3. {tr("اضغط «بدّلت، اطبع»", "Press “Swapped, print”")}</li>
          </ol>
          {loaded?.changedBy && (
            <p className="text-xs text-faint">
              {tr(`آخر تبديل: ${loaded.changedBy}`, `Last swapped by ${loaded.changedBy}`)}
            </p>
          )}
          <div className="grid gap-2">
            <button className="btn btn-primary min-h-[48px] text-base" onClick={onSwapped}>
              {tr("بدّلت، اطبع", "Swapped, print")}
            </button>
            <button className="btn btn-ghost" onClick={onCancel}>
              {tr("إلغاء", "Cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }
  const tone = stage === "error" ? "text-bad" : stage === "done" ? "text-good" : "text-muted";
  return (
    <div className={`no-print mx-2 mb-3 rounded-lg bg-sunken px-3 py-2 text-center text-sm font-semibold ${tone}`} role="status">
      {stage === "printing" && tr(`عم يطبع على ${device}…`, `Printing on ${device}…`)}
      {stage === "done" && tr(`انبعتت على ${device} ✓`, `Sent to ${device} ✓`)}
      {stage === "error" && (
        <>
          {tr("ما زبطت الطباعة", "Printing didn't work")}: {error || "—"}
          <button className="btn ms-2 px-2 py-1 text-xs" onClick={() => window.print()}>
            {tr("افتح نافذة الطباعة", "Open print window")}
          </button>
        </>
      )}
    </div>
  );
}

function Toolbar({ children, onPrint, onDialog }: { children?: ReactNode; onPrint?: () => void; onDialog?: () => void }) {
  const { tr } = useI18n();
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-surface p-2">
      <button className="btn btn-primary px-3 py-1.5" onClick={onPrint ?? (() => window.print())}>
        {tr("اطبع", "Print")}
      </button>
      {onDialog && (
        <button className="btn px-3 py-1.5" onClick={onDialog} title={tr("اختار الطابعة بنفسك", "Pick the printer yourself")}>
          {tr("نافذة الطباعة…", "Print window…")}
        </button>
      )}
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

function Logo({ s, className, style }: { s: AppSettings | null; className: string; style?: CSSProperties }) {
  return <img src={s?.business.logo || "/logo.png"} alt="" className={className} style={style} />;
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
  const sp2 = useSmartPrint(
    !!rc,
    size === "a4" ? "size: A4; margin: 12mm" : `size: ${PRINTABLE_MM[width] ?? width}mm 200mm; margin: 0`,
    size === "a4" ? null : { kind: "receipt", widthMm: PRINTABLE_MM[width] ?? width, heightMm: "auto" },
  );
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
    <div className="bg-white" dir={lang === "ar" ? "rtl" : "ltr"}>
      <Toolbar onPrint={sp2.print} onDialog={sp2.direct ? sp2.dialog : undefined}>
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
      {sp2.panel}
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

/** What a thermal head can actually burn: 58 mm paper → 48 mm, 80 mm paper → 72 mm. Wider content gets cut at the edge. */
const PRINTABLE_MM: Record<number, number> = { 58: 48, 80: 72 };

/** Content width and sideways shift for a thermal receipt, from Settings → Printing. */
export function receiptBox(p: Partial<AppSettings["printing"]> | undefined, width: number, override?: { side?: number; x?: number }) {
  const side = override?.side ?? p?.receiptSideMm ?? 4;
  const content = Math.max(30, Math.min(width - 2 * side, PRINTABLE_MM[width] ?? width - 8));
  return { content, x: override?.x ?? p?.receiptOffsetXMm ?? 0 };
}

/** Tahoma: crisp at small sizes on a 203 dpi head, and it has Arabic. Pure black, no smoothing greys. */
const RECEIPT_STYLE = { fontFamily: 'Tahoma, "Segoe UI", Arial, sans-serif', color: "#000", WebkitFontSmoothing: "none", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as const;
/** Logos are often grey line art; push them to solid black so the head prints them sharp. */
const LOGO_INK = { filter: "grayscale(1) contrast(4) brightness(0.85)" } as const;

/** "0944 123 456" → "963944123456" (Syrian local numbers get the country code), "+44…" / "0044…" → "44…". */
export function waDigits(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("0")) return `963${d.slice(1)}`;
  return d;
}

/** A QR code as one crisp SVG path (no image smoothing), sized in mm for the thermal head. */
function Qr({ text, sizeMm }: { text: string; sizeMm: number }) {
  const { n, d } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const count = q.getModuleCount();
    let path = "";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (q.isDark(r, c)) path += `M${c},${r}h1v1h-1z`;
    return { n: count, d: path };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm` }} shapeRendering="crispEdges" aria-hidden>
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Bottom of every receipt: thanks, then "chat / order on WhatsApp" with the number and a QR that opens the chat. */
function ReceiptFooter({ p, phone, lang }: { p: Partial<AppSettings["printing"]>; phone: string; lang: Lang }) {
  const t = L(lang);
  const wa = (p.receiptWhatsapp || phone || "").trim();
  const digits = wa ? waDigits(wa) : "";
  return (
    <>
      <div className="text-center text-[17px] font-bold">{lang === "ar" ? p.receiptFooterAr : p.receiptFooterEn}</div>
      {digits && (
        <div className="mt-2 flex items-center gap-2.5 rounded-[3px] border-2 border-black p-1.5">
          {p.receiptQr !== false && <Qr text={`https://wa.me/${digits}`} sizeMm={19} />}
          <div className={`min-w-0 flex-1 leading-tight ${p.receiptQr === false ? "text-center" : ""}`}>
            <div className="text-[14px] font-bold">{t("اطلب عبر واتساب", "Order on WhatsApp")}</div>
            <div className="num ltr mt-0.5 text-[16px] font-bold">{wa}</div>
            {p.receiptQr !== false && <div className="mt-0.5 text-[11px]">{t("امسح الكود لتراسلنا", "Scan to chat with us")}</div>}
          </div>
        </div>
      )}
    </>
  );
}

function ReceiptThermal({ rc, lang, s, width }: { rc: Receipt; lang: Lang; s: AppSettings | null; width: number }) {
  const t = L(lang);
  const pk = pickL(lang);
  const o = rc.order;
  const m = (v: number) => money(v, o.currency, lang);
  const bw = (v: number) => balanceWords(v, lang, o.fxRate, o.currency === "SYP");
  const box = receiptBox(rc.printing, width);
  const row = (a: ReactNode, b: ReactNode, strong = false) => (
    <div className={`flex items-baseline justify-between gap-2 ${strong ? "text-[16px] font-bold" : "text-[14px]"}`}>
      <span>{a}</span>
      <span className="num ltr whitespace-nowrap">{b}</span>
    </div>
  );
  const rule = <div className="my-2 border-t-2 border-black" />;
  const thin = <div className="my-1.5 border-t border-dashed border-black" />;
  return (
    <div
      id="print-root"
      className="mx-auto bg-white pb-2 pt-1 leading-snug"
      style={{ ...RECEIPT_STYLE, width: `${box.content}mm`, transform: box.x ? `translateX(${box.x}mm)` : undefined }}
    >
      <div className="text-center">
        <Logo s={s} className="mx-auto mb-1.5 h-16 w-auto" style={LOGO_INK} />
        <div className="text-[22px] font-bold leading-tight">{pk(rc.business)}</div>
        {rc.printing.receiptSocial && <div className="mt-0.5 text-[14px] font-bold">{rc.printing.receiptSocial}</div>}
        {rc.business.address && <div className="text-[13px]">{rc.business.address}</div>}
        {rc.business.phone && (
          <div className="mt-0.5 text-[14px]">
            ☎ <span className="ltr">{rc.business.phone}</span>
          </div>
        )}
      </div>
      {rule}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[17px] font-bold">
          {t("فاتورة", "Invoice")} <span className="num ltr">#{o.number}</span>
        </span>
        <span className="num ltr whitespace-nowrap text-[13px]">{dateL(lang, o.createdAt ?? o.businessDate, true)}</span>
      </div>
      {rc.client && <div className="mt-0.5 text-[14px]">{t("الزبون", "Client")}: <b>{rc.client.name}</b></div>}
      {o.type !== "normal" && <div className="mt-0.5 text-[14px] font-bold">{discountWords(o.type, t) || o.type}</div>}
      {o.status === "cancelled" && <Cancelled lang={lang} />}
      {rule}
      {rc.lines.map((l, i) => (
        <div key={l.id}>
          {i > 0 && thin}
          <div className="text-[15px] font-bold leading-tight">{pk(l)}</div>
          {lineOptions(l, lang) && <div className="text-[13px]">+ {lineOptions(l, lang)}</div>}
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="num ltr text-[14px]">
              {l.qty} × {m(l.unitPrice)}
              {l.freeQty > 0 && <span className="text-[12px]"> ({t(`${l.freeQty} مجاناً`, `${l.freeQty} free`)})</span>}
            </span>
            <span className="num ltr whitespace-nowrap text-[15px] font-bold">{m(l.lineTotal)}</span>
          </div>
        </div>
      ))}
      {rule}
      {row(
        t("عدد الأصناف / القطع", "Items / pieces"),
        `${rc.lines.length} / ${rc.lines.reduce((n, l) => n + l.qty, 0)}`,
      )}
      {row(t("المجموع الفرعي", "Subtotal"), m(o.subtotal))}
      {o.discount > 0 && row(`${t("خصم", "Discount")}${o.discountReason ? ` (${discountWords(o.discountReason, t)})` : ""}`, `− ${m(o.discount)}`)}
      {o.taxes.map((x) => row(`${pk(x)}${x.kind === "percent" ? ` ${x.value}%` : ""}`, m(x.amount)))}
      {o.deliveryFee > 0 && row(t("التوصيل", "Delivery"), m(o.deliveryFee))}
      <div className="my-2 flex items-baseline justify-between gap-2 border-y-[4px] border-double border-black py-1.5">
        <span className="text-[18px] font-bold">{t("المجموع", "TOTAL")}</span>
        <span className="num ltr whitespace-nowrap text-[23px] font-bold">{m(o.total)}</span>
      </div>
      {o.currency === "SYP" && o.fxRate ? <div className="text-end text-[13px] num ltr">≈ {usd(o.totalUsd)}</div> : null}
      {o.method && row(t("طريقة الدفع", "Payment"), pk(o.method))}
      {rc.payment.paid > 0 && row(t("المدفوع", "Paid"), m(rc.payment.paid))}
      {rc.payment.remaining > 0 && row(t("الباقي على الحساب", "Remaining on account"), m(rc.payment.remaining), true)}
      {rc.account && (
        <>
          {thin}
          {row(t("الرصيد السابق", "Previous balance"), bw(rc.account.beforeUsd))}
          {row(t("الرصيد الجديد", "New balance"), bw(rc.account.afterUsd), true)}
        </>
      )}
      {rc.loyalty?.enabled && (
        <div className="mt-1.5 text-center text-[13px]">
          {t("الولاء", "Loyalty")}:{" "}
          <span className="num ltr">
            {rc.loyalty.progress} / {rc.loyalty.buyQty}
          </span>
          {rc.loyalty.available > 0 && ` · ${t(`لك ${rc.loyalty.available} مجاناً`, `${rc.loyalty.available} free waiting`)}`}
        </div>
      )}
      {rule}
      <ReceiptFooter p={rc.printing} phone={rc.business.phone ?? ""} lang={lang} />
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

/** Settings → Printing: shift (+ right / down) and inner margin, all in mm. */
interface LabelMargins {
  x: number;
  y: number;
  pad: number;
}
const labelMargins = (p?: AppSettings["printing"]): LabelMargins => ({ x: p?.labelOffsetXMm ?? 0, y: p?.labelOffsetYMm ?? 0, pad: p?.labelPaddingMm ?? 1.2 });

/** One label page: the paper stays put, the content moves by the saved shift. `frame` draws the content's edge (for tests). */
function LabelBox({ w, h, m, children, frame, className = "border border-dashed border-gray-400 print:border-0", pageBreak = true }: { w: number; h: number; m: LabelMargins; children: ReactNode; frame?: boolean; className?: string; pageBreak?: boolean }) {
  return (
    <div
      className={`overflow-hidden bg-white text-black ${className}`}
      style={{ width: `${w}mm`, height: `${h}mm`, ...(pageBreak ? { pageBreakAfter: "always" as const, breakAfter: "page" as const } : {}) }}
    >
      <div className="flex h-full w-full flex-col justify-between" style={{ padding: `${m.pad}mm`, transform: m.x || m.y ? `translate(${m.x}mm, ${m.y}mm)` : undefined }}>
        {frame ? <div className="flex h-full w-full flex-col justify-between border border-black p-[0.6mm]">{children}</div> : children}
      </div>
    </div>
  );
}

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
  const sp2 = useSmartPrint(!!all.data && !!s && labels.length > 0, `size: ${w}mm ${h}mm; margin: 0`, { kind: "label", widthMm: w, heightMm: h });
  if (!all.data || !s) return <Loading />;
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="bg-white">
      <Toolbar onPrint={sp2.print} onDialog={sp2.direct ? sp2.dialog : undefined}>
        <span className="text-sm text-muted">{ui.tr(`${labels.length} ملصق · ${w}×${h} ملم`, `${labels.length} labels · ${w}×${h} mm`)}</span>
      </Toolbar>
      {sp2.panel}
      {labels.length === 0 && <p className="p-6 text-center text-faint">{ui.tr("ما في دفعات", "No batches")}</p>}
      <div className="flex flex-col items-center gap-2 print:block print:gap-0">
        {labels.map(({ b, key }) => (
          <LabelBox key={key} w={w} h={h} m={labelMargins(s.printing)}>
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
            <Barcode value={b.batchCode} height={Math.max(12, Math.round(h * 0.45))} />
          </LabelBox>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Printer test (receipt or label)                                     */
/* ------------------------------------------------------------------ */

/**
 * One sample receipt or label at the sizes in the URL (so a size can be tried before saving).
 * The edge marks show whether anything is cut off; the barcode shows whether it scans.
 */
export function PrintTest() {
  const [sp] = useSearchParams();
  const ui = useI18n();
  const { tr } = ui;
  const { s } = useAppSettings();
  const kind = sp.get("kind") === "label" ? "label" : "receipt";
  const clamp = (v: string | null, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Number(v) || d));
  const width = clamp(sp.get("width"), 58, 80, s?.printing.receiptWidthMm ?? 58) === 80 ? 80 : 58;
  const w = clamp(sp.get("w"), 20, 120, s?.printing.labelWidthMm ?? 50);
  const h = clamp(sp.get("h"), 15, 120, s?.printing.labelHeightMm ?? 30);
  // margins from the URL too, so the Settings screen can test them before saving
  const num0 = (k: string, lo: number, hi: number, d: number) => {
    const v = sp.get(k);
    return v === null || v === "" || !Number.isFinite(Number(v)) ? d : Math.min(hi, Math.max(lo, Number(v)));
  };
  const saved = labelMargins(s?.printing);
  const m: LabelMargins = { x: num0("ox", -15, 15, saved.x), y: num0("oy", -15, 15, saved.y), pad: num0("pad", 0, 8, saved.pad) };
  const box = receiptBox(s?.printing, width, { side: num0("rm", 0, 10, s?.printing.receiptSideMm ?? 4), x: num0("rx", -15, 15, s?.printing.receiptOffsetXMm ?? 0) });
  const sp2 = useSmartPrint(
    !!s,
    kind === "label" ? `size: ${w}mm ${h}mm; margin: 0` : `size: ${PRINTABLE_MM[width] ?? width}mm 200mm; margin: 0`,
    kind === "label" ? { kind: "label", widthMm: w, heightMm: h } : { kind: "receipt", widthMm: PRINTABLE_MM[width] ?? width, heightMm: "auto" },
  );
  if (!s) return <Loading />;
  const now = new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const item = (name: string, qty: string, total: string) => (
    <div className="mb-1.5">
      <div className="text-[15px] font-bold leading-tight">{name}</div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num ltr text-[14px]">{qty}</span>
        <span className="num ltr text-[15px] font-bold">{total}</span>
      </div>
    </div>
  );
  return (
    <div className="bg-white" dir={ui.lang === "ar" ? "rtl" : "ltr"}>
      <Toolbar onPrint={sp2.print} onDialog={sp2.direct ? sp2.dialog : undefined}>
        <span className="text-sm text-muted">
          {kind === "label" ? tr(`ملصق تجربة · ${w}×${h} ملم`, `Test label · ${w}×${h} mm`) : tr(`فاتورة تجربة · ${width} ملم`, `Test invoice · ${width} mm`)}
        </span>
      </Toolbar>
      {sp2.panel}
      {kind === "label" ? (
        <div className="flex justify-center">
          <LabelBox w={w} h={h} m={m} frame className="border border-dashed border-gray-400 print:border-0" pageBreak={false}>
            <div className="flex justify-between text-[6pt] leading-none" dir="ltr">
              <span>┌ TEST</span>
              <span>{w}×{h}</span>
              <span>┐</span>
            </div>
            <div className="text-center leading-tight">
              <div className="truncate text-[9pt] font-bold" dir="rtl">
                كرواسان زعتر
              </div>
              <div className="truncate text-[7pt]" dir="ltr">
                Zaatar croissant · $1.50
              </div>
            </div>
            <Barcode value="TEST-123456" height={Math.max(14, Math.round(h * 0.45))} />
          </LabelBox>
        </div>
      ) : (
        <div
          id="print-root"
          className="mx-auto bg-white pb-2 pt-1 leading-snug"
          style={{ ...RECEIPT_STYLE, width: `${box.content}mm`, transform: box.x ? `translateX(${box.x}mm)` : undefined }}
        >
          {/* edge bars: both must print fully, or move it with Settings → Printing */}
          <div className="flex justify-between text-[12px] font-bold" dir="ltr">
            <span>|◄ EDGE</span>
            <span>EDGE ►|</span>
          </div>
          <div className="border-t-[3px] border-black" />
          <div className="mt-2 text-center">
            <Logo s={s} className="mx-auto mb-1.5 h-16 w-auto" style={LOGO_INK} />
            <div className="text-[21px] font-bold leading-tight">{ui.pick(s.business)}</div>
            <div className="mt-0.5 text-[14px] font-bold">{tr("فاتورة تجربة", "TEST INVOICE")}</div>
          </div>
          <div className="my-2 border-t-2 border-black" />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[17px] font-bold">
              {tr("فاتورة", "Invoice")} <span className="num ltr">#0000</span>
            </span>
            <span className="num ltr whitespace-nowrap text-[13px]">{now}</span>
          </div>
          <div className="my-2 border-t-2 border-black" />
          {item("كرواسان زعتر", "2 × $1.50", "$3.00")}
          {item("Turkey & Cheddar", "1 × $4.25", "$4.25")}
          {item("قهوة عربية", "3 × 15,000", "45,000 ل.س")}
          <div className="my-2 flex items-baseline justify-between gap-2 border-y-[4px] border-double border-black py-1.5">
            <span className="text-[18px] font-bold">{tr("المجموع", "TOTAL")}</span>
            <span className="num ltr text-[23px] font-bold">$10.75</span>
          </div>
          <div className="mb-2 text-center text-[13px] font-bold">{tr("إذا الحافتين مطبوعين كاملين، الإعداد صح ✓", "Both EDGE marks fully printed = setup is right ✓")}</div>
          <ReceiptFooter p={s.printing} phone={s.business.phone ?? ""} lang={ui.lang} />
          <div className="mt-1 text-center text-[12px] num ltr">
            {width} mm · {box.content} mm {tr("عرض الطباعة", "print width")} · {box.x >= 0 ? "+" : ""}
            {box.x} mm
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Product price labels                                                */
/* ------------------------------------------------------------------ */

interface LabelProduct {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  price: number;
  currency: Currency;
}

/** `?items=<productId>:<copies>,…` — name, price and the product code as a barcode that New Order scans. */
export function PrintProductLabels() {
  const [sp] = useSearchParams();
  const ui = useI18n();
  const { s } = useAppSettings();
  const wanted = useMemo(
    () =>
      (sp.get("items") ?? "")
        .split(",")
        .map((x) => x.split(":"))
        .filter(([id]) => !!id)
        .map(([id, n]) => ({ id: id ?? "", n: Math.max(1, Math.min(500, Math.round(Number(n) || 1))) })),
    [sp],
  );
  const prods = useData<{ rows: LabelProduct[] }>("/menu/products");
  const w = s?.printing.labelWidthMm ?? 50;
  const h = s?.printing.labelHeightMm ?? 30;
  const byId = new Map((prods.data?.rows ?? []).map((p) => [p.id, p]));
  const labels = wanted.flatMap(({ id, n }) => {
    const p = byId.get(id);
    return p ? Array.from({ length: n }, (_, i) => ({ p, key: `${id}-${i}` })) : [];
  });
  const sp2 = useSmartPrint(!!prods.data && !!s && labels.length > 0, `size: ${w}mm ${h}mm; margin: 0`, { kind: "label", widthMm: w, heightMm: h });
  if (prods.error) return <p className="p-6 text-bad">{ui.err(prods.error)}</p>;
  if (!prods.data || !s) return <Loading />;
  return (
    <div className="bg-white">
      <Toolbar onPrint={sp2.print} onDialog={sp2.direct ? sp2.dialog : undefined}>
        <span className="text-sm text-muted">{ui.tr(`${labels.length} ملصق سعر · ${w}×${h} ملم`, `${labels.length} price labels · ${w}×${h} mm`)}</span>
      </Toolbar>
      {sp2.panel}
      {labels.length === 0 && <p className="p-6 text-center text-faint">{ui.tr("ما في منتجات", "No products")}</p>}
      <div className="flex flex-col items-center gap-2 print:block print:gap-0">
        {labels.map(({ p, key }) => (
          <LabelBox key={key} w={w} h={h} m={labelMargins(s.printing)}>
            <div className="text-center leading-tight">
              <div className="truncate text-[9pt] font-bold" dir="rtl">
                {p.nameAr}
              </div>
              <div className="truncate text-[7pt]" dir="ltr">
                {p.nameEn}
              </div>
            </div>
            <div className="text-center text-[13pt] font-black leading-none num ltr">{money(p.price, p.currency, "en")}</div>
            <Barcode value={p.code} height={Math.max(12, Math.round(h * 0.4))} />
          </LabelBox>
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
/* Branded page frame (client report, clients sheet)                   */
/* ------------------------------------------------------------------ */

/** A4 page with the shop's logo and name across the top in the brand colour. Save as PDF from the print dialog. */
function BrandedPage({ lang, s, title, right, children }: { lang: Lang; s: AppSettings | null; title: string; right: ReactNode; children: ReactNode }) {
  const t = L(lang);
  return (
    <div className="mx-auto max-w-[186mm] p-2 text-[12px] text-black" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
      <div className="flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-white" style={{ background: "linear-gradient(135deg, rgb(210 86 26), rgb(171 61 12))" }}>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white p-1">
            <Logo s={s} className="h-12 w-auto" />
          </div>
          <div>
            <div className="text-lg font-bold">{s ? pickL(lang)(s.business) : "JJ's"}</div>
            <div className="text-[13px] opacity-90">{title}</div>
          </div>
        </div>
        <div className="text-end text-[12px]">{right}</div>
      </div>
      {children}
      <div className="mt-6 flex justify-between border-t border-gray-300 pt-2 text-[10px] text-gray-500">
        <span>{s?.business.phone ? <span className="ltr">{s.business.phone}</span> : null}</span>
        <span>
          {t("طُبع", "Printed")} {dateL(lang, new Date().toISOString(), true)}
        </span>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-lg border border-gray-300 px-3 py-2">
      <div className="text-[11px] text-gray-600">{label}</div>
      <div className={`text-[16px] font-bold num ltr text-start ${tone === "bad" ? "text-[#c0392b]" : tone === "good" ? "text-[#2e7d4f]" : ""}`}>{value}</div>
    </div>
  );
}

const thCls = "py-1.5 px-1 text-start font-semibold";
const headRow = "border-b-2 border-[rgb(210,86,26)] bg-[#fbeee6]";

/* ------------------------------------------------------------------ */
/* Full client report (branded PDF)                                    */
/* ------------------------------------------------------------------ */

interface ClientReport extends Statement {
  orders: (Statement["orders"][number] & { totalUsd: number; paidAmount: number; fxRate: number | null; paymentStatus: string })[];
  products: { nameAr: string; nameEn: string; qty: number; usd: number }[];
  summary: { orders: number; items: number; boughtUsd: number; paidOnSpotUsd: number; paymentsUsd: number; returnsUsd: number; returnedQty: number };
}

/** Everything about one client over a period: what they took, what they paid, what came back, and the balance. */
export function PrintClientReport() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const ui = useI18n();
  const { s } = useAppSettings();
  const from = sp.get("from") ?? `${today().slice(0, 8)}01`;
  const to = sp.get("to") ?? today();
  const d = useData<ClientReport>(`/clients/${id}/statement?from=${from}&to=${to}`);
  usePrintOnce(!!d.data, "size: A4; margin: 10mm");
  if (d.error) return <p className="p-6 text-bad">{ui.err(d.error)}</p>;
  if (!d.data) return <Loading />;
  const r = d.data;
  const lang: Lang = ui.lang;
  const t = L(lang);
  const pk = pickL(lang);
  const owes = r.closingUsd < -0.009;
  const paidOf = (o: ClientReport["orders"][number]) => Math.min(o.totalUsd, o.currency === "USD" ? o.paidAmount : o.fxRate ? o.paidAmount / o.fxRate : 0);
  return (
    <div className="bg-white" dir={lang === "ar" ? "rtl" : "ltr"}>
      <Toolbar>
        <span className="text-sm text-muted">{ui.tr("للحفظ PDF: اطبع ← اختر «حفظ كـ PDF»", "To save a PDF: Print → choose “Save as PDF”")}</span>
      </Toolbar>
      <BrandedPage
        lang={lang}
        s={s}
        title={t("تقرير الزبون", "Client report")}
        right={
          <>
            <div className="text-[15px] font-bold">{r.client.name}</div>
            {r.client.phone && <div className="ltr">{r.client.phone}</div>}
            <div>
              {dateL(lang, r.from)} → {dateL(lang, r.to)}
            </div>
          </>
        }
      >
        {(r.client.contactPerson || r.client.address) && (
          <p className="mt-2 text-gray-700">
            {r.client.contactPerson && `${t("المسؤول", "Manager")}: ${r.client.contactPerson}`}
            {r.client.contactPerson && r.client.address && " · "}
            {r.client.address}
          </p>
        )}

        <div className="mt-3 grid grid-cols-4 gap-2">
          <Kpi label={t("الطلبات", "Orders")} value={String(r.summary.orders)} />
          <Kpi label={t("القطع", "Pieces")} value={fq(r.summary.items)} />
          <Kpi label={t("اشترى بقيمة", "Bought for")} value={usd(r.summary.boughtUsd)} />
          <Kpi label={t("دفع", "Paid")} value={usd(r.summary.paidOnSpotUsd + r.summary.paymentsUsd)} tone="good" />
          <Kpi label={t("رجّع", "Returned")} value={`${fq(r.summary.returnedQty)} · ${usd(r.summary.returnsUsd)}`} />
          <Kpi label={r.openingUsd < -0.009 ? t("عليه أول الفترة", "Owed at the start") : t("رصيده أول الفترة", "Balance at the start")} value={usd(Math.abs(r.openingUsd))} />
          <div className="col-span-2">
            <Kpi label={owes ? t("عليه هلق", "Owes now") : t("رصيده هلق", "Balance now")} value={usd(Math.abs(r.closingUsd))} tone={owes ? "bad" : "good"} />
          </div>
        </div>

        <h3 className="mb-1 mt-4 text-[13px] font-bold">{t("شو أخد", "What they took")}</h3>
        <table className="w-full border-collapse">
          <thead>
            <tr className={headRow}>
              <th className={thCls}>{t("المنتج", "Product")}</th>
              <th className={`${thCls} text-end`}>{t("الكمية", "Qty")}</th>
              <th className={`${thCls} text-end`}>{t("القيمة", "Value")}</th>
            </tr>
          </thead>
          <tbody>
            {r.products.length === 0 && (
              <tr>
                <td className="py-1 text-gray-500" colSpan={3}>
                  —
                </td>
              </tr>
            )}
            {r.products.map((p, i) => (
              <tr key={i} className="border-b border-gray-200">
                <td className="px-1 py-1">{pk(p)}</td>
                <td className="px-1 py-1 text-end num">{fq(p.qty)}</td>
                <td className="px-1 py-1 text-end num ltr">{usd(p.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 text-[13px] font-bold">{t("الفواتير", "Invoices")}</h3>
        <table className="w-full border-collapse">
          <thead>
            <tr className={headRow}>
              <th className={thCls}>#</th>
              <th className={thCls}>{t("التاريخ", "Date")}</th>
              <th className={`${thCls} text-end`}>{t("قطع", "Pcs")}</th>
              <th className={`${thCls} text-end`}>{t("المبلغ", "Amount")}</th>
              <th className={`${thCls} text-end`}>{t("دفع وقتها", "Paid then")}</th>
              <th className={`${thCls} text-end`}>{t("الباقي", "Left")}</th>
            </tr>
          </thead>
          <tbody>
            {r.orders.length === 0 && (
              <tr>
                <td className="py-1 text-gray-500" colSpan={6}>
                  —
                </td>
              </tr>
            )}
            {r.orders.map((o) => (
              <tr key={o.id} className="border-b border-gray-200">
                <td className="px-1 py-1 num">{o.number}</td>
                <td className="px-1 py-1">{dateL(lang, o.date)}</td>
                <td className="px-1 py-1 text-end num">{o.itemsCount}</td>
                <td className="px-1 py-1 text-end num ltr">{money(o.total, o.currency, lang)}</td>
                <td className="px-1 py-1 text-end num ltr">{usd(paidOf(o))}</td>
                <td className="px-1 py-1 text-end num ltr">{o.totalUsd - paidOf(o) > 0.009 ? usd(o.totalUsd - paidOf(o)) : "✓"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 mt-4 text-[13px] font-bold">{t("حركة الحساب (دفعات ومرتجعات)", "Account moves (payments and returns)")}</h3>
        <table className="w-full border-collapse">
          <thead>
            <tr className={headRow}>
              <th className={thCls}>{t("التاريخ", "Date")}</th>
              <th className={thCls}>{t("البيان", "Details")}</th>
              <th className={`${thCls} text-end`}>{t("عليه", "Debit")}</th>
              <th className={`${thCls} text-end`}>{t("له", "Credit")}</th>
              <th className={`${thCls} text-end`}>{t("الرصيد", "Balance")}</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-200">
                <td className="whitespace-nowrap px-1 py-1">{dateL(lang, l.businessDate)}</td>
                <td className="px-1 py-1">
                  {t(...(MOVE_LABEL[l.type] ?? [l.type, l.type]))} {l.note && <span className="text-gray-600">{l.note}</span>}
                </td>
                <td className="px-1 py-1 text-end num ltr">{l.amountUsd < 0 ? usd(-l.amountUsd) : ""}</td>
                <td className="px-1 py-1 text-end num ltr">{l.amountUsd > 0 ? usd(l.amountUsd) : ""}</td>
                <td className="px-1 py-1 text-end num ltr">{l.balanceUsd < -0.009 ? `${usd(-l.balanceUsd)} ${t("عليه", "due")}` : usd(l.balanceUsd)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-black font-bold">
              <td className="px-1 py-1.5" colSpan={4}>
                {t("الرصيد الختامي", "Closing balance")}
              </td>
              <td className="px-1 py-1.5 text-end num ltr">{owes ? `${usd(-r.closingUsd)} ${t("عليه", "due")}` : usd(r.closingUsd)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-center text-[11px] text-gray-600">{t("المبالغ بالدولار حسب سعر يوم كل عملية.", "Amounts in USD at each day's rate.")}</p>
      </BrandedPage>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Clients sheet: who took what between two moments                    */
/* ------------------------------------------------------------------ */

interface ClientsSheet {
  from: string;
  to: string;
  rate: number | null;
  rows: { clientId: string | null; name: string | null; orders: number; items: number; products: { nameAr: string; nameEn: string; qty: number }[]; totalUsd: number; paidUsd: number; leftUsd: number }[];
  totals: { orders: number; items: number; totalUsd: number; paidUsd: number; leftUsd: number };
}

export function PrintClientsSheet() {
  const [sp] = useSearchParams();
  const ui = useI18n();
  const { s } = useAppSettings();
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const d = useData<ClientsSheet>(from && to ? `/reports/clients-sheet?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : null);
  usePrintOnce(!!d.data, "size: A4; margin: 10mm");
  if (d.error) return <p className="p-6 text-bad">{ui.err(d.error)}</p>;
  if (!d.data) return <Loading />;
  const r = d.data;
  const lang = ui.lang;
  const t = L(lang);
  const pk = pickL(lang);
  return (
    <div className="bg-white" dir={lang === "ar" ? "rtl" : "ltr"}>
      <Toolbar />
      <BrandedPage
        lang={lang}
        s={s}
        title={t("كشف الزبائن", "Clients sheet")}
        right={
          <>
            <div>{dateL(lang, r.from, true)}</div>
            <div>→ {dateL(lang, r.to, true)}</div>
          </>
        }
      >
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className={headRow}>
              <th className={thCls}>#</th>
              <th className={thCls}>{t("الزبون", "Client")}</th>
              <th className={thCls}>{t("شو أخد", "What they took")}</th>
              <th className={`${thCls} text-end`}>{t("الكمية", "Qty")}</th>
              <th className={`${thCls} text-end`}>{t("المبلغ", "Amount")}</th>
              <th className={`${thCls} text-end`}>{t("دفع", "Paid")}</th>
              <th className={`${thCls} text-end`}>{t("الباقي", "Left")}</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length === 0 && (
              <tr>
                <td className="py-3 text-center text-gray-500" colSpan={7}>
                  {t("ما في طلبات بهالوقت", "No orders in this time")}
                </td>
              </tr>
            )}
            {r.rows.map((x, i) => (
              <tr key={x.clientId ?? "walkin"} className="border-b border-gray-200 align-top">
                <td className="px-1 py-1.5 num text-gray-500">{i + 1}</td>
                <td className="px-1 py-1.5 font-semibold">{x.name ?? t("زبائن عابرين", "Walk-ins")}</td>
                <td className="px-1 py-1.5 text-[11px]">{x.products.map((p) => `${fq(p.qty)} × ${pk(p)}`).join("، ")}</td>
                <td className="px-1 py-1.5 text-end num">{fq(x.items)}</td>
                <td className="px-1 py-1.5 text-end num ltr">{usd(x.totalUsd)}</td>
                <td className="px-1 py-1.5 text-end num ltr text-[#2e7d4f]">{usd(x.paidUsd)}</td>
                <td className={`px-1 py-1.5 text-end num ltr ${x.leftUsd > 0.009 ? "font-bold text-[#c0392b]" : ""}`}>{x.leftUsd > 0.009 ? usd(x.leftUsd) : "✓"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black text-[13px] font-bold">
              <td className="px-1 py-2" colSpan={3}>
                {t("المجموع", "Total")} · {t(`${r.totals.orders} طلب`, `${r.totals.orders} orders`)}
              </td>
              <td className="px-1 py-2 text-end num">{fq(r.totals.items)}</td>
              <td className="px-1 py-2 text-end num ltr">{usd(r.totals.totalUsd)}</td>
              <td className="px-1 py-2 text-end num ltr text-[#2e7d4f]">{usd(r.totals.paidUsd)}</td>
              <td className="px-1 py-2 text-end num ltr text-[#c0392b]">{usd(r.totals.leftUsd)}</td>
            </tr>
          </tfoot>
        </table>
        {r.rate ? (
          <p className="mt-2 text-[11px] text-gray-600">
            {t("المجموع بالليرة", "Total in SYP")}: <span className="num">{money(r.totals.totalUsd * r.rate, "SYP", lang)}</span>
          </p>
        ) : null}
      </BrandedPage>
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
