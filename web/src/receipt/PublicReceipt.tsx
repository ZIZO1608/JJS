import { useEffect, useMemo, useState, type ReactNode } from "react";
import { money, usd, type Currency } from "../lib/format";
import { waDigits } from "../lib/print";
import { discountWords } from "../pages/orders/shared";

/**
 * The digital receipt a client opens from the QR code on their printed receipt: /r/<signed link>.
 * No login. It shows that one receipt and nothing else, and works on any phone.
 */

type Lang = "ar" | "en";
type Named = { nameAr: string; nameEn: string };

interface PublicReceipt {
  business: Named & { phone?: string; address?: string; logo?: string };
  contact: { whatsapp: string; social: string; footerAr: string; footerEn: string };
  order: {
    number: number;
    createdAt?: string;
    businessDate: string;
    type: "normal" | "trial" | "staff" | "internal";
    status: "confirmed" | "delivered" | "cancelled";
    currency: Currency;
    subtotal: number;
    discount: number;
    discountReason: string;
    taxes: (Named & { kind: string; value: number; amount: number })[];
    deliveryFee: number;
    total: number;
    totalUsd: number;
    fxRate: number | null;
    fulfilment: "pickup" | "delivery";
    method: Named | null;
  };
  lines: (Named & { id: string; qty: number; freeQty: number; unitPrice: number; lineTotal: number; options: Named[] })[];
  client: { name: string; language: Lang } | null;
  payment: { paid: number; remaining: number };
  loyalty: { enabled: boolean; buyQty: number; progress: number; available: number } | null;
}

type State = { kind: "loading" } | { kind: "ok"; rc: PublicReceipt } | { kind: "test" } | { kind: "invalid" } | { kind: "offline" };

const CSS = `
@keyframes rc-up { from { opacity: 0; transform: translateY(18px) scale(.98) } to { opacity: 1; transform: none } }
@keyframes rc-pop { 0% { opacity: 0; transform: rotate(-8deg) scale(1.6) } 70% { opacity: 1; transform: rotate(-8deg) scale(.95) } 100% { transform: rotate(-8deg) scale(1) } }
.rc-up { animation: rc-up .55s cubic-bezier(.2,.8,.2,1) both }
.rc-pop { animation: rc-pop .5s .45s cubic-bezier(.2,.8,.2,1) both }
.rc-edge { -webkit-mask: radial-gradient(circle 7px at 50% 100%, #0000 98%, #000) 50% 0 / 18px 100% repeat-x; mask: radial-gradient(circle 7px at 50% 100%, #0000 98%, #000) 50% 0 / 18px 100% repeat-x }
@media (prefers-reduced-motion: reduce) { .rc-up, .rc-pop { animation: none } }
@media print { .rc-noprint { display: none !important } body, .rc-bg { background: #fff !important } .rc-paper { box-shadow: none !important } }
`;

const tr = (lang: Lang) => (ar: string, en: string) => (lang === "ar" ? ar : en);
const pick = (lang: Lang) => (o: Named) => (lang === "ar" ? o.nameAr || o.nameEn : o.nameEn || o.nameAr);
const when = (lang: Lang, iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleString(lang === "ar" ? "ar-SY-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function PublicReceiptPage({ linkKey }: { linkKey: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [lang, setLang] = useState<Lang>(() => (navigator.language?.toLowerCase().startsWith("en") ? "en" : "ar"));

  useEffect(() => {
    if (linkKey === "test") {
      setState({ kind: "test" });
      return;
    }
    let alive = true;
    fetch(`/api/public/receipts/${encodeURIComponent(linkKey)}`, { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 404) return setState({ kind: "invalid" });
        if (!r.ok) return setState({ kind: "offline" });
        const body = (await r.json()) as { receipt: PublicReceipt };
        setState({ kind: "ok", rc: body.receipt });
        if (body.receipt.client?.language) setLang(body.receipt.client.language);
      })
      .catch(() => alive && setState({ kind: "offline" }));
    return () => {
      alive = false;
    };
  }, [linkKey]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    if (state.kind === "ok") document.title = `${pick(lang)(state.rc.business)} · #${state.rc.order.number}`;
  }, [lang, state]);

  const t = tr(lang);
  return (
    <div className="rc-bg min-h-screen px-4 pb-10 pt-4 text-[#141312]" style={{ background: "radial-gradient(120% 60% at 50% 0%, #3a2a1f 0%, #141312 60%)" }} dir={lang === "ar" ? "rtl" : "ltr"}>
      <style>{CSS}</style>
      <div className="rc-noprint mx-auto flex max-w-md justify-end">
        <div className="inline-flex rounded-full bg-white/10 p-0.5 text-sm font-semibold text-white backdrop-blur" role="group" aria-label="Language">
          {(["ar", "en"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setLang(k)} aria-pressed={lang === k} className={`min-h-[36px] min-w-[44px] rounded-full px-3 transition-colors ${lang === k ? "bg-white text-[#141312]" : "text-white/80"}`}>
              {k === "ar" ? "عربي" : "EN"}
            </button>
          ))}
        </div>
      </div>
      <main className="mx-auto mt-3 max-w-md">
        {state.kind === "loading" && <Skeleton />}
        {state.kind === "ok" && <Receipt rc={state.rc} lang={lang} linkKey={linkKey} />}
        {state.kind === "test" && <Message icon="✓" title={t("كود QR شغّال!", "The QR code works!")} text={t("هيك رح يفتح الزبون فاتورته الحقيقية من تلفونه.", "This is where a client will see their real receipt on their phone.")} />}
        {state.kind === "invalid" && <Message icon="🧾" title={t("ما لقينا هالفاتورة", "We couldn't find this receipt")} text={t("يمكن الرابط ناقص. جرّب تمسح الكود مرة تانية.", "The link may be incomplete. Try scanning the code again.")} />}
        {state.kind === "offline" && (
          <Message icon="📶" title={t("ما قدرنا نفتح الفاتورة", "Couldn't open the receipt")} text={t("تأكد من الإنترنت وجرّب كمان مرة.", "Check your internet connection and try again.")}>
            <button type="button" className="mt-4 min-h-[44px] rounded-full bg-[#141312] px-5 font-semibold text-white" onClick={() => window.location.reload()}>
              {t("جرّب مرة تانية", "Try again")}
            </button>
          </Message>
        )}
      </main>
    </div>
  );
}

function Receipt({ rc, lang, linkKey }: { rc: PublicReceipt; lang: Lang; linkKey: string }) {
  const t = tr(lang);
  const pk = pick(lang);
  const o = rc.order;
  const m = (v: number) => money(v, o.currency, lang);
  const cancelled = o.status === "cancelled";
  const status = useMemo(() => {
    if (cancelled) return { label: t("ملغاة", "Cancelled"), cls: "bg-[#fde2e1] text-[#a1231b]", stamp: t("ملغاة", "CANCELLED") };
    if (o.total <= 0.009) return { label: t("مجانية", "Free"), cls: "bg-[#e3f4e8] text-[#17663a]", stamp: "" };
    if (rc.payment.remaining <= 0.009) return { label: t("مدفوعة ✓", "Paid ✓"), cls: "bg-[#e3f4e8] text-[#17663a]", stamp: t("مدفوعة", "PAID") };
    if (rc.payment.paid > 0.009) return { label: t("مدفوعة جزئياً", "Part paid"), cls: "bg-[#fff1d6] text-[#8a5a00]", stamp: "" };
    return { label: t("على الحساب", "On account"), cls: "bg-[#ece9e6] text-[#3d3935]", stamp: "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, cancelled, o.total, rc.payment.paid, rc.payment.remaining]);
  const pieces = rc.lines.reduce((n, l) => n + l.qty, 0);
  const wa = waDigits((rc.contact.whatsapp || rc.business.phone || "").trim());
  const url = `${window.location.origin}/r/${linkKey}`;
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const title = `${pk(rc.business)} · ${t("فاتورة", "Receipt")} #${o.number}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${title} · ${m(o.total)}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the person closed the share sheet, or the clipboard is blocked: nothing to do */
    }
  };

  const row = (label: ReactNode, value: ReactNode, strong = false) => (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-3 py-0.5 ${strong ? "font-bold" : "text-[#5c5650]"}`}>
      <span>{label}</span>
      <span className="ms-auto whitespace-nowrap tabular-nums" dir="ltr">
        {value}
      </span>
    </div>
  );

  return (
    <>
      <article className="rc-up rc-paper relative overflow-hidden rounded-t-[22px] bg-[#fffdf9] shadow-[0_30px_60px_-20px_rgba(0,0,0,.6)]">
        {/* Header */}
        <header className="relative bg-[#141312] px-5 pb-6 pt-6 text-center text-white">
          <div className="mx-auto grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-white p-1.5 shadow-lg">
            <img src={rc.business.logo || "/logo.png"} alt="" className="max-h-full max-w-full object-contain" onError={(e) => (e.currentTarget.parentElement!.style.display = "none")} />
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-wide">{pk(rc.business)}</h1>
          {rc.contact.social && <p className="mt-0.5 text-sm text-white/70">{rc.contact.social}</p>}
          <span className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-bold ${status.cls}`}>{status.label}</span>
        </header>

        {/* Total */}
        <section className="relative px-5 pb-4 pt-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8c857e]">{t("المجموع", "Total")}</p>
          <p className={`mt-1 text-[40px] font-bold leading-none tabular-nums ${cancelled ? "text-[#8c857e] line-through" : ""}`} dir="ltr">
            {m(o.total)}
          </p>
          {o.currency === "SYP" && o.fxRate ? (
            <p className="mt-1 text-sm text-[#8c857e] tabular-nums" dir="ltr">
              ≈ {usd(o.totalUsd)}
            </p>
          ) : null}
          {status.stamp && (
            <span className={`rc-pop pointer-events-none absolute end-4 top-3 rounded-lg border-[3px] px-2 py-0.5 text-sm font-black tracking-[0.2em] ${cancelled ? "border-[#c4322a] text-[#c4322a]" : "border-[#1f8a4c] text-[#1f8a4c]"}`} aria-hidden>
              {status.stamp}
            </span>
          )}
          {o.discount > 0 && !cancelled && (
            <p className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#fff1d6] px-3 py-1 text-sm font-bold text-[#8a5a00]">
              🎉 {t("وفّرت", "You saved")} <span dir="ltr">{m(o.discount)}</span>
            </p>
          )}
        </section>

        {/* Details */}
        <dl className="mx-5 grid grid-cols-2 gap-3 rounded-2xl bg-[#f5f1ec] p-3 text-sm">
          <Info label={t("رقم الفاتورة", "Receipt no.")} value={<span dir="ltr">#{o.number}</span>} />
          <Info label={t("التاريخ", "Date")} value={when(lang, o.createdAt ?? o.businessDate)} />
          {rc.client && <Info label={t("الزبون", "Client")} value={rc.client.name} />}
          {o.method && <Info label={t("طريقة الدفع", "Payment")} value={pk(o.method)} />}
          {o.type !== "normal" && <Info label={t("نوع الطلب", "Order type")} value={discountWords(o.type, t) || o.type} />}
          {o.fulfilment === "delivery" && <Info label={t("الاستلام", "Fulfilment")} value={t("توصيل 🛵", "Delivery 🛵")} />}
        </dl>

        {/* Ticket tear line with punched notches */}
        <div className="relative my-5" aria-hidden>
          <div className="mx-5 border-t-2 border-dashed border-[#d9d2ca]" />
          <span className="absolute -start-3 -top-3 h-6 w-6 rounded-full bg-[#141312]" />
          <span className="absolute -end-3 -top-3 h-6 w-6 rounded-full bg-[#141312]" />
        </div>

        {/* Items */}
        <section className="px-5">
          <h2 className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-[0.15em] text-[#8c857e]">
            <span>{t("الأصناف", "Items")}</span>
            <span className="tabular-nums">
              {t(`${rc.lines.length} أصناف · ${pieces} قطعة`, `${rc.lines.length} items · ${pieces} pcs`)}
            </span>
          </h2>
          <ul className="mt-2 divide-y divide-dashed divide-[#e6dfd7]">
            {rc.lines.map((l) => (
              <li key={l.id} className="flex items-start gap-3 py-3">
                <span className="mt-0.5 grid h-7 min-w-[28px] place-items-center rounded-lg bg-[#141312] px-1.5 text-sm font-bold text-white tabular-nums" dir="ltr">
                  {l.qty}×
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{pk(l)}</p>
                  {l.options.length > 0 && <p className="text-sm text-[#8c857e]">+ {l.options.map(pk).join(lang === "ar" ? "، " : ", ")}</p>}
                  <p className="text-sm text-[#8c857e]">
                    <span dir="ltr">@ {m(l.unitPrice)}</span>
                    {l.freeQty > 0 && <span className="ms-2 rounded-full bg-[#e3f4e8] px-2 py-0.5 text-xs font-bold text-[#17663a]">{t(`${l.freeQty} مجاناً`, `${l.freeQty} free`)}</span>}
                  </p>
                </div>
                <span className="whitespace-nowrap font-bold tabular-nums" dir="ltr">
                  {m(l.lineTotal)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Totals */}
        <section className="mx-5 mt-2 border-t-2 border-[#141312] pt-3 text-[15px]">
          {row(t("المجموع الفرعي", "Subtotal"), m(o.subtotal))}
          {o.discount > 0 && row(`${t("خصم", "Discount")}${o.discountReason ? ` · ${discountWords(o.discountReason, t)}` : ""}`, `− ${m(o.discount)}`)}
          {o.taxes.map((x, i) => (
            <div key={i}>{row(`${pk(x)}${x.kind === "percent" ? ` ${x.value}%` : ""}`, m(x.amount))}</div>
          ))}
          {o.deliveryFee > 0 && row(t("التوصيل", "Delivery"), m(o.deliveryFee))}
          <div className="mt-2 flex items-center justify-between rounded-2xl bg-[#141312] px-4 py-3 text-white">
            <span className="font-bold tracking-wider">{t("المجموع", "TOTAL")}</span>
            <span className="text-xl font-bold tabular-nums" dir="ltr">
              {m(o.total)}
            </span>
          </div>
          {!cancelled && (rc.payment.paid > 0 || rc.payment.remaining > 0) && (
            <div className="mt-2">
              {rc.payment.paid > 0 && row(t("المدفوع", "Paid"), m(rc.payment.paid))}
              {rc.payment.remaining > 0 && row(t("الباقي على الحساب", "Remaining on account"), m(rc.payment.remaining), true)}
            </div>
          )}
        </section>

        {/* Loyalty */}
        {rc.loyalty?.enabled && rc.loyalty.buyQty > 0 && (
          <section className="mx-5 mt-4 rounded-2xl border border-[#eee6dc] p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">⭐ {t("نقاط الولاء", "Loyalty")}</span>
              <span className="tabular-nums text-[#8c857e]" dir="ltr">
                {Math.min(rc.loyalty.progress, rc.loyalty.buyQty)} / {rc.loyalty.buyQty}
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#f0e9e1]" role="progressbar" aria-valuemin={0} aria-valuemax={rc.loyalty.buyQty} aria-valuenow={Math.min(rc.loyalty.progress, rc.loyalty.buyQty)}>
              <div className="h-full rounded-full bg-gradient-to-r from-[#d2561a] to-[#f0a24b] transition-[width] duration-700" style={{ width: `${Math.min(100, (rc.loyalty.progress / rc.loyalty.buyQty) * 100)}%` }} />
            </div>
            {rc.loyalty.available > 0 && <p className="mt-2 text-sm font-bold text-[#17663a]">🎁 {t(`لك ${rc.loyalty.available} قطع مجاناً بطلبك الجاي`, `${rc.loyalty.available} free items waiting for you`)}</p>}
          </section>
        )}

        {/* Footer */}
        <footer className="rc-edge mt-5 px-5 pb-8 pt-2 text-center">
          <p className="text-lg font-bold">{lang === "ar" ? rc.contact.footerAr : rc.contact.footerEn}</p>
          {rc.business.address && <p className="mt-1 text-sm text-[#8c857e]">{rc.business.address}</p>}
        </footer>
      </article>

      {/* Actions */}
      <div className="rc-noprint rc-up mt-5 grid gap-2.5" style={{ animationDelay: ".15s" }}>
        {wa && (
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#25d366] font-bold text-[#0b3d1f] active:scale-[.98]">
            <WaIcon /> {t("اطلب عبر واتساب", "Order on WhatsApp")}
          </a>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={share} className="min-h-[48px] rounded-2xl bg-white/10 font-semibold text-white backdrop-blur active:scale-[.98]">
            {copied ? t("انتسخ الرابط ✓", "Link copied ✓") : t("مشاركة", "Share")}
          </button>
          <button type="button" onClick={() => window.print()} className="min-h-[48px] rounded-2xl bg-white/10 font-semibold text-white backdrop-blur active:scale-[.98]">
            {t("حفظ / طباعة", "Save / print")}
          </button>
        </div>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[#8c857e]">{label}</dt>
      <dd className="break-words font-semibold leading-snug">{value}</dd>
    </div>
  );
}

function Message({ icon, title, text, children }: { icon: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="rc-up rounded-[22px] bg-[#fffdf9] px-6 py-10 text-center shadow-[0_30px_60px_-20px_rgba(0,0,0,.6)]">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#f5f1ec] text-3xl" aria-hidden>
        {icon}
      </div>
      <h1 className="mt-4 text-xl font-bold">{title}</h1>
      <p className="mt-2 text-[#5c5650]">{text}</p>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="overflow-hidden rounded-t-[22px] bg-[#fffdf9]" aria-busy="true" aria-label="Loading">
      <div className="h-36 animate-pulse bg-[#2a2420]" />
      <div className="grid gap-3 p-5">
        <div className="mx-auto h-10 w-40 animate-pulse rounded-lg bg-[#efe9e2]" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-6 animate-pulse rounded bg-[#f3eee8]" />
        ))}
      </div>
    </div>
  );
}

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1.1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.7-.5Z" />
    </svg>
  );
}
