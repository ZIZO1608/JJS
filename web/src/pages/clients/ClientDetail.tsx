import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Stat, Tabs } from "../../components/Tabs";
import { ConfirmDialog, Empty, Field, Modal, PageHeader, Select, Spinner, TextInput } from "../../components/ui";
import { del, get, post, put } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { money, monthStartOf, num, today, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { openPrint } from "../../lib/print";
import { useToast } from "../../lib/toast";
import type { Catalog, ClientSummary, Named } from "../../lib/types";
import { useData } from "../../lib/useData";
import { AdjustDialog, BalanceText, ClientDialog, PaymentDialog } from "./ClientDialogs";
import { LateBadge } from "./Clients";
import { ConsignmentDialog, ReturnDialog, STATUS_LABEL, SettleDialog, waLink, type Consignment } from "../distribution/common";

type MoveType = "charge" | "payment" | "topup" | "refund" | "adjust" | "subscription" | "return" | "opening";
interface ClientMove {
  id: string;
  createdAt: string;
  type: MoveType;
  amount: number;
  currency: Currency;
  amountUsd: number;
  orderId: string | null;
  note: string;
  businessDate: string;
  userName?: string | null;
  balanceUsd?: number;
}
interface Plan extends Named {
  monthlyFee: number;
  currency: Currency;
  discountPct: number;
  includedItems: number;
  active: boolean;
}
interface Subscription {
  id: string;
  planId: string;
  startDate: string;
  endDate: string;
  status: "active" | "ended" | "cancelled";
  autoRenew: boolean;
  plan: Plan;
}
interface RecLine {
  productId: string;
  qty: number;
  optionIds: string[];
}
interface Recurring {
  id: string;
  days: string;
  note: string;
  active: boolean;
  lines: RecLine[];
}
interface Detail {
  client: ClientSummary;
  loyalty: { enabled: boolean; buyQty: number; freeQty: number; count: number; progress: number; earned: number; redeemed: number; available: number };
  analytics: {
    byCategory: { categoryId: string; nameAr: string; nameEn: string; qty: number }[];
    topProducts: { productId: string; nameAr: string; nameEn: string; qty: number }[];
    monthly: { month: string; orders: number; items: number; totalUsd: number }[];
    ordersCount: number;
    avgOrderUsd: number;
    lastOrderDate: string | null;
    trials: number;
    converted: boolean;
  };
  moves: ClientMove[];
  subscriptions: Subscription[];
  prices: { id: string; productId: string; price: number; currency: Currency; nameAr: string; nameEn: string }[];
  recurring: Recurring[];
  totals?: { salesUsd: number; paidUsd: number; returnsUsd: number };
  area?: Named | null;
  priceList?: Named | null;
  rep?: { id: string; name: string } | null;
  returns?: ReturnRow[];
  consignments?: ConsRow[];
}
interface ReturnRow {
  id: string;
  number: number;
  businessDate: string;
  total: number;
  currency: Currency;
  settlement: "credit" | "refund" | "none";
  note: string;
}
interface ConsRow {
  id: string;
  number: number;
  businessDate: string;
  status: "open" | "settled" | "cancelled";
  currency: Currency;
}

const DAYS: { ar: string; en: string }[] = [
  { ar: "أحد", en: "Sun" },
  { ar: "اثنين", en: "Mon" },
  { ar: "ثلاثاء", en: "Tue" },
  { ar: "أربعاء", en: "Wed" },
  { ar: "خميس", en: "Thu" },
  { ar: "جمعة", en: "Fri" },
  { ar: "سبت", en: "Sat" },
];

export function useMoveLabel() {
  const { tr } = useI18n();
  return (t: MoveType) =>
    ({
      charge: tr("طلب بالدين", "Order on credit"),
      payment: tr("دفعة", "Payment"),
      topup: tr("شحن رصيد", "Top-up"),
      refund: tr("إرجاع", "Refund"),
      adjust: tr("تعديل", "Adjustment"),
      subscription: tr("اشتراك شهري", "Monthly subscription"),
      return: tr("مرتجع", "Return"),
      opening: tr("رصيد سابق", "Opening balance"),
    })[t] ?? t;
}

function MovesTable({ moves, showBalance }: { moves: ClientMove[]; showBalance?: boolean }) {
  const { tr } = useI18n();
  const label = useMoveLabel();
  if (!moves.length) return <Empty text={tr("ما في حركات", "No moves yet")} />;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="th">{tr("التاريخ", "Date")}</th>
            <th className="th">{tr("الحركة", "Move")}</th>
            <th className="th">{tr("ملاحظة", "Note")}</th>
            <th className="th text-end">{tr("المبلغ", "Amount")}</th>
            {showBalance && <th className="th text-end">{tr("الرصيد", "Balance")}</th>}
          </tr>
        </thead>
        <tbody>
          {moves.map((m) => (
            <tr key={m.id}>
              <td className="td num ltr text-start whitespace-nowrap">{m.businessDate}</td>
              <td className="td">{label(m.type)}</td>
              <td className="td text-muted">{m.note}</td>
              <td className={`td text-end num ltr whitespace-nowrap ${m.amountUsd < 0 ? "text-bad" : ""}`}>
                {m.amount > 0 ? "+" : ""}
                {money(m.amount, m.currency)}
                {m.currency !== "USD" && <span className="block text-xs text-faint">{money(m.amountUsd)}</span>}
              </td>
              {showBalance && m.balanceUsd !== undefined && (
                <td className="td text-end">
                  <BalanceText usd={m.balanceUsd} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 flex-1 rounded-full bg-sunken">
      <div className="h-2 rounded-full bg-ink" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </div>
  );
}

function Overview({ d }: { d: Detail }) {
  const { tr, pick } = useI18n();
  const a = d.analytics;
  const maxMonth = Math.max(0, ...a.monthly.map((m) => m.totalUsd));
  const maxCat = Math.max(0, ...a.byCategory.map((c) => c.qty));
  const L = d.loyalty;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("عدد الطلبات", "Orders")} value={String(a.ordersCount)} />
        <Stat label={tr("متوسط الطلب", "Average order")} value={money(a.avgOrderUsd)} />
        <Stat label={tr("آخر طلب", "Last order")} value={a.lastOrderDate ?? "—"} />
        <Stat
          label={tr("تجارب مجانية", "Free trials")}
          value={String(a.trials)}
          sub={a.trials ? (a.converted ? tr("صار زبون دائم ✓", "Became a paying client ✓") : tr("لسا ما اشترى", "Not converted yet")) : undefined}
          tone={a.trials && a.converted ? "good" : undefined}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 font-semibold">{tr("المبيعات آخر ٦ أشهر", "Sales, last 6 months")}</h3>
          {a.monthly.length === 0 ? (
            <p className="text-faint">{tr("ما في طلبات بعد", "No orders yet")}</p>
          ) : (
            <div className="grid gap-2">
              {a.monthly.map((m) => (
                <div key={m.month} className="flex items-center gap-3 text-sm">
                  <span className="w-16 num ltr text-start text-muted">{m.month}</span>
                  <Bar value={m.totalUsd} max={maxMonth} />
                  <span className="w-28 text-end num ltr">
                    {money(m.totalUsd)} <span className="text-xs text-faint">· {m.items}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3 className="mb-3 font-semibold">{tr("برنامج الولاء (هذا الشهر)", "Loyalty (this month)")}</h3>
          {L.enabled ? (
            <>
              <p className="mb-2 text-sm text-muted">{tr(`كل ${L.buyQty} قطعة = ${L.freeQty} مجاناً`, `Every ${L.buyQty} items = ${L.freeQty} free`)}</p>
              <div className="flex items-center gap-3">
                <Bar value={L.progress} max={L.buyQty} />
                <span className="num ltr text-sm">
                  {L.progress}/{L.buyQty}
                </span>
              </div>
              <p className="mt-2 text-sm">
                {tr("اشترى هذا الشهر:", "Bought this month:")} <b className="num">{L.count}</b> · {tr("مجاني متاح:", "Free available:")} <b className="num">{L.available}</b> ·{" "}
                {tr("استخدم:", "Used:")} <b className="num">{L.redeemed}</b>
              </p>
            </>
          ) : (
            <p className="text-faint">{tr("برنامج الولاء متوقف من الإعدادات", "Loyalty is turned off in Settings")}</p>
          )}
        </div>
        <div className="card">
          <h3 className="mb-3 font-semibold">{tr("الأكثر طلباً (٣ أشهر)", "Top products (3 months)")}</h3>
          {a.topProducts.length === 0 ? (
            <p className="text-faint">—</p>
          ) : (
            <ol className="grid gap-1.5 text-sm">
              {a.topProducts.map((p, i) => (
                <li key={p.productId} className="flex justify-between gap-2">
                  <span>
                    <span className="me-2 text-faint num">{i + 1}.</span>
                    {pick(p)}
                  </span>
                  <span className="num">{p.qty}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="card">
          <h3 className="mb-3 font-semibold">{tr("حسب الصنف (هذا الشهر)", "By category (this month)")}</h3>
          {a.byCategory.length === 0 ? (
            <p className="text-faint">—</p>
          ) : (
            <div className="grid gap-2">
              {a.byCategory.map((c) => (
                <div key={c.categoryId} className="flex items-center gap-3 text-sm">
                  <span className="w-24 truncate">{pick(c)}</span>
                  <Bar value={c.qty} max={maxCat} />
                  <span className="w-10 text-end num">{c.qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Statement({ clientId }: { clientId: string }) {
  const { tr } = useI18n();
  const [range, setRange] = useState({ from: monthStartOf(today()), to: today() });
  const { data } = useData<{
    openingUsd: number;
    closingUsd: number;
    lines: ClientMove[];
    returns?: ReturnRow[];
    orders: { id: string; number: number; date: string; total: number; currency: Currency; itemsCount: number }[];
  }>(`/clients/${clientId}/statement?from=${range.from}&to=${range.to}`);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={tr("من", "From")} htmlFor="st-from">
          <TextInput id="st-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field label={tr("إلى", "To")} htmlFor="st-to">
          <TextInput id="st-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </Field>
        <button className="btn" onClick={() => openPrint(`/print/statement/${clientId}?from=${range.from}&to=${range.to}`)}>
          {tr("اطبع كشف الحساب", "Print statement")}
        </button>
      </div>
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="card">
              <div className="text-sm text-muted">{tr("رصيد أول المدة", "Opening balance")}</div>
              <BalanceText usd={data.openingUsd} />
            </div>
            <div className="card">
              <div className="text-sm text-muted">{tr("رصيد آخر المدة", "Closing balance")}</div>
              <BalanceText usd={data.closingUsd} />
            </div>
            <div className="card">
              <div className="text-sm text-muted">{tr("طلبات بالفترة", "Orders in range")}</div>
              <div className="font-semibold num">{data.orders.length}</div>
            </div>
          </div>
          <MovesTable moves={data.lines} showBalance />
          {data.orders.length > 0 && (
            <div className="card p-0">
              <div className="border-b border-line px-3 py-2 text-sm font-semibold">{tr("الطلبات", "Orders")}</div>
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id}>
                      <td className="td num">#{o.number}</td>
                      <td className="td num ltr text-start">{o.date}</td>
                      <td className="td">{tr(`${o.itemsCount} قطعة`, `${o.itemsCount} items`)}</td>
                      <td className="td text-end num ltr">{money(o.total, o.currency)}</td>
                      <td className="td text-end">
                        <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => openPrint(`/print/receipt/${o.id}`)}>
                          {tr("فاتورة", "Receipt")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(data.returns?.length ?? 0) > 0 && <ReturnsTable rows={data.returns!} />}
        </>
      )}
    </div>
  );
}

function ReturnsTable({ rows }: { rows: ReturnRow[] }) {
  const { tr, pick } = useI18n();
  if (!rows.length) return <Empty text={tr("ما في مرتجعات", "No returns")} />;
  return (
    <div className="card p-0">
      <div className="border-b border-line px-3 py-2 text-sm font-semibold">{tr("المرتجعات", "Returns")}</div>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="td num">R{r.number}</td>
              <td className="td num ltr text-start">{r.businessDate}</td>
              <td className="td">{pick(STATUS_LABEL[r.settlement === "credit" ? "credit_s" : r.settlement]!)}</td>
              <td className="td text-muted">{r.note}</td>
              <td className="td text-end num ltr">{money(r.total, r.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsignmentsTable({ rows, onSettle }: { rows: ConsRow[]; onSettle?: (id: string) => void }) {
  const { tr, pick } = useI18n();
  if (!rows.length) return <Empty text={tr("ما في بضاعة بالأمانة", "No consignments")} />;
  return (
    <div className="card p-0">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="td num">C{r.number}</td>
              <td className="td num ltr text-start">{r.businessDate}</td>
              <td className="td">
                <span className="chip">{pick(STATUS_LABEL[r.status]!)}</span>
              </td>
              <td className="td text-end">
                {r.status === "open" && onSettle && (
                  <button className="btn btn-primary px-3 py-1 text-sm" onClick={() => onSettle(r.id)}>
                    {tr("تسوية", "Settle")}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpecialPrices({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const { tr, pick, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const catalog = useData<Catalog>("/menu/catalog");
  const [vals, setVals] = useState<Record<string, { price: string; currency: Currency }>>({});
  useEffect(() => {
    setVals(Object.fromEntries(d.prices.map((p) => [p.productId, { price: String(p.price), currency: p.currency }])));
  }, [d.prices]);
  if (!catalog.data) return <Spinner />;
  const editable = can("clients", "edit");
  const save = async () => {
    try {
      const prices = Object.entries(vals)
        .filter(([, v]) => v.price.trim() !== "" && !Number.isNaN(num(v.price)))
        .map(([productId, v]) => ({ productId, price: num(v.price), currency: v.currency }));
      await put(`/clients/${d.client.id}/prices`, { prices });
      toast(tr("تم حفظ الأسعار", "Prices saved"));
      onSaved();
    } catch (e) {
      toast(err(e), "error");
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">
        {tr(
          "سعر خاص لهذا الزبون بدل السعر العادي. اتركه فاضي ليستخدم السعر العادي.",
          "A special price for this client instead of the menu price. Leave empty to use the normal price.",
        )}
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="th">{tr("المنتج", "Product")}</th>
              <th className="th text-end">{tr("السعر العادي", "Menu price")}</th>
              <th className="th">{tr("السعر الخاص", "Special price")}</th>
            </tr>
          </thead>
          <tbody>
            {catalog.data.products
              .filter((p) => p.active)
              .map((p) => {
                const v = vals[p.id] ?? { price: "", currency: p.currency };
                return (
                  <tr key={p.id}>
                    <td className="td">{pick(p)}</td>
                    <td className="td text-end num ltr text-muted">{money(p.price, p.currency)}</td>
                    <td className="td">
                      <div className="flex max-w-[220px] gap-1">
                        <input
                          className="input py-1 num"
                          dir="ltr"
                          inputMode="decimal"
                          disabled={!editable}
                          value={v.price}
                          onChange={(e) => setVals({ ...vals, [p.id]: { ...v, price: e.target.value } })}
                          aria-label={tr(`سعر خاص ${p.nameAr}`, `Special price ${p.nameEn}`)}
                        />
                        <Select
                          className="input w-20 py-1"
                          disabled={!editable}
                          value={v.currency}
                          onChange={(e) => setVals({ ...vals, [p.id]: { ...v, currency: e.target.value as Currency } })}
                          aria-label={tr("العملة", "Currency")}
                        >
                          <option value="USD">USD</option>
                          <option value="SYP">SYP</option>
                        </Select>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {editable && (
        <div>
          <button className="btn btn-primary" onClick={save}>
            {tr("حفظ الأسعار", "Save prices")}
          </button>
        </div>
      )}
    </div>
  );
}

function SubscriptionTab({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const { tr, pick, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const plans = useData<{ rows: Plan[] }>("/clients/plans");
  const [f, setF] = useState({ planId: "", startDate: today(), autoRenew: true });
  const [cancelling, setCancelling] = useState<Subscription | null>(null);
  const editable = can("clients", "edit");
  const active = d.subscriptions.find((s) => s.status === "active" && s.endDate >= today());
  const activePlans = (plans.data?.rows ?? []).filter((p) => p.active);
  const planId = f.planId || activePlans[0]?.id || "";
  const statusLabel = (s: Subscription["status"]) => ({ active: tr("فعّال", "Active"), ended: tr("منتهي", "Ended"), cancelled: tr("ملغى", "Cancelled") })[s];

  const start = async () => {
    try {
      await post(`/clients/${d.client.id}/subscribe`, { ...f, planId });
      toast(tr("بدأ الاشتراك وانحسب الرسم على حساب الزبون", "Subscription started; the fee was charged to the client's box"));
      onSaved();
    } catch (e) {
      toast(err(e), "error");
    }
  };

  return (
    <div className="grid gap-4">
      {active && d.client.subscription && (
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm text-muted">{tr("الاشتراك الحالي", "Current subscription")}</div>
              <div className="text-xl font-bold">{pick(active.plan)}</div>
              <div className="text-sm text-muted">
                <span className="num ltr">{active.startDate}</span> → <span className="num ltr">{active.endDate}</span> ·{" "}
                {active.autoRenew ? tr("يتجدد تلقائياً", "renews automatically") : tr("لا يتجدد", "does not renew")}
              </div>
              <div className="mt-2">
                {tr("القطع المشمولة الباقية:", "Included items left:")} <b className="num">{d.client.subscription.availableIncluded}</b> /{" "}
                <span className="num">{active.plan.includedItems}</span>
                {active.plan.discountPct > 0 && <span className="chip ms-2">{tr(`خصم ${active.plan.discountPct}%`, `${active.plan.discountPct}% off`)}</span>}
              </div>
            </div>
            {editable && (
              <button className="btn btn-danger" onClick={() => setCancelling(active)}>
                {tr("إلغاء الاشتراك", "Cancel subscription")}
              </button>
            )}
          </div>
        </div>
      )}
      {!active && editable && (
        <div className="card">
          <h3 className="mb-3 font-semibold">{tr("ابدأ اشتراك شهري", "Start a monthly subscription")}</h3>
          {activePlans.length === 0 ? (
            <p className="text-muted">{tr("ما في باقات اشتراك. أضفها من الإعدادات ← البيع.", "No plans yet. Add them in Settings → Sales rules.")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={tr("الباقة", "Plan")} htmlFor="sub-plan">
                <Select id="sub-plan" value={planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
                  {activePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {pick(p)} — {money(p.monthlyFee, p.currency)} · {tr(`${p.includedItems} قطعة`, `${p.includedItems} items`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("تاريخ البدء", "Start date")} htmlFor="sub-start">
                <TextInput id="sub-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
              </Field>
              <label className="mt-6 inline-flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} />
                {tr("تجديد تلقائي كل شهر", "Renew every month")}
              </label>
              <div className="sm:col-span-3">
                <button className="btn btn-primary" onClick={start} disabled={!planId}>
                  {tr("ابدأ الاشتراك", "Start subscription")}
                </button>
                <span className="ms-3 text-sm text-muted">{tr("رسم الشهر ينحسب على حساب الزبون.", "The monthly fee is charged to the client's box.")}</span>
              </div>
            </div>
          )}
        </div>
      )}
      <div>
        <h3 className="mb-2 font-semibold">{tr("السجل", "History")}</h3>
        {d.subscriptions.length === 0 ? (
          <Empty text={tr("ما في اشتراكات", "No subscriptions")} />
        ) : (
          <div className="card p-0">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {d.subscriptions.map((s) => (
                  <tr key={s.id}>
                    <td className="td font-semibold">{pick(s.plan)}</td>
                    <td className="td num ltr text-start">
                      {s.startDate} → {s.endDate}
                    </td>
                    <td className="td">
                      <span className="chip">{statusLabel(s.status)}</span>
                    </td>
                    <td className="td text-end num ltr">{money(s.plan.monthlyFee, s.plan.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {cancelling && (
        <Modal
          title={tr("إلغاء الاشتراك؟", "Cancel this subscription?")}
          onClose={() => setCancelling(null)}
          footer={
            <>
              <button className="btn" onClick={() => setCancelling(null)}>
                {tr("رجوع", "Back")}
              </button>
              <button
                className="btn btn-primary !border-bad !bg-bad !text-white"
                onClick={async () => {
                  try {
                    await post(`/clients/subscriptions/${cancelling.id}/cancel`);
                    setCancelling(null);
                    toast(tr("تم الإلغاء", "Cancelled"));
                    onSaved();
                  } catch (e) {
                    toast(err(e), "error");
                  }
                }}
              >
                {tr("إلغاء الاشتراك", "Cancel subscription")}
              </button>
            </>
          }
        >
          <p className="text-muted">
            {tr(
              "ما في إرجاع تلقائي لرسم هذا الشهر. إذا بدك ترجع مبلغ استخدم «تعديل الرصيد».",
              "This month's fee is not refunded automatically. Use “Adjust balance” to give money back.",
            )}
          </p>
        </Modal>
      )}
    </div>
  );
}

function RecurringDialog({ clientId, rec, catalog, onClose, onSaved }: { clientId: string; rec: Recurring | null; catalog: Catalog; onClose: () => void; onSaved: () => void }) {
  const { tr, pick, err } = useI18n();
  const toast = useToast();
  const products = catalog.products.filter((p) => p.active);
  const [days, setDays] = useState<number[]>(rec ? rec.days.split(",").map(Number) : [0, 1, 2, 3, 4]);
  const [lines, setLines] = useState<{ productId: string; qty: string; optionIds: string[] }[]>(
    rec ? rec.lines.map((l) => ({ ...l, qty: String(l.qty) })) : [{ productId: products[0]?.id ?? "", qty: "10", optionIds: [] }],
  );
  const [note, setNote] = useState(rec?.note ?? "");
  const [active, setActive] = useState(rec?.active ?? true);
  const valid = days.length > 0 && lines.length > 0 && lines.every((l) => l.productId && num(l.qty) >= 1);
  const save = async () => {
    const body = { days: [...days].sort(), lines: lines.map((l) => ({ productId: l.productId, qty: Math.round(num(l.qty)), optionIds: l.optionIds })), note, active };
    try {
      if (rec) await put(`/clients/recurring/${rec.id}`, body);
      else await post(`/clients/${clientId}/recurring`, body);
      toast(tr("تم الحفظ", "Saved"));
      onSaved();
    } catch (e) {
      toast(err(e), "error");
    }
  };
  return (
    <Modal
      wide
      title={rec ? tr("تعديل الطلب الثابت", "Edit standing order") : tr("طلب ثابت جديد", "New standing order")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!valid}>
            {tr("حفظ", "Save")}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <div>
          <div className="label">{tr("الأيام", "Days")}</div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((dName, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={days.includes(i)}
                className={`btn px-3 py-1.5 ${days.includes(i) ? "btn-primary" : ""}`}
                onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
              >
                {pick(dName)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label">{tr("الأصناف", "Items")}</div>
          <div className="grid gap-2">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Select
                  className="input flex-1"
                  value={l.productId}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, productId: e.target.value, optionIds: [] } : x)))}
                  aria-label={tr("المنتج", "Product")}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {pick(p)}
                    </option>
                  ))}
                </Select>
                <input
                  className="input w-24 num"
                  dir="ltr"
                  inputMode="numeric"
                  value={l.qty}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                  aria-label={tr("الكمية", "Quantity")}
                />
                <button
                  className="btn btn-ghost btn-danger px-2"
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  aria-label={tr("حذف", "Remove")}
                  disabled={lines.length === 1}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost mt-2 text-sm" onClick={() => setLines([...lines, { productId: products[0]?.id ?? "", qty: "1", optionIds: [] }])}>
            {tr("+ صنف", "+ Item")}
          </button>
        </div>
        <Field label={tr("ملاحظة", "Note")} htmlFor="rec-note">
          <TextInput id="rec-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-ink" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {tr("فعّال", "Active")}
        </label>
      </div>
    </Modal>
  );
}

function StandingOrders({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const { tr, pick, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const catalog = useData<Catalog>("/menu/catalog");
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const [deleting, setDeleting] = useState<Recurring | null>(null);
  const nameOf = useMemo(() => new Map((catalog.data?.products ?? []).map((p) => [p.id, p])), [catalog.data]);
  const editable = can("clients", "edit");
  if (!catalog.data) return <Spinner />;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          {tr(
            "طلبات تتكرر بنفس الأيام (مثلاً كل يوم ٢٠ ساندويش). بتطلع بقائمة التحضير وبتذكير «طلبات اليوم».",
            "Orders that repeat on the same days (e.g. 20 sandwiches every weekday). They feed the prep list and the “due today” reminder.",
          )}
        </p>
        {editable && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            {tr("+ طلب ثابت", "+ Standing order")}
          </button>
        )}
      </div>
      {d.recurring.length === 0 ? (
        <Empty text={tr("ما في طلبات ثابتة", "No standing orders")} />
      ) : (
        d.recurring.map((r) => (
          <div key={r.id} className={`card ${r.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-1">
                  {r.days
                    .split(",")
                    .map(Number)
                    .map((i) => (
                      <span key={i} className="chip">
                        {pick(DAYS[i] ?? DAYS[0]!)}
                      </span>
                    ))}
                  {!r.active && <span className="chip">{tr("متوقف", "paused")}</span>}
                </div>
                <ul className="mt-2 text-sm">
                  {r.lines.map((l, i) => (
                    <li key={i}>
                      <span className="num font-semibold">{l.qty}×</span> {nameOf.get(l.productId) ? pick(nameOf.get(l.productId)!) : "?"}
                    </li>
                  ))}
                </ul>
                {r.note && <p className="mt-1 text-sm text-muted">{r.note}</p>}
              </div>
              {editable && (
                <div className="flex gap-1">
                  <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(r)}>
                    {tr("تعديل", "Edit")}
                  </button>
                  <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setDeleting(r)}>
                    {tr("حذف", "Delete")}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))
      )}
      {editing && (
        <RecurringDialog
          clientId={d.client.id}
          rec={editing === "new" ? null : editing}
          catalog={catalog.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onSaved();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          text={tr("حذف هذا الطلب الثابت؟", "Delete this standing order?")}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await del(`/clients/recurring/${deleting.id}`);
              setDeleting(null);
              onSaved();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </div>
  );
}

type TabKey = "overview" | "moves" | "statement" | "returns" | "consignments" | "prices" | "subscription" | "standing";

export function ClientDetailPage() {
  const { id = "" } = useParams();
  const { tr, pick, fmtDate, err } = useI18n();
  const { can, simple } = useAuth();
  const toast = useToast();
  const { data, reload, error } = useData<Detail>(`/clients/${id}`);
  const [tab, setTab] = useState<TabKey>("overview");
  const [dialog, setDialog] = useState<"pay" | "edit" | "adjust" | "return" | "consign" | null>(null);
  const [settle, setSettle] = useState<Consignment | null>(null);
  const openSettle = async (cid: string) => {
    try {
      setSettle((await get<{ consignment: Consignment }>(`/consignments/${cid}`)).consignment);
    } catch (e) {
      toast(err(e), "error");
    }
  };

  if (error) return <p className="py-10 text-center text-muted">{tr("ما لقينا هذا الزبون.", "Client not found.")}</p>;
  if (!data) return <Spinner />;
  const c = data.client;
  const done = () => {
    setDialog(null);
    void reload();
  };
  const overLimit = c.creditLimitUsd > 0 && -c.balanceUsd > c.creditLimitUsd;
  const owes = c.balanceUsd < -0.009;
  const waText = owes
    ? tr(
        `مرحباً ${c.name}، رصيدكم المستحق لدى JJ's هو ${money(-c.balanceUsd)}${c.aging?.oldestUnpaidDate ? ` (أقدم فاتورة غير مدفوعة ${c.aging.oldestUnpaidDate})` : ""}. شكراً لكم.`,
        `Hello ${c.name}, your balance due to JJ's is ${money(-c.balanceUsd)}${c.aging?.oldestUnpaidDate ? ` (oldest unpaid invoice ${c.aging.oldestUnpaidDate})` : ""}. Thank you.`,
      )
    : tr(`مرحباً ${c.name}، شكراً لتعاملكم مع JJ's.`, `Hello ${c.name}, thank you for working with JJ's.`);
  const info = [
    data.area ? pick(data.area) : null,
    data.priceList ? `${tr("قائمة", "List")}: ${pick(data.priceList)}` : null,
    data.rep ? `${tr("المندوب", "Rep")}: ${data.rep.name}` : null,
    c.paymentTermsDays ? tr(`مدة السداد ${c.paymentTermsDays} يوم`, `${c.paymentTermsDays} days to pay`) : tr("الدفع فوراً", "Pays on the spot"),
  ].filter(Boolean);

  const tabs: { key: TabKey; label: string }[] = simple
    ? [{ key: "moves", label: tr("حركات الحساب", "Account moves") }]
    : [
        { key: "overview", label: tr("نظرة عامة", "Overview") },
        { key: "moves", label: tr("حركات الحساب", "Account moves") },
        { key: "statement", label: tr("كشف حساب", "Statement") },
        { key: "returns", label: tr("المرتجعات", "Returns") },
        ...(c.consignment || (data.consignments?.length ?? 0) > 0 ? [{ key: "consignments" as TabKey, label: tr("بالأمانة", "Consignment") }] : []),
        { key: "prices", label: tr("أسعار خاصة", "Special prices") },
        { key: "subscription", label: tr("الاشتراك", "Subscription") },
        { key: "standing", label: tr("طلبات ثابتة", "Standing orders") },
      ];
  const current = simple ? "moves" : tab;

  return (
    <>
      <Link to="/clients" className="mb-3 inline-block text-sm text-muted hover:text-ink">
        {tr("→ كل الزبائن", "← All clients")}
      </Link>
      <PageHeader
        title={c.name}
        subtitle={[c.contactPerson, c.address].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {can("clients", "create") && (
              <button className="btn btn-primary" onClick={() => setDialog("pay")}>
                {tr("سجّل دفعة", "Record payment")}
              </button>
            )}
            {can("orders", "create") && (
              <Link className="btn" to={`/orders/new?client=${c.id}`}>
                {tr("طلب جديد", "New order")}
              </Link>
            )}
            {can("orders", "create") && (
              <button className="btn" onClick={() => setDialog("return")}>
                {tr("مرتجع", "Return")}
              </button>
            )}
            {can("orders", "create") && c.consignment && (
              <button className="btn" onClick={() => setDialog("consign")}>
                {tr("بضاعة بالأمانة", "Consignment")}
              </button>
            )}
            {c.phone && (
              <a className="btn btn-ghost" href={waLink(c.phone, waText)} target="_blank" rel="noreferrer">
                {tr("واتساب", "WhatsApp")}
              </a>
            )}
            {!simple && can("clients", "edit") && (
              <>
                <button className="btn btn-ghost" onClick={() => setDialog("edit")}>
                  {tr("تعديل", "Edit")}
                </button>
                <button className="btn btn-ghost" onClick={() => setDialog("adjust")}>
                  {tr("تعديل الرصيد", "Adjust balance")}
                </button>
              </>
            )}
          </>
        }
      />
      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
        {c.phone && <span className="ltr">{c.phone}</span>}
        {info.map((x) => (
          <span key={x as string} className="chip">
            {x}
          </span>
        ))}
        {c.consignment && <span className="chip">{tr("بالأمانة", "Consignment")}</span>}
      </div>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="text-sm text-muted">{tr("الرصيد", "Balance")}</div>
          <BalanceText usd={c.balanceUsd} big />
          {c.aging && owes && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
              {c.aging.oldestUnpaidDate && (
                <span>
                  {tr(
                    `أقدم دين ${fmtDate(c.aging.oldestUnpaidDate)} (${c.aging.daysOutstanding} يوم)`,
                    `Oldest unpaid ${fmtDate(c.aging.oldestUnpaidDate)} (${c.aging.daysOutstanding} days)`,
                  )}
                </span>
              )}
              <LateBadge c={c} />
            </div>
          )}
        </div>
        {!simple && data.totals && (
          <div className="card">
            <div className="text-sm text-muted">{tr("الحساب من البداية", "Account so far")}</div>
            <div className="mt-1 grid gap-0.5 text-sm">
              <div className="flex justify-between gap-2">
                <span>{tr("المبيعات", "Sales")}</span>
                <span className="num ltr font-semibold">{money(data.totals.salesUsd)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>{tr("المقبوض", "Paid")}</span>
                <span className="num ltr font-semibold">{money(data.totals.paidUsd)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>{tr("المرتجعات", "Returns")}</span>
                <span className="num ltr font-semibold">{money(data.totals.returnsUsd)}</span>
              </div>
            </div>
          </div>
        )}
        <div className="card">
          <div className="text-sm text-muted">{tr("حد الدين", "Credit limit")}</div>
          <div className={`text-xl font-bold num ltr text-start ${overLimit ? "text-bad" : ""}`}>{c.creditLimitUsd > 0 ? money(c.creditLimitUsd) : tr("بلا حد", "No limit")}</div>
          {c.creditBlock && <div className="text-xs text-faint">{tr("يُمنع الدين فوق الحد", "Credit blocked above the limit")}</div>}
          {overLimit && <div className="text-xs text-bad">{tr("متجاوز الحد", "Over the limit")}</div>}
        </div>
        <div className="card">
          <div className="text-sm text-muted">{tr("مجاني متاح", "Free items available")}</div>
          <div className="text-xl font-bold num">{c.loyalty.available + (c.subscription?.availableIncluded ?? 0)}</div>
          <div className="text-xs text-faint">
            {tr("ولاء", "loyalty")} {c.loyalty.available} · {tr("اشتراك", "subscription")} {c.subscription?.availableIncluded ?? 0}
          </div>
        </div>
      </div>
      <Tabs tabs={tabs} value={current} onChange={setTab} />
      {current === "overview" && <Overview d={data} />}
      {current === "moves" && <MovesTable moves={data.moves} />}
      {current === "statement" && <Statement clientId={c.id} />}
      {current === "returns" && <ReturnsTable rows={data.returns ?? []} />}
      {current === "consignments" && <ConsignmentsTable rows={data.consignments ?? []} onSettle={can("orders", "create") ? (cid) => void openSettle(cid) : undefined} />}
      {current === "prices" && <SpecialPrices d={data} onSaved={() => void reload()} />}
      {current === "subscription" && <SubscriptionTab d={data} onSaved={() => void reload()} />}
      {current === "standing" && <StandingOrders d={data} onSaved={() => void reload()} />}

      {dialog === "pay" && <PaymentDialog client={c} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === "edit" && <ClientDialog client={c} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === "adjust" && <AdjustDialog clientId={c.id} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === "return" && <ReturnDialog clientId={c.id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "consign" && <ConsignmentDialog clientId={c.id} onClose={() => setDialog(null)} onDone={done} />}
      {settle && (
        <SettleDialog
          c={settle}
          onClose={() => setSettle(null)}
          onDone={() => {
            setSettle(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
