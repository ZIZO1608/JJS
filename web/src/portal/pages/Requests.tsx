import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Modal, Spinner } from "../../components/ui";
import { post } from "../../lib/api";
import type { Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import { stageOf, StageChip, useAgo, useMoney, useRefreshOn, type PortalRequest, type Stage } from "../shared";
import { RequestRow } from "./Home";

type Filter = "all" | "active" | "done";
const ACTIVE: Stage[] = ["waiting", "accepted"];

export function RequestsPage() {
  const { tr } = useI18n();
  const m = useMoney();
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
            <RequestRow key={r.id} r={r} ago={ago(r.createdAt)} money={m(r.order?.total ?? r.quotedTotal, r.order?.currency ?? r.currency)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Detail extends PortalRequest {
  lines: { nameAr: string; nameEn: string; qty: number; freeQty: number; unitPrice: number; lineTotal: number; options: { nameAr: string; nameEn: string }[] }[];
  totals: { subtotal: number; discount: number; taxTotal: number; deliveryFee: number; total: number; currency: Currency } | null;
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
  if (stage === "declined") steps.push({ label: tr("رُفض الطلب", "Declined"), when: r.decidedAt, state: "bad" });
  else if (r.status === "cancelled") steps.push({ label: tr("ألغيت الطلب", "You cancelled it"), state: "bad" });
  else {
    steps.push({ label: stage === "waiting" ? tr("بانتظار موافقة المحل", "Waiting for the shop") : tr("قبله المحل", "Accepted by the shop"), when: r.decidedAt, state: stage === "waiting" ? "now" : "done" });
    if (stage === "cancelled") steps.push({ label: tr("أُلغي الطلب", "Order cancelled"), when: r.order?.updatedAt, state: "bad" });
    else steps.push({ label: r.fulfilment === "delivery" ? tr("تم التوصيل", "Delivered") : tr("تم الاستلام", "Picked up"), when: stage === "delivered" ? r.order?.updatedAt : null, state: stage === "delivered" ? "done" : stage === "accepted" ? "now" : "todo" });
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
  return (
    <div className="grid gap-4">
      <Link to="/portal/orders" className="text-sm font-semibold text-muted">
        {tr("→ طلباتي", "← My orders")}
      </Link>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {tr("طلب", "Order")} <span className="num ltr">#{r.number}</span>
        </h1>
        <StageChip stage={stage} />
      </div>

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
                {l.freeQty > 0 && <div className="text-xs text-good">{tr(`${l.freeQty} مجاناً`, `${l.freeQty} free`)}</div>}
              </div>
              {r.totals && <span className="num ltr">{m(l.lineTotal, r.totals.currency)}</span>}
            </li>
          ))}
        </ul>
        {r.note && <p className="mt-2 rounded-xl bg-sunken/60 p-3 text-sm">📝 {r.note}</p>}
        <dl className="mt-3 grid gap-1 border-t border-line pt-3 text-sm">
          {r.totals ? (
            <>
              {r.totals.discount > 0 && (
                <div className="flex justify-between text-good">
                  <dt>{tr("الخصم", "Discount")}</dt>
                  <dd className="num ltr">−{m(r.totals.discount, r.totals.currency)}</dd>
                </div>
              )}
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

      {stage === "waiting" && (
        <button className="btn w-full !py-3 text-bad" disabled={busy} onClick={cancel}>
          {tr("إلغاء الطلب", "Cancel order")}
        </button>
      )}
      {(stage === "declined" || stage === "delivered" || stage === "cancelled") && (
        <Link to="/portal/order" className="btn btn-primary w-full !py-3">
          {tr("اطلب من جديد", "Order again")}
        </Link>
      )}
    </div>
  );
}
