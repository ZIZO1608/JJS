import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Spinner } from "../../components/ui";
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
  const toast = useToast();
  const { data, reload } = useData<{ request: Detail }>(`/portal/order-requests/${id}`);
  useRefreshOn(reload);
  const [busy, setBusy] = useState(false);
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
