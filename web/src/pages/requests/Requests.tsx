import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { discountLabel } from "../../components/DiscountInput";
import { INBOX_EVENT, useInbox } from "../../components/Inbox";
import { Tabs } from "../../components/Tabs";
import { Empty, Field, Modal, PageHeader, Spinner, TextInput } from "../../components/ui";
import { get, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { money, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";

type Status = "pending" | "quoted" | "approved" | "accepted" | "declined" | "cancelled";
interface OrderRequest {
  id: string;
  number: number;
  status: Status;
  clientId: string;
  clientName: string;
  clientPhone: string;
  fulfilment: "pickup" | "delivery";
  paymentChoice: "on_account" | "on_delivery";
  note: string;
  quotedTotal: number;
  currency: Currency;
  itemsCount: number;
  declineReason: string;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
  balanceUsd: number | null;
  order: { id: string; number: number; status: string } | null;
  lines: { productId: string; qty: number; nameAr: string; nameEn: string; options: { nameAr: string; nameEn: string }[] }[];
  needsPrice: boolean;
  quote: { currency: Currency; prices: number[]; deliveryFee: number; lines: { unitPrice: number; lineTotal: number }[]; total: number } | null;
  quotedAt: string | null;
  clientReply: string;
}
interface SubRequest {
  id: string;
  status: Status;
  clientId: string;
  clientName: string;
  clientPhone: string;
  note: string;
  declineReason: string;
  decidedByName: string | null;
  createdAt: string;
  plan: { nameAr: string; nameEn: string; monthlyFee: number; currency: Currency; includedItems: number; discountPct: number; discountAmount: number };
}

const STATUS: Record<Status, { ar: string; en: string; cls: string }> = {
  pending: { ar: "بانتظار الرد", en: "Waiting", cls: "bg-warn/15 text-warn" },
  quoted: { ar: "انبعتت الأسعار", en: "Prices sent", cls: "bg-brand/15 text-brand" },
  approved: { ar: "الزبون وافق", en: "Client approved", cls: "bg-good/15 text-good" },
  accepted: { ar: "مقبول", en: "Accepted", cls: "bg-good/15 text-good" },
  declined: { ar: "مرفوض", en: "Declined", cls: "bg-bad/15 text-bad" },
  cancelled: { ar: "ألغاه الزبون", en: "Cancelled by client", cls: "bg-sunken text-muted" },
};

function StatusChip({ s }: { s: Status }) {
  const { pick } = useI18n();
  return <span className={`chip !font-bold ${STATUS[s].cls}`}>{pick(STATUS[s])}</span>;
}

function useAgo() {
  const { tr, fmtDate } = useI18n();
  return (iso: string) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return tr("الآن", "just now");
    if (s < 3600) return tr(`منذ ${Math.floor(s / 60)} د`, `${Math.floor(s / 60)} min ago`);
    if (s < 86400) return tr(`منذ ${Math.floor(s / 3600)} س`, `${Math.floor(s / 3600)} h ago`);
    return fmtDate(iso, true);
  };
}

const REASONS = [
  { ar: "نفدت الكمية اليوم", en: "Sold out today" },
  { ar: "المحل مغلق الآن", en: "The shop is closed now" },
  { ar: "لا يوجد توصيل لمنطقتك حالياً", en: "No delivery to your area right now" },
  { ar: "يرجى تسديد الرصيد المستحق أولاً", en: "Please settle your balance first" },
];

function DeclineDialog({ title, onConfirm, onClose }: { title: string; onConfirm: (reason: string) => Promise<void>; onClose: () => void }) {
  const { tr, pick } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("رجوع", "Back")}
          </button>
          <button
            className="btn btn-primary !border-bad !bg-bad !text-white"
            disabled={busy || reason.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              await onConfirm(reason.trim()).finally(() => setBusy(false));
            }}
          >
            {tr("رفض الطلب", "Decline")}
          </button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button key={r.en} className="chip hover:bg-line" onClick={() => setReason(pick(r))}>
            {pick(r)}
          </button>
        ))}
      </div>
      <Field label={tr("السبب (يراه الزبون)", "Reason (the client sees it)")} htmlFor="decline-reason">
        <TextInput id="decline-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

interface QuoteTotals {
  currency: Currency;
  prices: number[];
  deliveryFee: number;
  lines: { unitPrice: number; lineTotal: number }[];
  subtotal: number;
  taxes: { nameAr: string; nameEn: string; amount: number }[];
  taxTotal: number;
  total: number;
}
interface Suggested {
  currency: Currency | null;
  deliveryFee: number;
  lines: { basePrice: number; optionsDelta: number }[];
  problem?: string;
}

const toNum = (v: string) => (v.trim() === "" ? NaN : Number(v));

/** Staff type a price for each item; the client sees exactly these totals and approves them. */
function PriceDialog({ r, onClose, onSent }: { r: OrderRequest; onClose: () => void; onSent: () => void }) {
  const { tr, pick, lang, err } = useI18n();
  const toast = useToast();
  const [prices, setPrices] = useState<string[] | null>(r.quote ? r.quote.prices.map(String) : null);
  const [fee, setFee] = useState(r.quote ? String(r.quote.deliveryFee) : "");
  const [deltas, setDeltas] = useState<number[]>([]);
  const [preview, setPreview] = useState<QuoteTotals | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const delivery = r.fulfilment === "delivery";

  // Start from what this client would pay today; a request priced before keeps its prices.
  useEffect(() => {
    get<Suggested>(`/requests/orders/${r.id}/suggested-prices`)
      .then((s) => {
        setDeltas(s.lines.map((l) => l.optionsDelta));
        if (s.problem) setProblem(s.problem);
        if (!r.quote) {
          setPrices(r.lines.map((_, i) => (s.lines[i] ? String(s.lines[i]!.basePrice) : "")));
          setFee(String(s.deliveryFee ?? 0));
        }
      })
      .catch((e) => {
        setProblem(err(e));
        setPrices((cur) => cur ?? r.lines.map(() => ""));
      });
  }, [r, err]);

  const nums = (prices ?? []).map(toNum);
  const valid = !!prices && nums.every((n) => Number.isFinite(n) && n >= 0) && (!delivery || (Number.isFinite(toNum(fee)) && toNum(fee) >= 0));
  const body = { prices: nums, deliveryFee: delivery ? toNum(fee) : 0 };

  // Live totals with taxes and delivery, exactly as the client will see them.
  useEffect(() => {
    if (!valid) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      post<QuoteTotals>(`/requests/orders/${r.id}/quote-preview`, body)
        .then((q) => {
          setPreview(q);
          setProblem("");
        })
        .catch((e) => setProblem(err(e)));
    }, 300);
    return () => clearTimeout(t);
    // body is rebuilt from prices/fee on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, fee, valid, r.id, err]);

  const send = async () => {
    setBusy(true);
    try {
      await post(`/requests/orders/${r.id}/quote`, body);
      toast(tr("انبعتت الأسعار للزبون 🔔", "Prices sent: the client was notified 🔔"));
      onSent();
    } catch (e) {
      toast(err(e), "error");
      setBusy(false);
    }
  };
  const cur = preview?.currency ?? r.currency;

  return (
    <Modal
      title={tr(`أسعار الطلب #${r.number} · ${r.clientName}`, `Prices for #${r.number} · ${r.clientName}`)}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("رجوع", "Back")}
          </button>
          <button className="btn btn-primary font-bold" disabled={busy || !valid || !preview} onClick={() => void send()}>
            💰 {r.quote ? tr("ابعت الأسعار الجديدة", "Send new prices") : tr("ابعت الأسعار للزبون", "Send prices to the client")}
            {preview && <span className="num ltr ms-1">· {money(preview.total, preview.currency, lang)}</span>}
          </button>
        </>
      }
    >
      {!prices ? (
        <Spinner />
      ) : (
        <div className="grid gap-4">
          <p className="text-sm text-muted">{tr("السعر للقطعة الواحدة. مكتوب سعر هالزبون الحالي، غيّره إذا بدك. هالأسعار لهالطلب بس.", "Price per piece. It starts at this client's current price: change it if you like. These prices are for this request only.")}</p>
          <div className="grid gap-2">
            {r.lines.map((l, i) => {
              const n = nums[i] ?? NaN;
              const unit = Number.isFinite(n) ? n + (deltas[i] ?? 0) : NaN;
              return (
                <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl bg-sunken/60 p-3 sm:grid-cols-[1fr_9rem_7rem]">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      <span className="num">{l.qty}×</span> {pick(l)}
                    </div>
                    {l.options.length > 0 && <div className="truncate text-xs text-muted">{l.options.map((o) => pick(o)).join("، ")}</div>}
                    {(deltas[i] ?? 0) !== 0 && <div className="text-xs text-faint num ltr text-start">{tr(`+ ${money(deltas[i], cur, lang)} إضافات`, `+ ${money(deltas[i], cur, lang)} add-ons`)}</div>}
                  </div>
                  <TextInput
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    className="num ltr text-end"
                    aria-label={tr(`سعر القطعة: ${pick(l)}`, `Price per piece: ${pick(l)}`)}
                    value={prices[i] ?? ""}
                    onChange={(e) => setPrices(prices.map((p, j) => (j === i ? e.target.value : p)))}
                  />
                  <div className="col-span-2 text-end text-sm font-bold num ltr sm:col-span-1">{Number.isFinite(unit) ? money(unit * l.qty, cur, lang) : "—"}</div>
                </div>
              );
            })}
          </div>
          {delivery && (
            <Field label={tr("أجرة التوصيل", "Delivery fee")} htmlFor="q-fee">
              <TextInput id="q-fee" type="number" inputMode="decimal" min={0} step="any" className="num ltr" value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
          )}
          {preview && (
            <dl className="grid gap-1 rounded-xl border border-line p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{tr("المجموع", "Subtotal")}</dt>
                <dd className="num ltr">{money(preview.subtotal, cur, lang)}</dd>
              </div>
              {preview.taxes.map((t) => (
                <div key={t.nameEn} className="flex justify-between">
                  <dt className="text-muted">{pick(t)}</dt>
                  <dd className="num ltr">{money(t.amount, cur, lang)}</dd>
                </div>
              ))}
              {preview.deliveryFee > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">{tr("التوصيل", "Delivery")}</dt>
                  <dd className="num ltr">{money(preview.deliveryFee, cur, lang)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-1.5 text-base font-bold">
                <dt>{tr("الزبون رح يشوف", "The client will see")}</dt>
                <dd className="num ltr">{money(preview.total, cur, lang)}</dd>
              </div>
            </dl>
          )}
          {problem && <p className="rounded-lg bg-bad/10 p-2 text-sm text-bad">{problem}</p>}
        </div>
      )}
    </Modal>
  );
}

function OrderCard({ r, highlight, onChanged }: { r: OrderRequest; highlight: boolean; onChanged: () => void }) {
  const { tr, pick, lang, err } = useI18n();
  const toast = useToast();
  const ago = useAgo();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [pricing, setPricing] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const out = await post<{ number: number }>(`/requests/orders/${r.id}/accept`);
      toast(tr(`تم القبول — فاتورة #${out.number}`, `Accepted — invoice #${out.number}`));
      onChanged();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const owes = (r.balanceUsd ?? 0) < -0.004;
  const open = r.status === "pending" || r.status === "quoted" || r.status === "approved";
  const needsAction = r.status === "pending" || r.status === "approved";
  const unpriced = r.needsPrice && !r.quote;
  return (
    <article id={`req-${r.id}`} className={`card ${highlight ? "ring-2 ring-brand" : ""} ${needsAction ? "border-warn/50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold num">#{r.number}</span>
            <StatusChip s={r.status} />
            {r.needsPrice && r.status === "pending" && <span className="chip !bg-brand/15 !font-bold !text-brand">💰 {tr("بدو أسعار", "Needs prices")}</span>}
            <span className="text-sm text-faint">{ago(r.createdAt)}</span>
          </div>
          <Link to={`/clients/${r.clientId}`} className="block font-semibold hover:underline">
            {r.clientName}
          </Link>
          {r.clientPhone && <div className="text-sm text-faint ltr text-start">{r.clientPhone}</div>}
        </div>
        <div className="text-end">
          <div className="text-xl font-bold num ltr">{unpriced ? "—" : money(r.quotedTotal, r.currency, lang)}</div>
          <div className="text-xs text-faint">
            {r.itemsCount} {tr("قطعة", "items")}
          </div>
        </div>
      </div>

      <ul className="mt-3 grid gap-1 rounded-lg bg-sunken/60 p-3 text-sm">
        {r.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="min-w-0">
              <span className="font-bold num">{l.qty}×</span> {pick(l)}
              {l.options.length > 0 && <span className="text-muted"> — {l.options.map((o) => pick(o)).join("، ")}</span>}
            </span>
            {r.quote?.lines[i] && <span className="shrink-0 text-muted num ltr">{money(r.quote.lines[i]!.unitPrice, r.quote.currency, lang)}</span>}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
        <span className="chip">{r.fulfilment === "delivery" ? `🛵 ${tr("توصيل", "Delivery")}` : `🛍️ ${tr("استلام", "Pick up")}`}</span>
        <span className={`chip ${r.paymentChoice === "on_delivery" ? "!bg-warn/15 !text-warn" : ""}`}>{r.paymentChoice === "on_delivery" ? `💵 ${tr("الدفع عند الاستلام", "Pay on delivery")}` : `📒 ${tr("على الحساب", "On account")}`}</span>
        {r.balanceUsd !== null && owes && <span className="chip !bg-bad/10 !text-bad">{tr(`عليه ${money(-r.balanceUsd)}`, `Owes ${money(-r.balanceUsd)}`)}</span>}
      </div>
      {r.note && <p className="mt-2 text-sm">📝 {r.note}</p>}

      {r.status === "quoted" && (
        <p className="mt-3 rounded-lg bg-brand/10 p-2.5 text-sm">
          ⏳ {tr(`انبعتت الأسعار ${r.quotedAt ? ago(r.quotedAt) : ""} · بانتظار موافقة الزبون`, `Prices sent ${r.quotedAt ? ago(r.quotedAt) : ""} · waiting for the client to approve`)}
        </p>
      )}
      {r.status === "approved" && <p className="mt-3 rounded-lg bg-good/10 p-2.5 text-sm">✅ {tr("الزبون وافق على الأسعار. الطلب ما انعمل تلقائياً: كمّله من هون.", "The client approved the prices. The order wasn't placed automatically: finish it here.")}</p>}

      {open ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn !py-2.5 font-bold text-bad" disabled={busy} onClick={() => setDeclining(true)}>
            ✕ {tr("رفض", "Decline")}
          </button>
          {r.status === "approved" || (r.status === "pending" && !r.needsPrice) ? (
            <button className="btn btn-primary !border-good !bg-good !py-2.5 font-bold !text-white" disabled={busy} onClick={() => void accept()}>
              ✓ {r.status === "approved" ? tr("اعمل الطلب", "Place order") : tr("قبول", "Accept")}
            </button>
          ) : (
            <button className={`btn !py-2.5 font-bold ${r.status === "pending" ? "btn-primary" : ""}`} disabled={busy} onClick={() => setPricing(true)}>
              💰 {r.status === "quoted" ? tr("غيّر الأسعار", "Change prices") : tr("حط الأسعار", "Set prices")}
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm text-muted">
          {r.decidedByName && <span>{tr(`بواسطة ${r.decidedByName}`, `By ${r.decidedByName}`)}</span>}
          {r.declineReason && <span>· {r.declineReason}</span>}
          {r.status === "cancelled" && r.needsPrice && r.quotedAt && <span>· {tr("الزبون ما وافق على الأسعار", "The client turned down the prices")}</span>}
          {r.clientReply && <span>· “{r.clientReply}”</span>}
          {r.order && (
            <Link className="ms-auto font-semibold text-ink underline" to={`/print/receipt/${r.order.id}`} target="_blank">
              {tr(`فاتورة #${r.order.number}`, `Invoice #${r.order.number}`)}
            </Link>
          )}
        </div>
      )}
      {pricing && (
        <PriceDialog
          r={r}
          onClose={() => setPricing(false)}
          onSent={() => {
            setPricing(false);
            onChanged();
          }}
        />
      )}
      {declining && (
        <DeclineDialog
          title={tr(`رفض الطلب #${r.number}`, `Decline request #${r.number}`)}
          onClose={() => setDeclining(false)}
          onConfirm={async (reason) => {
            try {
              await post(`/requests/orders/${r.id}/decline`, { reason });
              toast(tr("تم الرفض وإبلاغ الزبون", "Declined — the client was told"));
              setDeclining(false);
              onChanged();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </article>
  );
}

function SubCard({ r, highlight, onChanged }: { r: SubRequest; highlight: boolean; onChanged: () => void }) {
  const { tr, pick, lang, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const ago = useAgo();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      await post(`/requests/subscriptions/${r.id}/accept`);
      toast(tr("تم تفعيل الاشتراك", "Subscription started"));
      onChanged();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <article id={`req-${r.id}`} className={`card ${highlight ? "ring-2 ring-brand" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">⭐ {pick(r.plan)}</span>
            <StatusChip s={r.status} />
            <span className="text-sm text-faint">{ago(r.createdAt)}</span>
          </div>
          <Link to={`/clients/${r.clientId}`} className="font-semibold hover:underline">
            {r.clientName}
          </Link>
        </div>
        <div className="text-end">
          <div className="text-xl font-bold num ltr">{money(r.plan.monthlyFee, r.plan.currency, lang)}</div>
          <div className="text-xs text-faint">{tr("شهرياً", "per month")}</div>
        </div>
      </div>
      <div className="mt-2 text-sm text-muted">
        {tr(`${r.plan.includedItems} قطعة مجانية · خصم ${discountLabel(r.plan.discountPct, r.plan.discountAmount, r.plan.currency, lang) || "0%"}`, `${r.plan.includedItems} free items · ${discountLabel(r.plan.discountPct, r.plan.discountAmount, r.plan.currency, lang) || "0%"} off`)}
      </div>
      {r.note && <p className="mt-2 text-sm">📝 {r.note}</p>}
      {r.status === "pending" && can("clients", "create") ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn !py-2.5 font-bold text-bad" disabled={busy} onClick={() => setDeclining(true)}>
            ✕ {tr("رفض", "Decline")}
          </button>
          <button className="btn btn-primary !border-good !bg-good !py-2.5 font-bold !text-white" disabled={busy} onClick={() => void accept()}>
            ✓ {tr("قبول وتفعيل", "Accept & start")}
          </button>
        </div>
      ) : (
        (r.decidedByName || r.declineReason) && (
          <div className="mt-3 border-t border-line pt-3 text-sm text-muted">
            {r.decidedByName && tr(`بواسطة ${r.decidedByName}`, `By ${r.decidedByName}`)} {r.declineReason && `· ${r.declineReason}`}
          </div>
        )
      )}
      {declining && (
        <DeclineDialog
          title={tr("رفض طلب الاشتراك", "Decline subscription request")}
          onClose={() => setDeclining(false)}
          onConfirm={async (reason) => {
            try {
              await post(`/requests/subscriptions/${r.id}/decline`, { reason });
              toast(tr("تم الرفض وإبلاغ الزبون", "Declined — the client was told"));
              setDeclining(false);
              onChanged();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </article>
  );
}

interface OrderReport {
  id: string;
  requestId: string;
  requestNumber: number;
  clientId: string;
  clientName: string;
  clientPhone: string;
  category: "late" | "missing" | "wrong" | "quality" | "payment" | "other";
  message: string;
  status: "open" | "resolved";
  reply: string;
  createdAt: string;
  resolvedByName: string | null;
}

export const REPORT_LABEL: Record<OrderReport["category"], { ar: string; en: string; icon: string }> = {
  late: { ar: "الطلب تأخر", en: "Order is late", icon: "⏰" },
  missing: { ar: "في شي ناقص", en: "Something is missing", icon: "📦" },
  wrong: { ar: "الطلب غلط", en: "Wrong order", icon: "🔄" },
  quality: { ar: "مشكلة بالجودة", en: "Quality problem", icon: "🥪" },
  payment: { ar: "مشكلة بالحساب", en: "Payment problem", icon: "💰" },
  other: { ar: "شي تاني", en: "Something else", icon: "💬" },
};

function ReportCard({ r, highlight, onChanged }: { r: OrderReport; highlight: boolean; onChanged: () => void }) {
  const { tr, pick, err } = useI18n();
  const toast = useToast();
  const ago = useAgo();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const label = REPORT_LABEL[r.category];
  const resolve = async () => {
    setBusy(true);
    try {
      await post(`/requests/reports/${r.id}/resolve`, { reply: reply.trim() });
      toast(tr("انسجّل الرد ووصل للزبون", "Answer saved and sent to the client"));
      onChanged();
    } catch (e) {
      toast(err(e), "error");
      setBusy(false);
    }
  };
  return (
    <article id={`req-${r.id}`} className={`card grid gap-3 ${highlight ? "ring-2 ring-brand" : ""} ${r.status === "open" ? "border-bad/40" : ""}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link to={`/clients/${r.clientId}`} className="font-bold hover:underline">
            {r.clientName}
          </Link>
          <div className="text-sm text-muted">
            {r.clientPhone && (
              <a href={`tel:${r.clientPhone}`} className="num ltr me-2 text-brand">
                {r.clientPhone}
              </a>
            )}
            <span className="num">
              {tr("طلب", "Order")} #{r.requestNumber}
            </span>{" "}
            · {ago(r.createdAt)}
          </div>
        </div>
        <span className={`chip !font-bold ${r.status === "open" ? "bg-bad/15 text-bad" : "bg-good/15 text-good"}`}>{r.status === "open" ? tr("مفتوح", "Open") : tr("تم الحل", "Resolved")}</span>
      </div>
      <div className="rounded-xl bg-sunken p-3">
        <div className="mb-1 text-sm font-bold">
          {label.icon} {pick(label)}
        </div>
        <p className="whitespace-pre-wrap break-words">{r.message}</p>
      </div>
      {r.status === "open" ? (
        <div className="flex flex-wrap gap-2">
          <TextInput className="min-w-0 flex-1" maxLength={500} placeholder={tr("ردك على الزبون (اختياري)", "Your answer to the client (optional)")} value={reply} onChange={(e) => setReply(e.target.value)} aria-label={tr("ردك على الزبون", "Your answer to the client")} />
          <button className="btn btn-primary" disabled={busy} onClick={() => void resolve()}>
            ✓ {tr("تم الحل", "Resolved")}
          </button>
        </div>
      ) : (
        r.reply && (
          <p className="text-sm">
            <span className="font-semibold">{r.resolvedByName ?? tr("المحل", "The shop")}:</span> {r.reply}
          </p>
        )
      )}
    </article>
  );
}

export function RequestsPage() {
  const { tr } = useI18n();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab");
  const tab = rawTab === "subscriptions" ? "subscriptions" : rawTab === "reports" ? "reports" : "orders";
  const highlight = params.get("id");
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const { pending, refresh } = useInbox();
  const orders = useData<{ rows: OrderRequest[] }>(tab === "orders" ? `/requests/orders?status=${status}` : null);
  const subs = useData<{ rows: SubRequest[] }>(tab === "subscriptions" ? `/requests/subscriptions?status=${status}` : null);
  const reports = useData<{ rows: OrderReport[] }>(tab === "reports" ? `/requests/reports?status=${status === "pending" ? "open" : "all"}` : null);
  const reloadAll = () => {
    void orders.reload();
    void subs.reload();
    void reports.reload();
    void refresh();
  };

  useEffect(() => {
    const on = () => {
      void orders.reload();
      void subs.reload();
      void reports.reload();
    };
    window.addEventListener(INBOX_EVENT, on);
    return () => window.removeEventListener(INBOX_EVENT, on);
  }, [orders.reload, subs.reload, reports.reload]);

  useEffect(() => {
    if (highlight) document.getElementById(`req-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, orders.data, subs.data, reports.data]);

  const badge = (n: number) => (n ? ` (${n})` : "");
  const rowsLoading = tab === "orders" ? !orders.data : tab === "reports" ? !reports.data : !subs.data;

  return (
    <>
      <PageHeader title={tr("طلبات الزبائن", "Client requests")} subtitle={tr("طلبات أرسلها الزبائن من هواتفهم. اقبلها لتصبح فاتورة، أو ارفضها مع سبب. الزبائن يلي ما بيشوفوا أسعار: حط الأسعار وابعتها، وهنن بيوافقوا.", "Orders clients sent from their phones. Accept to turn one into an invoice, or decline with a reason. For clients who don't see prices: set the prices and send them, and they approve.")} />
      <Tabs
        tabs={[
          { key: "orders", label: tr("الطلبات", "Orders") + badge(pending.orders) },
          { key: "subscriptions", label: tr("الاشتراكات", "Subscriptions") + badge(pending.subscriptions) },
          { key: "reports", label: tr("بلاغات الزبائن", "Client reports") + badge(pending.reports) },
        ]}
        value={tab}
        onChange={(k) => setParams(k === "orders" ? {} : { tab: k })}
      />
      <div className="mb-4 inline-flex rounded-lg bg-sunken p-0.5">
        {(
          [
            ["pending", tr("بانتظار الرد", "Waiting")],
            ["all", tr("الكل", "All")],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setStatus(k)} aria-pressed={status === k} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${status === k ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      {rowsLoading ? (
        <Spinner />
      ) : tab === "reports" ? (
        reports.data!.rows.length === 0 ? (
          <Empty text={status === "pending" ? tr("ما في بلاغات مفتوحة 🎉", "No open reports 🎉") : tr("ما في بلاغات بعد", "No reports yet")} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {reports.data!.rows.map((r) => (
              <ReportCard key={r.id} r={r} highlight={r.id === highlight} onChanged={reloadAll} />
            ))}
          </div>
        )
      ) : tab === "orders" ? (
        orders.data!.rows.length === 0 ? (
          <Empty text={status === "pending" ? tr("لا طلبات بانتظار الرد 🎉", "Nothing waiting 🎉") : tr("لا طلبات بعد", "No requests yet")} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {orders.data!.rows.map((r) => (
              <OrderCard key={r.id} r={r} highlight={r.id === highlight} onChanged={reloadAll} />
            ))}
          </div>
        )
      ) : subs.data!.rows.length === 0 ? (
        <Empty text={status === "pending" ? tr("لا طلبات بانتظار الرد 🎉", "Nothing waiting 🎉") : tr("لا طلبات بعد", "No requests yet")} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {subs.data!.rows.map((r) => (
            <SubCard key={r.id} r={r} highlight={r.id === highlight} onChanged={reloadAll} />
          ))}
        </div>
      )}
    </>
  );
}
