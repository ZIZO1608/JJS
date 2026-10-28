import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Empty, Modal, PageHeader, Select, Spinner, TextInput } from "../../components/ui";
import { post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { addDaysTo, money, qty, today, usd } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { openPrint } from "../../lib/print";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import type { Lookup } from "../../lib/types";
import { ReturnDialog } from "../distribution/common";
import { Confirm, discountWords, PortalBadge, payStatusLabel, statusLabel, timeOf, typeLabel, type OrderDetail, type OrderRow } from "./shared";

interface DueRow {
  id: string;
  clientId: string;
  clientName: string;
  lines: { productId: string; qty: number }[];
  orderedToday: boolean;
}

function OrderDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { tr, pick, lang, err, fmtDate } = useI18n();
  const { can, simple } = useAuth();
  const toast = useToast();
  const { data } = useData<{ order: OrderDetail }>(`/orders/${id}`);
  const reps = useData<{ rows: { id: string; name: string }[] }>(can("orders", "edit") ? "/money/reps" : null);
  const [assign, setAssign] = useState<string>("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);
  const reasons = useData<{ items: Lookup[] }>(confirmCancel ? "/lookups?type=cancel_reason" : null);
  const o = data?.order;

  const act = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await fn();
      toast(okText);
      onChanged();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={o ? `${tr("طلب", "Order")} #${o.number}` : tr("طلب", "Order")}
      onClose={onClose}
      footer={
        o && (
          <>
            {o.status !== "cancelled" && !o.consignmentId && can("orders", "delete") && (
              <button className="btn btn-ghost btn-danger me-auto" disabled={busy} onClick={() => setConfirmCancel(true)}>
                {tr("إلغاء الطلب", "Cancel order")}
              </button>
            )}
            {o.status !== "cancelled" && o.type === "normal" && can("orders", "edit") && (
              <button className="btn" disabled={busy} onClick={() => setReturning(true)}>
                ↩ {tr("رجعت الطلبية", "Came back")}
              </button>
            )}
            <button className="btn" onClick={onClose}>
              {tr("إغلاق", "Close")}
            </button>
            {o.status === "confirmed" && can("orders", "edit") && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => act(() => post(`/orders/${o.id}/deliver`, { assignedTo: assign || o.assignedTo || null }), tr("تم التسليم", "Marked delivered"))}
              >
                {tr("تم التسليم", "Mark delivered")}
              </button>
            )}
            {!simple && (
              <button className="btn" onClick={() => openPrint(`/print/receipt/${o.id}?size=a4`)}>
                A4
              </button>
            )}
            <button className="btn btn-primary" onClick={() => openPrint(`/print/receipt/${o.id}`)}>
              {tr("طباعة الفاتورة", "Print receipt")}
            </button>
          </>
        )
      }
    >
      {!o ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted">
            <span>{fmtDate(o.createdAt ?? `${o.businessDate}T12:00:00`, !!o.createdAt)}</span>
            <span className="font-semibold text-ink">{o.clientName ?? tr("زبون عابر", "Walk-in")}</span>
            {o.type !== "normal" && <span className="chip">{typeLabel(o.type, tr)}</span>}
            <span>{statusLabel(o.status, tr)}</span>
            <span>
              {payStatusLabel(o.paymentStatus, tr)}
              {o.method && ` · ${pick(o.method)}`}
            </span>
            {o.fulfilment === "delivery" && (
              <span>
                {tr("توصيل", "Delivery")}
                {o.assignedName && ` · ${o.assignedName}`}
              </span>
            )}
            {o.userName && (
              <span>
                {tr("سجّله", "By")} {o.userName}
              </span>
            )}
          </div>
          <table className="w-full">
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td num w-12">×{l.qty}</td>
                  <td className="td">
                    <div className="font-semibold">{pick(l)}</div>
                    {l.options.length > 0 && <div className="text-xs text-muted">{l.options.map((x) => pick(x)).join("، ")}</div>}
                    {l.freeQty > 0 && (
                      <div className="text-xs text-good">
                        {tr("مجاني", "Free")} ×{l.freeQty}
                      </div>
                    )}
                  </td>
                  <td className="td text-end">
                    <span className="num ltr">{money(l.lineTotal, o.currency, lang)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ms-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt className="text-muted">{tr("المجموع", "Subtotal")}</dt>
            <dd className="num ltr text-end">{money(o.subtotal, o.currency, lang)}</dd>
            {o.discount > 0 && (
              <>
                <dt className="text-muted">{discountWords(o.discountReason, tr) || tr("خصم", "Discount")}</dt>
                <dd className="num ltr text-end">−{money(o.discount, o.currency, lang)}</dd>
              </>
            )}
            {o.taxes.map((x) => (
              <div key={x.id} className="contents">
                <dt className="text-muted">
                  {pick(x)} {x.kind === "percent" && `${x.value}%`}
                </dt>
                <dd className="num ltr text-end">{money(x.amount, o.currency, lang)}</dd>
              </div>
            ))}
            {o.deliveryFee > 0 && (
              <>
                <dt className="text-muted">{tr("أجرة التوصيل", "Delivery fee")}</dt>
                <dd className="num ltr text-end">{money(o.deliveryFee, o.currency, lang)}</dd>
              </>
            )}
            <dt className="text-base font-bold">{tr("الإجمالي", "Total")}</dt>
            <dd className="num ltr text-end text-base font-bold">{money(o.total, o.currency, lang)}</dd>
            {o.currency !== "USD" && (
              <>
                <dt className="text-xs text-faint">USD</dt>
                <dd className="num ltr text-end text-xs text-faint">{usd(o.totalUsd)}</dd>
              </>
            )}
            {!simple && can("costing", "see_cost") && (
              <>
                <dt className="text-xs text-faint">{tr("التكلفة", "Cost")}</dt>
                <dd className="num ltr text-end text-xs text-faint">{usd(o.costUsd)}</dd>
              </>
            )}
          </dl>
          {o.paymentStatus === "partial" && o.paidAmount !== undefined && (
            <p className="rounded-lg bg-sunken p-2">
              {tr("المدفوع", "Paid")} <span className="num ltr font-semibold">{money(o.paidAmount, o.currency, lang)}</span> · {tr("الباقي على الحساب", "Rest on account")}{" "}
              <span className="num ltr font-semibold">{money(o.total - o.paidAmount, o.currency, lang)}</span>
            </p>
          )}
          {o.status === "cancelled" && (
            <p className="rounded-lg border border-bad/40 p-2 text-bad">
              {tr("ملغى", "Cancelled")}
              {o.cancelReason ? ` · ${o.cancelReason}` : ""}
            </p>
          )}
          {o.consignmentId && (
            <p className="text-muted">
              {tr("هالفاتورة من تسوية بضاعة بالأمانة. للتصحيح سجّل مرتجع.", "This invoice comes from a consignment settlement. Use a return to correct it.")}
            </p>
          )}
          {o.note && <p className="rounded-lg bg-sunken p-2">{o.note}</p>}
          {o.status === "confirmed" && o.fulfilment === "delivery" && can("orders", "edit") && (reps.data?.rows.length ?? 0) > 0 && (
            <label className="flex items-center gap-2">
              <span className="text-muted">{tr("مين وصّله؟", "Delivered by")}</span>
              <Select className="max-w-[14rem]" value={assign || o.assignedTo || ""} onChange={(e) => setAssign(e.target.value)}>
                <option value="">—</option>
                {reps.data!.rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
      )}
      {confirmCancel && o && (
        <Confirm
          danger
          title={tr(`إلغاء الطلب #${o.number}؟`, `Cancel order #${o.number}?`)}
          body={
            <div className="grid gap-3">
              <p className="text-muted">
                {tr("يرجع المخزون، ويرجع المبلغ من الصندوق أو من حساب الزبون.", "Stock goes back, and the money is reversed from the box or the client's account.")}
              </p>
              <div className="flex flex-wrap gap-2">
                {(reasons.data?.items ?? []).map((r) => (
                  <button key={r.id} type="button" className={`btn px-3 py-1 text-sm ${reason === pick(r) ? "btn-primary" : ""}`} onClick={() => setReason(pick(r))}>
                    {pick(r)}
                  </button>
                ))}
              </div>
              <TextInput
                placeholder={tr("سبب الإلغاء", "Reason for cancelling")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label={tr("سبب الإلغاء", "Reason for cancelling")}
              />
            </div>
          }
          yes={tr("نعم، ألغِ الطلب", "Yes, cancel it")}
          no={tr("رجوع", "Back")}
          onClose={() => setConfirmCancel(false)}
          onYes={() => {
            setConfirmCancel(false);
            void act(() => post(`/orders/${o.id}/cancel`, { reason: reason.trim() }), tr("تم إلغاء الطلب", "Order cancelled"));
          }}
        />
      )}
      {returning && o && (
        <ReturnDialog
          clientId={o.clientId ?? undefined}
          orderId={o.id}
          onClose={() => setReturning(false)}
          onDone={() => {
            setReturning(false);
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

export function OrdersPage() {
  const { tr, pick, lang, err } = useI18n();
  const { can, simple } = useAuth();
  const nav = useNavigate();
  const [date, setDate] = useState(today());
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useData<{ rows: OrderRow[] }>(`/orders?date=${date}`);
  const due = useData<{ rows: DueRow[] }>(date === today() ? "/orders/recurring/due" : null);
  const dueOpen = (due.data?.rows ?? []).filter((r) => !r.orderedToday);

  const rows = (list.data?.rows ?? []).filter((o) => {
    const n = q.trim().toLowerCase();
    return !n || String(o.number) === n || (o.clientName ?? "").toLowerCase().includes(n);
  });
  const live = rows.filter((o) => o.status !== "cancelled");
  const totalUsd = live.reduce((s, o) => s + o.totalUsd, 0);

  return (
    <div>
      <PageHeader
        title={tr("الطلبات", "Orders")}
        actions={
          can("orders", "create") && (
            <Link to="/orders/new" className={`btn btn-primary ${simple ? "px-6 py-3 text-lg" : ""}`}>
              {tr("+ طلب جديد", "+ New order")}
            </Link>
          )
        }
      />

      {dueOpen.length > 0 && can("orders", "create") && (
        <div className="card mb-4">
          <h2 className="mb-2 font-semibold">{tr("طلبات ثابتة مستحقة اليوم", "Regular orders due today")}</h2>
          <ul className="grid gap-2">
            {dueOpen.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{r.clientName}</span>
                <span className="text-sm text-muted">
                  {qty(r.lines.reduce((s, l) => s + l.qty, 0))} {tr("قطعة", "items")}
                </span>
                <button className="btn ms-auto py-1.5" onClick={() => nav(`/orders/new?recurring=${r.id}`)}>
                  {tr("سجّل الطلب", "Enter order")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost px-2" onClick={() => setDate(addDaysTo(date, -1))} aria-label={tr("اليوم السابق", "Previous day")}>
          {lang === "ar" ? "→" : "←"}
        </button>
        <TextInput type="date" className="w-auto" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="btn btn-ghost px-2" disabled={date >= today()} onClick={() => setDate(addDaysTo(date, 1))} aria-label={tr("اليوم التالي", "Next day")}>
          {lang === "ar" ? "←" : "→"}
        </button>
        {date !== today() && (
          <button className="btn btn-ghost" onClick={() => setDate(today())}>
            {tr("اليوم", "Today")}
          </button>
        )}
        <TextInput type="search" className="max-w-xs" placeholder={tr("رقم الطلب أو اسم الزبون", "Order no. or client")} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ms-auto text-sm text-muted">
          <span className="num">{live.length}</span> {tr("طلب", "orders")} · <span className="num ltr">{usd(totalUsd)}</span>
        </span>
      </div>

      {list.error ? (
        <p className="text-bad">{err(list.error)}</p>
      ) : !list.data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty text={tr("لا يوجد طلبات بهذا اليوم", "No orders on this day")} />
      ) : simple ? (
        <div className="grid gap-2">
          {rows.map((o) => (
            <button key={o.id} onClick={() => setOpen(o.id)} className={`card flex items-center gap-3 text-start hover:border-ink ${o.status === "cancelled" ? "opacity-50" : ""}`}>
              <span className="num text-lg font-bold">#{o.number}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {o.clientName ?? tr("زبون عابر", "Walk-in")}
                  {o.source === "portal" && <PortalBadge label={tr("من التطبيق", "Portal")} />}
                </span>
                <span className="block text-sm text-muted">
                  {timeOf(o.createdAt, lang)} · {o.itemsCount} {tr("قطعة", "items")} · {o.status === "cancelled" ? statusLabel(o.status, tr) : payStatusLabel(o.paymentStatus, tr)}
                  {o.fulfilment === "delivery" && ` · ${tr("توصيل", "Delivery")}`}
                </span>
              </span>
              <span className="num ltr text-lg font-bold">{money(o.total, o.currency, lang)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">#</th>
                <th className="th">{tr("الوقت", "Time")}</th>
                <th className="th">{tr("الزبون", "Client")}</th>
                <th className="th">{tr("قطع", "Items")}</th>
                <th className="th">{tr("التسليم", "Fulfilment")}</th>
                <th className="th">{tr("الدفع", "Payment")}</th>
                <th className="th text-end">{tr("الإجمالي", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className={`cursor-pointer hover:bg-sunken ${o.status === "cancelled" ? "text-faint line-through" : ""}`} onClick={() => setOpen(o.id)}>
                  <td className="td num font-semibold">{o.number}</td>
                  <td className="td num">{timeOf(o.createdAt, lang)}</td>
                  <td className="td">
                    {o.clientName ?? <span className="text-muted">{tr("زبون عابر", "Walk-in")}</span>}
                    {o.source === "portal" && <PortalBadge label={tr("من التطبيق", "Portal")} />}
                    {o.type !== "normal" && <span className="chip ms-2">{typeLabel(o.type, tr)}</span>}
                  </td>
                  <td className="td num">
                    {o.itemsCount}
                    {o.freeItems > 0 && (
                      <span className="ms-1 text-xs text-good">
                        (+{o.freeItems} {tr("مجاني", "free")})
                      </span>
                    )}
                  </td>
                  <td className="td">
                    {o.fulfilment === "delivery" ? (
                      <>
                        {tr("توصيل", "Delivery")}
                        {o.assignedName && <span className="text-muted"> · {o.assignedName}</span>}
                        {o.status === "delivered" && <span className="ms-1 text-good">✓</span>}
                      </>
                    ) : (
                      <span className="text-muted">{tr("استلام", "Pickup")}</span>
                    )}
                  </td>
                  <td className="td">
                    {o.status === "cancelled" ? statusLabel(o.status, tr) : payStatusLabel(o.paymentStatus, tr)}
                    {o.method && o.status !== "cancelled" && <span className="text-muted"> · {pick(o.method)}</span>}
                  </td>
                  <td className="td text-end font-semibold">
                    <span className="num ltr">{money(o.total, o.currency, lang)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <OrderDialog
          id={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            void list.reload();
          }}
        />
      )}
    </div>
  );
}
