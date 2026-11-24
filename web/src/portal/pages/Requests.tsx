import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Modal, Spinner } from "../../components/ui";
import { post } from "../../lib/api";
import type { Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import { stageOf, StageChip, useAgo, useMoney, useRefreshOn, useRequestMoney, type PortalRequest, type Stage } from "../shared";
import { RequestRow } from "./Home";

type Filter = "all" | "active" | "done";
const ACTIVE: Stage[] = ["pricing", "quoted", "waiting", "accepted"];

export function RequestsPage() {
  const { tr } = useI18n();
  const money = useRequestMoney();
  const ago = useAgo();
  const { data, reload } = useData<{ rows: PortalRequest[] }>("/portal/order-requests");
  useRefreshOn(reload);
  const [filter, setFilter] = useState<Filter>("all");
  if (!data) return <Spinner />;
  const rows = data.rows.filter((r) => filter === "all" || (filter === "active") === ACTIVE.includes(stageOf(r)));
  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">{tr("طلباتي", "My orders")}</h1>
      <div className="mb-4 flex gap-2">
        {(
          [
            ["all", tr("الكل", "All")],
            ["active", tr("الجارية", "Active")],
            ["done", tr("المنتهية", "Finished")],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === k ? "bg-ink text-bg" : "bg-surface text-muted ring-1 ring-line"}`}>
            {label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line px-4 py-10 text-center text-faint">
          {tr("لا طلبات", "No orders")}
          <div className="mt-3">
            <Link to="/portal/order" className="btn btn-primary">
              {tr("اطلب الآن", "Order now")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {rows.map((r) => (
            <RequestRow key={r.id} r={r} ago={ago(r.createdAt)} money={money(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Detail extends PortalRequest {
  lines: { nameAr: string; nameEn: string; qty: number; freeQty: number; unitPrice: number; lineTotal: number; options: { nameAr: string; nameEn: string }[] }[];
  totals: { subtotal: number; discount: number; taxTotal: number; deliveryFee: number; total: number; currency: Currency } | null;
  /** Only for prices the shop sent (an accepted order shows them on the receipt). */
  taxes: { nameAr: string; nameEn: string; amount: number }[];
  delivery: { name: string; phone: string } | null;
  reports: { id: string; category: ReportCategory; message: string; status: "open" | "resolved"; reply: string; createdAt: string; resolvedAt: string | null }[];
}

type ReportCategory = "late" | "missing" | "wrong" | "quality" | "payment" | "other";
const REPORT_CHOICES: { key: ReportCategory; ar: string; en: string; icon: string }[] = [
  { key: "late", ar: "الطلب تأخر", en: "Order is late", icon: "⏰" },
  { key: "missing", ar: "في شي ناقص", en: "Something is missing", icon: "📦" },
  { key: "wrong", ar: "الطلب غلط", en: "Wrong order", icon: "🔄" },
  { key: "quality", ar: "مشكلة بالجودة", en: "Quality problem", icon: "🥪" },
  { key: "payment", ar: "مشكلة بالحساب", en: "Payment problem", icon: "💰" },
  { key: "other", ar: "شي تاني", en: "Something else", icon: "💬" },
];

/** The client tells the shop what went wrong: one tap for the kind of problem, then a few words. */
function ReportDialog({ requestId, number, onClose, onSent }: { requestId: string; number: number; onClose: () => void; onSent: () => void }) {
  const { tr, pick, err } = useI18n();
  const toast = useToast();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = !!category && message.trim().length >= 3;
  const send = async () => {
    setBusy(true);
    try {
      await post(`/portal/order-requests/${requestId}/reports`, { category, message: message.trim() });
      toast(tr("وصل بلاغك للمحل، رح يردوا عليك قريباً", "Your report reached the shop: they will answer soon"));
      onSent();
    } catch (e) {
      toast(err(e), "error");
      setBusy(false);
    }
  };
  return (
    <Modal
      title={tr(`بلاغ عن الطلب #${number}`, `Report on order #${number}`)}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("رجوع", "Back")}
          </button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={() => void send()}>
            {tr("إرسال البلاغ", "Send report")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={tr("شو المشكلة؟", "What went wrong?")}>
          {REPORT_CHOICES.map((c) => (
            <button key={c.key} type="button" role="radio" aria-checked={category === c.key} onClick={() => setCategory(c.key)} className={`rounded-xl border-2 p-3 text-start text-sm font-semibold transition-colors ${category === c.key ? "border-brand bg-brand/10" : "border-line"}`}>
              <span className="me-1.5" aria-hidden>
                {c.icon}
              </span>
              {pick(c)}
            </button>
          ))}
        </div>
        <label className="grid gap-1">
          <span className="label">{tr("احكيلنا شو صار", "Tell us what happened")}</span>
          <textarea className="input min-h-[96px]" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

function Timeline({ r }: { r: Detail }) {
  const { tr, fmtDate } = useI18n();
  const stage = stageOf(r);
  const steps: { label: string; when?: string | null; state: "done" | "now" | "todo" | "bad" }[] = [{ label: tr("أُرسل الطلب", "Order sent"), when: r.createdAt, state: "done" }];
  const closed = stage === "declined" || r.status === "cancelled";
  if (r.needsPrice) {
    if (!r.quotedAt) {
      if (!closed) steps.push({ label: tr("المحل عم يجهّز أسعارك", "The shop is pricing it"), state: "now" });
    } else {
      steps.push({ label: tr("وصلتك الأسعار", "Prices sent to you"), when: r.quotedAt, state: "done" });
      if (r.approvedAt) steps.push({ label: tr("وافقت على الأسعار", "You approved the prices"), when: r.approvedAt, state: "done" });
      else if (stage === "quoted") steps.push({ label: tr("بانتظار موافقتك", "Waiting for your OK"), state: "now" });
    }
  }
  const doneLabel = r.fulfilment === "delivery" ? tr("تم التوصيل", "Delivered") : tr("تم الاستلام", "Picked up");
  if (stage === "declined") steps.push({ label: tr("رُفض الطلب", "Declined"), when: r.decidedAt, state: "bad" });
  else if (r.status === "cancelled") steps.push({ label: r.needsPrice && r.quotedAt && r.decidedAt ? tr("ما وافقت على الأسعار", "You turned down the prices") : tr("ألغيت الطلب", "You cancelled it"), when: r.decidedAt, state: "bad" });
  else if (stage === "pricing" || stage === "quoted") steps.push({ label: doneLabel, state: "todo" });
  else {
    if (r.needsPrice) steps.push({ label: tr("تأكّد الطلب", "Order confirmed"), when: r.order ? r.decidedAt : null, state: r.order ? "done" : "now" });
    else steps.push({ label: stage === "waiting" ? tr("بانتظار موافقة المحل", "Waiting for the shop") : tr("قبله المحل", "Accepted by the shop"), when: r.decidedAt, state: stage === "waiting" ? "now" : "done" });
    if (stage === "cancelled") steps.push({ label: tr("أُلغي الطلب", "Order cancelled"), when: r.order?.updatedAt, state: "bad" });
    else steps.push({ label: doneLabel, when: stage === "delivered" ? r.order?.updatedAt : null, state: stage === "delivered" ? "done" : stage === "accepted" && r.order ? "now" : "todo" });
  }
  const dot = { done: "bg-good text-white", now: "bg-warn text-white animate-pulse", todo: "bg-sunken text-faint", bad: "bg-bad text-white" };
  return (
    <ol className="grid gap-0">
      {steps.map((s, i) => (
        <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 && <span className="absolute start-[13px] top-7 h-[calc(100%-20px)] w-0.5 bg-line" aria-hidden />}
          <span className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${dot[s.state]}`} aria-hidden>
            {s.state === "bad" ? "✕" : s.state === "done" ? "✓" : i + 1}
          </span>
          <div className="pt-0.5">
            <div className={`font-semibold ${s.state === "todo" ? "text-faint" : ""}`}>{s.label}</div>
            {s.when && <div className="text-xs text-faint">{fmtDate(s.when, true)}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

const CONFETTI_COLORS = ["#e06a2e", "#16a34a", "#eab308", "#3b82f6", "#ec4899"];

/** A short celebration after the client approves the prices. */
function Celebration({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  const { tr } = useI18n();
  const pieces = useMemo(
    () => Array.from({ length: 28 }, (_, i) => ({ left: Math.random() * 100, dx: `${Math.round((Math.random() - 0.5) * 160)}px`, rot: `${Math.round(Math.random() * 720 - 360)}deg`, delay: Math.random() * 0.35, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] })),
    [],
  );
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="portal-pop relative w-full max-w-sm overflow-hidden rounded-3xl bg-surface p-6 text-center shadow-2xl">
        {pieces.map((p, i) => (
          <span key={i} className="portal-confetti" aria-hidden style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, ["--dx" as string]: p.dx, ["--rot" as string]: p.rot }} />
        ))}
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-good/15 text-4xl" aria-hidden>
          🎉
        </div>
        <h2 className="mt-4 text-xl font-bold">{title}</h2>
        <p className="mt-1 text-muted">{sub}</p>
        <button className="btn btn-primary mt-5 w-full !py-3" onClick={onClose} autoFocus>
          {tr("تمام", "Great")}
        </button>
      </div>
    </div>
  );
}

const REJECT_REASONS = [
  { ar: "السعر غالي", en: "Too expensive" },
  { ar: "غيّرت رأيي", en: "I changed my mind" },
  { ar: "رح اطلب بعدين", en: "I'll order later" },
];

function RejectDialog({ number, onClose, onConfirm }: { number: number; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const { tr, pick } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={tr(`ما بدك أسعار الطلب #${number}؟`, `Turn down the prices for #${number}?`)}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("رجوع", "Back")}
          </button>
          <button
            className="btn btn-primary !border-bad !bg-bad !text-white"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm(reason.trim()).finally(() => setBusy(false));
            }}
          >
            {tr("ما بدي", "Turn down")}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">{tr("رح يوصل للمحل إنك ما وافقت. فيك تقلّهم ليش (اختياري):", "The shop will be told. You can say why (optional):")}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {REJECT_REASONS.map((x) => (
          <button key={x.en} className={`chip ${reason === pick(x) ? "!bg-ink !text-bg" : "hover:bg-line"}`} onClick={() => setReason(pick(x))}>
            {pick(x)}
          </button>
        ))}
      </div>
      <textarea className="input min-h-[72px] !text-base" maxLength={250} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={tr("السبب", "Reason")} />
    </Modal>
  );
}

/** The shop's prices, front and centre, with the one decision the client has to make. */
function QuoteCard({ r, busy, onApprove, onReject }: { r: Detail; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const { tr } = useI18n();
  const m = useMoney();
  const t = r.totals!;
  return (
    <section className="portal-glow overflow-hidden rounded-3xl border-2 border-brand bg-surface">
      <div className="portal-hero flex items-center gap-4 p-5 text-white">
        <span className="portal-coin grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 text-3xl" aria-hidden>
          💰
        </span>
        <div className="min-w-0">
          <div className="text-sm text-white/85">{tr("أسعارك وصلت من المحل", "Your prices are here")}</div>
          <div className="text-3xl font-bold num ltr text-start">{m(t.total, t.currency)}</div>
          <div className="text-xs text-white/80">
            {r.itemsCount} {tr("قطعة", "items")}
            {t.deliveryFee > 0 && ` · ${tr("مع التوصيل", "incl. delivery")}`}
          </div>
        </div>
      </div>
      <div className="grid gap-2 p-4">
        <p className="text-sm text-muted">{tr("شوف الأسعار تحت. إذا موافق، اضغط وافق ومنبلّش نجهّز طلبك فوراً.", "Check the prices below. If they work for you, approve and we start on your order right away.")}</p>
        <button className="btn btn-primary !border-good !bg-good w-full !py-3.5 text-base font-bold !text-white" disabled={busy} onClick={onApprove}>
          ✓ {tr("موافق، اعتمد الطلب", "Approve & place order")}
        </button>
        <button className="btn w-full !py-2.5 text-muted" disabled={busy} onClick={onReject}>
          {tr("لا، ما بدي", "No thanks")}
        </button>
      </div>
    </section>
  );
}

export function RequestDetailPage() {
  const { id } = useParams();
  const { tr, pick, err } = useI18n();
  const m = useMoney();
  const ago = useAgo();
  const toast = useToast();
  const { data, reload } = useData<{ request: Detail }>(`/portal/order-requests/${id}`);
  useRefreshOn(reload);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [celebrate, setCelebrate] = useState<{ title: string; sub: string } | null>(null);
  // Opening the order reads its notifications on the server: let the bell catch up.
  const loaded = !!data;
  useEffect(() => {
    if (loaded) window.dispatchEvent(new Event("portal:notifications-read"));
  }, [loaded, id]);
  if (!data) return <Spinner />;
  const r = data.request;
  const stage = stageOf(r);
  const cancel = async () => {
    if (!window.confirm(tr("إلغاء هذا الطلب؟", "Cancel this order?"))) return;
    setBusy(true);
    try {
      await post(`/portal/order-requests/${r.id}/cancel`);
      toast(tr("تم إلغاء الطلب", "Order cancelled"));
      await reload();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    setBusy(true);
    try {
      const out = await post<{ placed: boolean; orderNumber: number | null }>(`/portal/order-requests/${r.id}/approve`);
      setCelebrate(
        out.placed
          ? { title: tr("تم! طلبك تأكّد 🎉", "Done! Your order is confirmed"), sub: tr(`فاتورة #${out.orderNumber} · منبلّش نجهّزه هلّق`, `Invoice #${out.orderNumber} · we're starting on it now`) }
          : { title: tr("وصلت موافقتك ✓", "Your OK reached the shop"), sub: tr("المحل رح يأكّد الطلب ويبعتلك إشعار", "The shop will confirm the order and notify you") },
      );
      await reload();
    } catch (e) {
      toast(err(e), "error");
      await reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`grid gap-4 ${stage === "quoted" ? "pb-4" : ""}`}>
      <Link to="/portal/orders" className="text-sm font-semibold text-muted">
        {tr("→ طلباتي", "← My orders")}
      </Link>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {tr("طلب", "Order")} <span className="num ltr">#{r.number}</span>
        </h1>
        <StageChip stage={stage} />
      </div>

      {stage === "quoted" && r.totals && <QuoteCard r={r} busy={busy} onApprove={() => void approve()} onReject={() => setRejecting(true)} />}

      {stage === "pricing" && (
        <div className="flex items-center gap-3 rounded-3xl border border-warn/40 bg-warn/10 p-4">
          <span className="text-3xl" aria-hidden>
            ⏳
          </span>
          <div>
            <div className="font-bold">{tr("المحل عم يجهّز أسعارك", "The shop is preparing your prices")}</div>
            <div className="text-sm text-muted">{tr("رح يوصلك إشعار 🔔 أول ما تجهز، وبتوافق قبل ما ينعمل أي شي.", "You'll get a notification 🔔 as soon as they're ready, and nothing is made until you approve.")}</div>
          </div>
        </div>
      )}

      {stage === "declined" && r.declineReason && (
        <div className="rounded-2xl border border-bad/30 bg-bad/10 p-4">
          <div className="text-sm font-bold text-bad">{tr("سبب الرفض", "Reason")}</div>
          <div className="mt-0.5">{r.declineReason}</div>
        </div>
      )}

      <div className="card rounded-3xl p-5">
        <Timeline r={r} />
      </div>

      {r.delivery && (
        <div className="card flex items-center gap-3 rounded-3xl p-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/15 text-2xl" aria-hidden>
            🛵
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-muted">{stage === "delivered" ? tr("وصّل طلبك", "Delivered by") : tr("رح يوصّل طلبك", "Delivering your order")}</div>
            <div className="truncate text-lg font-bold">{r.delivery.name}</div>
            {r.delivery.phone && <div className="num ltr text-start text-sm text-muted">{r.delivery.phone}</div>}
          </div>
          {r.delivery.phone && (
            <a href={`tel:${r.delivery.phone}`} className="btn btn-primary shrink-0">
              📞 {tr("اتصل", "Call")}
            </a>
          )}
        </div>
      )}

      <div className="card rounded-3xl p-5">
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-sunken px-3 py-1">{r.fulfilment === "delivery" ? `🛵 ${tr("توصيل", "Delivery")}` : `🛍️ ${tr("استلام", "Pick up")}`}</span>
          <span className="rounded-full bg-sunken px-3 py-1">{r.paymentChoice === "on_delivery" ? `💵 ${tr("الدفع عند الاستلام", "Pay on delivery")}` : `📒 ${tr("على الحساب", "On account")}`}</span>
          {r.order && <span className="rounded-full bg-sunken px-3 py-1 num">{tr(`فاتورة #${r.order.number}`, `Invoice #${r.order.number}`)}</span>}
        </div>
        <ul className="divide-y divide-line">
          {r.lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="font-semibold">
                  <span className="num">{l.qty}×</span> {pick(l)}
                </div>
                {l.options.length > 0 && <div className="text-xs text-muted">{l.options.map((o) => pick(o)).join("، ")}</div>}
                {r.totals && l.qty > 0 && <div className="text-xs text-faint num ltr text-start">{tr(`${m(l.unitPrice, r.totals.currency)} للقطعة`, `${m(l.unitPrice, r.totals.currency)} each`)}</div>}
                {l.freeQty > 0 && <div className="text-xs text-good">{tr(`${l.freeQty} مجاناً`, `${l.freeQty} free`)}</div>}
              </div>
              {r.totals && <span className="num ltr font-semibold">{m(l.lineTotal, r.totals.currency)}</span>}
            </li>
          ))}
        </ul>
        {r.note && <p className="mt-2 rounded-xl bg-sunken/60 p-3 text-sm">📝 {r.note}</p>}
        <dl className="mt-3 grid gap-1 border-t border-line pt-3 text-sm">
          {r.totals ? (
            <>
              {(r.totals.discount > 0 || r.taxes.length > 0 || r.totals.deliveryFee > 0) && (
                <div className="flex justify-between">
                  <dt className="text-muted">{tr("المجموع", "Subtotal")}</dt>
                  <dd className="num ltr">{m(r.totals.subtotal, r.totals.currency)}</dd>
                </div>
              )}
              {r.totals.discount > 0 && (
                <div className="flex justify-between text-good">
                  <dt>{tr("الخصم", "Discount")}</dt>
                  <dd className="num ltr">−{m(r.totals.discount, r.totals.currency)}</dd>
                </div>
              )}
              {r.taxes.map((t) => (
                <div key={t.nameEn} className="flex justify-between">
                  <dt className="text-muted">{pick(t)}</dt>
                  <dd className="num ltr">{m(t.amount, r.totals!.currency)}</dd>
                </div>
              ))}
              {r.totals.deliveryFee > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">{tr("التوصيل", "Delivery")}</dt>
                  <dd className="num ltr">{m(r.totals.deliveryFee, r.totals.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between text-base font-bold">
                <dt>{tr("الإجمالي", "Total")}</dt>
                <dd className="num ltr">{m(r.totals.total, r.totals.currency)}</dd>
              </div>
            </>
          ) : r.needsPrice ? (
            <div className="flex justify-between text-base font-bold">
              <dt>{tr("الإجمالي", "Total")}</dt>
              <dd className="text-sm font-semibold text-faint">{r.quotedAt ? "—" : tr("بانتظار الأسعار", "Waiting for prices")}</dd>
            </div>
          ) : (
            <div className="flex justify-between text-base font-bold">
              <dt>{tr("الإجمالي التقريبي", "Estimated total")}</dt>
              <dd className="num ltr">{m(r.quotedTotal, r.currency)}</dd>
            </div>
          )}
        </dl>
      </div>

      {r.reports.length > 0 && (
        <div className="card rounded-3xl p-5">
          <h2 className="mb-2 font-bold">{tr("بلاغاتك عن هالطلب", "Your reports on this order")}</h2>
          <ul className="grid gap-3">
            {r.reports.map((x) => {
              const c = REPORT_CHOICES.find((k) => k.key === x.category);
              return (
                <li key={x.id} className="rounded-2xl bg-sunken/60 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {c?.icon} {c ? pick(c) : ""}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${x.status === "open" ? "bg-warn/15 text-warn" : "bg-good/15 text-good"}`}>{x.status === "open" ? tr("عم نشوفو", "Looking into it") : tr("تم الحل ✓", "Resolved ✓")}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words">{x.message}</p>
                  {x.reply && (
                    <p className="mt-2 rounded-xl bg-surface p-2">
                      <b>{tr("رد المحل:", "The shop says:")}</b> {x.reply}
                    </p>
                  )}
                  <div className="mt-1 text-xs text-faint">{ago(x.createdAt)}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button className="btn w-full !py-3" onClick={() => setReporting(true)}>
        ⚠️ {tr("في مشكلة بالطلب؟ بلّغنا", "Something wrong? Report it")}
      </button>
      {reporting && (
        <ReportDialog
          requestId={r.id}
          number={r.number}
          onClose={() => setReporting(false)}
          onSent={() => {
            setReporting(false);
            void reload();
          }}
        />
      )}

      {(stage === "waiting" || stage === "pricing") && (
        <button className="btn w-full !py-3 text-bad" disabled={busy} onClick={cancel}>
          {tr("إلغاء الطلب", "Cancel order")}
        </button>
      )}
      {(stage === "declined" || stage === "delivered" || stage === "cancelled") && (
        <Link to="/portal/order" className="btn btn-primary w-full !py-3">
          {tr("اطلب من جديد", "Order again")}
        </Link>
      )}

      {stage === "quoted" && (
        <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 px-4">
          <button disabled={busy} onClick={() => void approve()} className="portal-pop mx-auto flex w-full max-w-xl items-center justify-between rounded-2xl bg-good px-5 py-3.5 font-bold text-white shadow-xl active:scale-[0.99]">
            <span>✓ {tr("وافق على الأسعار", "Approve the prices")}</span>
            {r.totals && <span className="num ltr">{m(r.totals.total, r.totals.currency)}</span>}
          </button>
        </div>
      )}

      {rejecting && (
        <RejectDialog
          number={r.number}
          onClose={() => setRejecting(false)}
          onConfirm={async (reason) => {
            try {
              await post(`/portal/order-requests/${r.id}/reject-prices`, { reason });
              toast(tr("وصل ردّك للمحل", "The shop was told"));
              setRejecting(false);
              await reload();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
      {celebrate && <Celebration title={celebrate.title} sub={celebrate.sub} onClose={() => setCelebrate(null)} />}
    </div>
  );
}
