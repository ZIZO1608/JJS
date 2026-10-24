import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { INBOX_EVENT, useInbox } from "../../components/Inbox";
import { Tabs } from "../../components/Tabs";
import { Empty, Field, Modal, PageHeader, Spinner, TextInput } from "../../components/ui";
import { post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { money, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";

type Status = "pending" | "accepted" | "declined" | "cancelled";
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
  plan: { nameAr: string; nameEn: string; monthlyFee: number; currency: Currency; includedItems: number; discountPct: number };
}

const STATUS: Record<Status, { ar: string; en: string; cls: string }> = {
  pending: { ar: "بانتظار الرد", en: "Waiting", cls: "bg-warn/15 text-warn" },
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

function OrderCard({ r, highlight, onChanged }: { r: OrderRequest; highlight: boolean; onChanged: () => void }) {
  const { tr, pick, lang, err } = useI18n();
  const toast = useToast();
  const ago = useAgo();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
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
  return (
    <article id={`req-${r.id}`} className={`card ${highlight ? "ring-2 ring-brand" : ""} ${r.status === "pending" ? "border-warn/50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold num">#{r.number}</span>
            <StatusChip s={r.status} />
            <span className="text-sm text-faint">{ago(r.createdAt)}</span>
          </div>
          <Link to={`/clients/${r.clientId}`} className="block font-semibold hover:underline">
            {r.clientName}
          </Link>
          {r.clientPhone && <div className="text-sm text-faint ltr text-start">{r.clientPhone}</div>}
        </div>
        <div className="text-end">
          <div className="text-xl font-bold num ltr">{money(r.quotedTotal, r.currency, lang)}</div>
          <div className="text-xs text-faint">
            {r.itemsCount} {tr("قطعة", "items")}
          </div>
        </div>
      </div>

      <ul className="mt-3 grid gap-1 rounded-lg bg-sunken/60 p-3 text-sm">
        {r.lines.map((l, i) => (
          <li key={i}>
            <span className="font-bold num">{l.qty}×</span> {pick(l)}
            {l.options.length > 0 && <span className="text-muted"> — {l.options.map((o) => pick(o)).join("، ")}</span>}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
        <span className="chip">{r.fulfilment === "delivery" ? `🛵 ${tr("توصيل", "Delivery")}` : `🛍️ ${tr("استلام", "Pick up")}`}</span>
        <span className={`chip ${r.paymentChoice === "on_delivery" ? "!bg-warn/15 !text-warn" : ""}`}>{r.paymentChoice === "on_delivery" ? `💵 ${tr("الدفع عند الاستلام", "Pay on delivery")}` : `📒 ${tr("على الحساب", "On account")}`}</span>
        {r.balanceUsd !== null && owes && <span className="chip !bg-bad/10 !text-bad">{tr(`عليه ${money(-r.balanceUsd)}`, `Owes ${money(-r.balanceUsd)}`)}</span>}
      </div>
      {r.note && <p className="mt-2 text-sm">📝 {r.note}</p>}

      {r.status === "pending" ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn !py-2.5 font-bold text-bad" disabled={busy} onClick={() => setDeclining(true)}>
            ✕ {tr("رفض", "Decline")}
          </button>
          <button className="btn btn-primary !border-good !bg-good !py-2.5 font-bold !text-white" disabled={busy} onClick={() => void accept()}>
            ✓ {tr("قبول", "Accept")}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm text-muted">
          {r.decidedByName && <span>{tr(`بواسطة ${r.decidedByName}`, `By ${r.decidedByName}`)}</span>}
          {r.declineReason && <span>· {r.declineReason}</span>}
          {r.order && (
            <Link className="ms-auto font-semibold text-ink underline" to={`/print/receipt/${r.order.id}`} target="_blank">
              {tr(`فاتورة #${r.order.number}`, `Invoice #${r.order.number}`)}
            </Link>
          )}
        </div>
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
        {tr(`${r.plan.includedItems} قطعة مجانية · خصم ${r.plan.discountPct}%`, `${r.plan.includedItems} free items · ${r.plan.discountPct}% off`)}
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

export function RequestsPage() {
  const { tr } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "subscriptions" ? "subscriptions" : "orders";
  const highlight = params.get("id");
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const { pending, refresh } = useInbox();
  const orders = useData<{ rows: OrderRequest[] }>(tab === "orders" ? `/requests/orders?status=${status}` : null);
  const subs = useData<{ rows: SubRequest[] }>(tab === "subscriptions" ? `/requests/subscriptions?status=${status}` : null);
  const reloadAll = () => {
    void orders.reload();
    void subs.reload();
    void refresh();
  };

  useEffect(() => {
    const on = () => {
      void orders.reload();
      void subs.reload();
    };
    window.addEventListener(INBOX_EVENT, on);
    return () => window.removeEventListener(INBOX_EVENT, on);
  }, [orders.reload, subs.reload]);

  useEffect(() => {
    if (highlight) document.getElementById(`req-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, orders.data, subs.data]);

  const badge = (n: number) => (n ? ` (${n})` : "");
  const rowsLoading = tab === "orders" ? !orders.data : !subs.data;

  return (
    <>
      <PageHeader title={tr("طلبات الزبائن", "Client requests")} subtitle={tr("طلبات أرسلها الزبائن من هواتفهم. اقبلها لتصبح فاتورة، أو ارفضها مع سبب.", "Orders clients sent from their phones. Accept to turn one into an invoice, or decline with a reason.")} />
      <Tabs
        tabs={[
          { key: "orders", label: tr("الطلبات", "Orders") + badge(pending.orders) },
          { key: "subscriptions", label: tr("الاشتراكات", "Subscriptions") + badge(pending.subscriptions) },
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
