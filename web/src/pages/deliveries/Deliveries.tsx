import { useState } from "react";
import { Link } from "react-router-dom";
import { useInbox } from "../../components/Inbox";
import { Empty, Field, Modal, PageHeader, Select, Spinner } from "../../components/ui";
import { post } from "../../lib/api";
import { money, num, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { openPrint } from "../../lib/print";
import { useToast } from "../../lib/toast";
import type { PaymentMethod } from "../../lib/types";
import { useData } from "../../lib/useData";
import { NumInput } from "../kit";
import { PortalBadge } from "../orders/shared";

interface DeliveryRow {
  id: string;
  number: number;
  businessDate: string;
  createdAt: string;
  fulfilment: "pickup" | "delivery";
  status: "confirmed" | "delivered";
  paymentStatus: string;
  total: number;
  currency: Currency;
  remaining: number;
  deliveredAt: string | null;
  deliveryCollected: number;
  note: string;
  source: "staff" | "portal";
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientAddress: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  lines: { orderId: string; nameAr: string; nameEn: string; qty: number }[];
}
interface Rep {
  id: string;
  name: string;
  phone: string;
}

type Mode = "full" | "part" | "none";

/** What the deliver dialog needs from an order, on any screen. */
export interface DeliverTarget {
  id: string;
  number: number;
  currency: Currency;
  remaining: number;
  clientName: string | null;
  assignedTo: string | null;
}

/** Tick an order as handed over, and say whether the money came: all of it, part of it, or none. */
export function DeliverDialog({ order, onClose, onDone }: { order: DeliverTarget; onClose: () => void; onDone: () => void }) {
  const { tr, pick, lang, err } = useI18n();
  const toast = useToast();
  const { refresh } = useInbox();
  const fx = useData<{ rate: number | null }>("/fx/current");
  const methods = useData<{ rows: PaymentMethod[] }>("/money/methods");
  const owes = order.remaining > 0;
  const [mode, setMode] = useState<Mode>("full");
  const [currency, setCurrency] = useState<Currency>(order.currency);
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [busy, setBusy] = useState(false);

  const rate = fx.data?.rate ?? null;
  const convert = (v: number, from: Currency, to: Currency) => (from === to ? v : !rate ? null : from === "USD" ? v * rate : v / rate);
  const payable = (methods.data?.rows ?? []).filter((m) => m.kind === "box" && m.active);
  const chosenMethod = methodId || payable.find((m) => m.systemKey === "cash")?.id || payable[0]?.id || "";
  const owedHere = convert(order.remaining, order.currency, currency);
  const typed = num(amount);
  const typedInOrder = Number.isNaN(typed) ? null : convert(typed, currency, order.currency);
  const slack = order.currency === "USD" ? 0.01 : 1;
  const tooMuch = mode === "part" && typedInOrder !== null && typedInOrder > order.remaining + slack;
  const left = mode === "part" && typedInOrder !== null && !tooMuch ? Math.max(0, order.remaining - typedInOrder) : null;
  const ready = !owes || mode === "none" || (!!chosenMethod && (mode === "full" || (typed > 0 && !tooMuch)));

  const save = async () => {
    setBusy(true);
    try {
      const collection = owes ? { mode, currency, methodId: mode === "none" ? null : chosenMethod, ...(mode === "part" ? { amount: typed } : {}) } : undefined;
      await post(`/orders/${order.id}/deliver`, { ...(collection ? { collection } : {}) });
      toast(mode === "none" && owes ? tr("انسجل التسليم، والمبلغ صار دين على الزبون", "Delivered. The amount is now on the client's account") : tr("تم التسليم ✓", "Delivered ✓"));
      void refresh();
      onDone();
    } catch (e) {
      toast(err(e), "error");
      setBusy(false);
    }
  };

  const choices: { key: Mode; icon: string; title: string; sub: string; on: string }[] = [
    { key: "full", icon: "✅", title: tr("دفع كل المبلغ", "Paid everything"), sub: money(order.remaining, order.currency, lang), on: "border-good bg-good/5" },
    { key: "part", icon: "🪙", title: tr("دفع جزء منو", "Paid part of it"), sub: tr("اكتب قديش استلمت", "Type how much you got"), on: "border-warn bg-warn/5" },
    { key: "none", icon: "⛔", title: tr("ما دفع شي", "Paid nothing"), sub: tr("بيصير دين عليه", "Goes on their account"), on: "border-bad bg-bad/5" },
  ];

  return (
    <Modal
      title={tr(`تسليم الطلب #${order.number}`, `Deliver order #${order.number}`)}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("رجوع", "Back")}
          </button>
          <button className="btn btn-primary" disabled={busy || !ready} onClick={() => void save()}>
            ✓ {tr("تم التسليم", "Mark delivered")}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="font-semibold">{order.clientName ?? tr("زبون عابر", "Walk-in")}</p>
        {!owes ? (
          <p className="rounded-xl bg-good/10 p-3 font-semibold text-good">✓ {tr("هالطلب مدفوع، ما في شي تستلمو.", "This order is paid: nothing to collect.")}</p>
        ) : (
          <>
            <div>
              <div className="label">{tr("استلمت المصاري؟", "Did you get the money?")}</div>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={tr("استلمت المصاري؟", "Did you get the money?")}>
                {choices.map((c) => (
                  <button key={c.key} type="button" role="radio" aria-checked={mode === c.key} onClick={() => setMode(c.key)} className={`rounded-xl border-2 p-3 text-start transition-colors ${mode === c.key ? c.on : "border-line hover:border-muted"}`}>
                    <span className="block text-xl" aria-hidden>
                      {c.icon}
                    </span>
                    <span className="block font-bold leading-tight">{c.title}</span>
                    <span className="num block text-xs text-muted">{c.sub}</span>
                  </button>
                ))}
              </div>
            </div>
            {mode !== "none" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr("قبض بأي عملة؟", "Paid in which currency?")}>
                  <div className="inline-flex w-full rounded-lg bg-sunken p-0.5" role="radiogroup" aria-label={tr("العملة", "Currency")}>
                    {(["USD", "SYP"] as const).map((c) => (
                      <button key={c} type="button" role="radio" aria-checked={currency === c} disabled={c !== order.currency && !rate} onClick={() => setCurrency(c)} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-bold disabled:opacity-40 ${currency === c ? "bg-surface text-brand shadow-sm" : "text-muted"}`}>
                        {c === "USD" ? "$" : lang === "ar" ? "ل.س" : "SYP"}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label={tr("طريقة الدفع", "Payment method")} htmlFor="dv-m">
                  <Select id="dv-m" value={chosenMethod} onChange={(e) => setMethodId(e.target.value)}>
                    {payable.map((m) => (
                      <option key={m.id} value={m.id}>
                        {pick(m)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {mode === "part" && (
                  <Field label={tr("المبلغ اللي استلمتو", "Amount you got")} htmlFor="dv-a" error={tooMuch ? tr("أكتر من اللي عليه", "More than the client owes") : undefined}>
                    <NumInput id="dv-a" value={amount} onChange={setAmount} placeholder="0" />
                  </Field>
                )}
                {mode === "full" && currency !== order.currency && owedHere !== null && (
                  <p className="self-end rounded-lg bg-sunken p-2 text-sm">
                    {tr("بدك تستلم", "Collect")} <b className="num ltr">{money(owedHere, currency, lang)}</b>
                  </p>
                )}
                {left !== null && left > 0 && (
                  <p className="self-end rounded-lg bg-warn/10 p-2 text-sm">
                    {tr("بيضل عليه", "Still owes")} <b className="num ltr">{money(left, order.currency, lang)}</b>
                  </p>
                )}
              </div>
            )}
            {mode === "none" && (
              <p className="rounded-xl border border-bad/40 bg-bad/5 p-3 text-sm">
                <b className="num ltr">{money(order.remaining, order.currency, lang)}</b> {tr("رح تنضاف لديون الزبائن بالغيمة، ورح يوصل إشعار إنو الزبون ما دفع.", "goes on what clients owe in the cloud, and a notification says this client did not pay.")}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function PersonLink({ phone }: { phone: string | null }) {
  if (!phone) return null;
  return (
    <a href={`tel:${phone}`} className="num ltr font-semibold text-brand underline-offset-2 hover:underline">
      {phone}
    </a>
  );
}

function DeliveryCard({ o, reps, onAssign, onDeliver }: { o: DeliveryRow; reps: Rep[]; onAssign: (o: DeliveryRow, id: string) => void; onDeliver: (o: DeliveryRow) => void }) {
  const { tr, pick, lang, fmtDate } = useI18n();
  const done = o.status === "delivered";
  return (
    <article className={`card flex flex-col gap-3 ${done ? "opacity-90" : ""}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="num text-xl font-bold">#{o.number}</span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">
            {o.clientId ? (
              <Link to={`/clients/${o.clientId}`} className="hover:underline">
                {o.clientName}
              </Link>
            ) : (
              tr("زبون عابر", "Walk-in")
            )}
            {o.source === "portal" && <PortalBadge label={tr("من التطبيق", "Portal")} />}
          </div>
          <div className="flex flex-wrap gap-x-3 text-sm text-muted">
            <PersonLink phone={o.clientPhone} />
            {o.clientAddress && <span className="break-words">{o.clientAddress}</span>}
          </div>
        </div>
        <span className="chip">{o.fulfilment === "delivery" ? `🛵 ${tr("توصيل", "Delivery")}` : `🛍️ ${tr("استلام", "Pickup")}`}</span>
      </div>

      <ul className="text-sm">
        {o.lines.map((l, i) => (
          <li key={i}>
            <span className="num font-semibold">{l.qty}×</span> {pick(l)}
          </li>
        ))}
      </ul>
      {o.note && <p className="rounded-lg bg-sunken p-2 text-sm">{o.note}</p>}

      {!done && o.fulfilment === "delivery" && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{tr("مين رح يوصّل؟", "Who delivers?")}</span>
          <Select className="w-auto min-w-[10rem] flex-1" value={o.assignedTo ?? ""} onChange={(e) => onAssign(o, e.target.value)} aria-label={tr("مين رح يوصّل؟", "Who delivers?")}>
            <option value="">{tr("لسا ما تحدد", "Not chosen yet")}</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.phone ? ` · ${r.phone}` : ""}
              </option>
            ))}
          </Select>
        </label>
      )}
      {done && o.assignedName && (
        <p className="text-sm text-muted">
          🛵 {tr("وصّله", "Delivered by")} {o.assignedName}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <div className="me-auto">
          <div className="num ltr text-start text-lg font-bold">{money(o.total, o.currency, lang)}</div>
          {done ? (
            o.remaining > 0 ? (
              <div className="text-sm font-semibold text-bad">
                {o.deliveryCollected > 0 ? tr("دفع جزء · ", "Paid part · ") : tr("ما دفع · ", "Did not pay · ")}
                {tr("باقي", "owes")} <span className="num ltr">{money(o.remaining, o.currency, lang)}</span>
              </div>
            ) : (
              <div className="text-sm font-semibold text-good">✓ {tr("مدفوع", "Paid")}</div>
            )
          ) : o.remaining > 0 ? (
            <div className="text-sm font-semibold text-warn">
              {tr("لازم يدفع", "To collect")} <span className="num ltr">{money(o.remaining, o.currency, lang)}</span>
            </div>
          ) : (
            <div className="text-sm font-semibold text-good">✓ {tr("مدفوع", "Paid")}</div>
          )}
          {done && o.deliveredAt && <div className="text-xs text-faint">{fmtDate(o.deliveredAt, true)}</div>}
        </div>
        <button className="btn" onClick={() => openPrint(`/print/receipt/${o.id}`)}>
          🖨 {tr("طباعة", "Print")}
        </button>
        {!done && (
          <button className="btn btn-primary min-h-[44px] px-5" onClick={() => onDeliver(o)}>
            ✓ {tr("تم التسليم", "Delivered")}
          </button>
        )}
      </div>
    </article>
  );
}

/** The manager's orders: what is still to hand over, one tick and one question about the money for each. */
export function DeliveriesPage() {
  const { tr, err, lang } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "done">("open");
  const [onlyMine, setOnlyMine] = useState(true);
  const [deliver, setDeliver] = useState<DeliveryRow | null>(null);
  const list = useData<{ rows: DeliveryRow[]; myEmployeeId: string | null }>(`/orders/deliveries?status=${status}`);
  const reps = useData<{ rows: Rep[] }>("/money/reps");
  const mine = list.data?.myEmployeeId ?? null;
  const rows = (list.data?.rows ?? []).filter((o) => !mine || !onlyMine || o.assignedTo === mine);
  const toCollect = (c: Currency) => rows.filter((o) => o.currency === c).reduce((s, o) => s + o.remaining, 0);

  const assign = async (o: DeliveryRow, id: string) => {
    try {
      await post(`/orders/${o.id}/assign`, { assignedTo: id || null });
      toast(id ? tr("تم التعيين، والزبون بيشوف الاسم والرقم", "Assigned: the client now sees the name and phone") : tr("تم إلغاء التعيين", "Assignment removed"));
      void list.reload();
    } catch (e) {
      toast(err(e), "error");
    }
  };

  return (
    <div>
      <PageHeader title={tr("طلبات التسليم", "Deliveries")} subtitle={tr("كل طلب: اطبعو، علّم إنو تسلّم، وقول إذا استلمت المصاري.", "For each order: print it, tick it delivered, and say whether you got the money.")} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-sunken p-0.5">
          {(
            [
              ["open", tr("للتسليم", "To deliver")],
              ["done", tr("تسلّم اليوم", "Delivered today")],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setStatus(k)} aria-pressed={status === k} className={`rounded-md px-4 py-2 text-sm font-semibold ${status === k ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
              {label}
            </button>
          ))}
        </div>
        {mine && (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-ink" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            {tr("طلباتي أنا بس", "Only mine")}
          </label>
        )}
        {list.data && (
          <span className="ms-auto text-sm text-muted">
            <span className="num">{rows.length}</span> {tr("طلب", "orders")}
            {(["USD", "SYP"] as const).map((c) =>
              toCollect(c) > 0 ? (
                <span key={c}>
                  {" · "}
                  {status === "open" ? tr("للتحصيل", "to collect") : tr("ما اندفع", "unpaid")} <span className="num ltr font-semibold text-ink">{money(toCollect(c), c, lang)}</span>
                </span>
              ) : null,
            )}
          </span>
        )}
      </div>

      {list.error ? (
        <p className="text-bad">{err(list.error)}</p>
      ) : !list.data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty text={status === "open" ? tr("كل الطلبات تسلّمت 🎉", "Everything is delivered 🎉") : tr("ما تسلّم شي اليوم بعد", "Nothing delivered yet today")} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((o) => (
            <DeliveryCard key={o.id} o={o} reps={reps.data?.rows ?? []} onAssign={(x, id) => void assign(x, id)} onDeliver={setDeliver} />
          ))}
        </div>
      )}

      {deliver && (
        <DeliverDialog
          order={deliver}
          onClose={() => setDeliver(null)}
          onDone={() => {
            setDeliver(null);
            void list.reload();
          }}
        />
      )}
    </div>
  );
}
