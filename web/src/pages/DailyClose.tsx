import { useState } from "react";
import { Link } from "react-router-dom";
import { Stat } from "../components/Tabs";
import { Empty, PageHeader, Spinner, TextInput } from "../components/ui";
import { post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { addDaysTo, money, num, qty, today, usd, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { openPrint } from "../lib/print";
import { useToast } from "../lib/toast";
import { useData } from "../lib/useData";
import type { PeriodReport } from "../lib/types";
import { Confirm } from "./orders/shared";
import { WithdrawDialog } from "./five/FiveAnswers";

interface DayTotals extends PeriodReport {
  cash?: { currency: Currency; expected: number; counted: number; difference: number };
}
interface DayRow {
  id: string;
  date: string;
  status: "open" | "closed";
  closedAt: string | null;
  expectedCashUsd: number | null;
  countedCashUsd: number | null;
  differenceUsd: number | null;
  reopenedAt: string | null;
  totals: DayTotals | null;
  closedByName?: string | null;
}
interface HighlightRow {
  orderId: string;
  number: number;
  clientId: string | null;
  clientName: string | null;
  assignedName: string | null;
  total: number;
  currency: Currency;
  remaining: number;
}
interface Highlights {
  previous: { date: string; salesUsd: number; orders: number; items: number };
  deliveries: { done: number; total: number };
  notDelivered: HighlightRow[];
  unpaid: HighlightRow[];
  unpaidCount: number;
  unpaidUsd: number;
  openReports: number;
  waitingRequests: number;
  rate: number | null;
}
interface DayView {
  highlights: Highlights;
  day: DayRow;
  report: PeriodReport;
  mainBox: { id: string; nameAr: string; nameEn: string; currency: Currency; expected: number | null };
  reps: { id: string; nameAr: string; nameEn: string; currency: Currency; balance: number }[];
  leftovers?: { batchId: string; batchCode: string; nameAr: string; nameEn: string; qty: number; expiresAt: string | null; expired: boolean }[];
  cashFlow?: { currency: Currency; opening: number; moves: { type: string; amount: number; n: number }[]; expected: number };
  repSettlement?: {
    employeeId: string;
    name: string;
    boxId: string | null;
    cash: number;
    currency: Currency;
    deliveries: number;
    items: number;
    returns: number;
    returnsUsd: number;
    expensesUsd: number;
    openConsignments: number;
  }[];
  production?: {
    productId: string | null;
    nameAr: string;
    nameEn: string;
    opening: number;
    made: number;
    fromFridge: number;
    madeFresh: number;
    consigned: number;
    returnedIn: number;
    wasted: number;
    counted: number;
    closing: number;
    soldTotal: number;
    consignSold: number;
  }[];
}

/** Box move types, the way the shop says them. */
export const MOVE_TYPE: Record<string, [string, string]> = {
  sale: ["مبيعات", "Sales"],
  client_payment: ["دفعات زبائن", "Client payments"],
  topup: ["شحن أرصدة", "Top-ups"],
  expense: ["مصاريف", "Expenses"],
  purchase: ["مدفوعات موردين", "Paid to suppliers"],
  transfer: ["تحويلات بين الصناديق", "Transfers between boxes"],
  handover: ["كاش من المندوب", "Cash from delivery"],
  count_adjust: ["فرق جرد سابق", "Earlier count difference"],
  deposit: ["نقد انضاف للصندوق", "Cash added to the box"],
  salary: ["رواتب", "Salaries"],
  advance: ["سلف", "Advances"],
  opening: ["رصيد افتتاحي", "Opening balance"],
  withdrawal: ["سحوبات شخصية", "Personal withdrawals"],
  refund: ["استرداد للزبائن", "Refunds to clients"],
};

/** Opening + money in − money out = what should be in the box (JJ's own way of counting). */
function BoxFlow({ f }: { f: NonNullable<DayView["cashFlow"]> }) {
  const { tr, lang } = useI18n();
  const m = (v: number) => money(v, f.currency, lang);
  return (
    <table className="mb-3 w-full max-w-lg text-sm">
      <tbody>
        <tr>
          <td className="py-1 text-muted">{tr("رصيد بداية اليوم", "Start of the day")}</td>
          <td className="py-1 text-end num ltr">{m(f.opening)}</td>
        </tr>
        {f.moves.map((x) => (
          <tr key={x.type}>
            <td className="py-1">
              {x.amount >= 0 ? "+ " : "− "}
              {tr(...(MOVE_TYPE[x.type] ?? [x.type, x.type]))} <span className="text-faint">({x.n})</span>
            </td>
            <td className={`py-1 text-end num ltr ${x.amount < 0 ? "text-muted" : ""}`}>{m(Math.abs(x.amount))}</td>
          </tr>
        ))}
        <tr className="border-t border-line font-bold">
          <td className="py-1.5">= {tr("المفروض يكون بالصندوق", "Should be in the box")}</td>
          <td className="py-1.5 text-end num ltr">{m(f.expected)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Made vs sold, straight from the stock moves. */
function MadeVsSold({ rows }: { rows: NonNullable<DayView["production"]> }) {
  const { tr, pick } = useI18n();
  if (!rows.length) return null;
  return (
    <div className="card overflow-x-auto">
      <h3 className="mb-2 font-semibold">{tr("المُنتَج مقابل المباع", "Made vs sold")}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">{tr("الصنف", "Product")}</th>
            <th className="th text-end">{tr("من أمس", "From yesterday")}</th>
            <th className="th text-end">{tr("انصنع", "Made")}</th>
            <th className="th text-end">{tr("انباع", "Sold")}</th>
            <th className="th text-end">{tr("بالأمانة", "Consigned")}</th>
            <th className="th text-end">{tr("رجع", "Returned")}</th>
            <th className="th text-end">{tr("تالف", "Wasted")}</th>
            <th className="th text-end">{tr("باقي", "Left")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.productId ?? i}>
              <td className="td font-semibold">{pick(r)}</td>
              <td className="td text-end num">{qty(r.opening)}</td>
              <td className="td text-end num">{qty(r.made)}</td>
              <td className="td text-end num">
                {qty(r.fromFridge)}
                {r.madeFresh > 0 && (
                  <span className="text-xs text-faint">
                    {" "}
                    (+{qty(r.madeFresh)} {tr("طازة", "fresh")})
                  </span>
                )}
              </td>
              <td className="td text-end num">{qty(r.consigned)}</td>
              <td className="td text-end num">{qty(r.returnedIn)}</td>
              <td className={`td text-end num ${r.wasted > 0 ? "text-bad" : ""}`}>{qty(r.wasted)}</td>
              <td className="td text-end num font-semibold">{qty(r.closing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.some((r) => Math.abs(r.counted) > 0.001) && (
        <p className="mt-2 text-xs text-muted">{tr("في فروقات جرد مسجّلة: شوف المستودع ← الحركات.", "Count differences were recorded: see Warehouse → Moves.")}</p>
      )}
    </div>
  );
}

/** "+12%" against the day before, when there is a day before to compare with. */
function Trend({ now, before }: { now: number; before: number }) {
  const { tr } = useI18n();
  if (!(before > 0)) return <span className="text-xs text-muted">{tr("ما في مبيعات مبارح", "No sales the day before")}</span>;
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return <span className="text-xs font-semibold text-muted">{tr("متل مبارح", "Same as the day before")}</span>;
  return (
    <span className={`text-xs font-bold ${change > 0 ? "text-good" : "text-bad"}`}>
      {change > 0 ? "▲" : "▼"} <span className="num ltr">{Math.abs(change)}%</span> {tr("عن مبارح", "vs the day before")}
    </span>
  );
}

function HeroNumber({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: "good" | "bad" | "warn" }) {
  const c = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "";
  return (
    <div className="min-w-0 rounded-xl bg-surface/70 p-3">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className={`num ltr truncate text-start text-2xl font-bold ${c}`}>{value}</div>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

/** The day at a glance: how it went, what sold best, and what still needs someone's attention. */
function DayStory({ r, h, date, closed, showCollected }: { r: PeriodReport; h: Highlights; date: string; closed: boolean; showCollected: boolean }) {
  const { tr, pick, lang, fmtDate } = useI18n();
  const top = [...r.byProduct].sort((a, b) => b.revenueUsd - a.revenueUsd).slice(0, 4);
  const maxRevenue = top[0]?.revenueUsd ?? 0;
  const deliveredShare = h.deliveries.total ? Math.round((h.deliveries.done / h.deliveries.total) * 100) : 0;
  const best = top[0];
  const headline = !r.orders
    ? tr("ما في طلبات بهاليوم لهلأ.", "No orders on this day yet.")
    : tr(`${r.orders} طلب و${qty(r.items)} قطعة بـ ${usd(r.salesUsd)}${best ? `، والأكتر مبيعاً ${pick(best)}` : ""}.`, `${r.orders} orders and ${qty(r.items)} items for ${usd(r.salesUsd)}${best ? `. Best seller: ${pick(best)}` : ""}.`);
  const attention = h.notDelivered.length + h.unpaidCount + h.openReports + h.waitingRequests;
  return (
    <section className="grid gap-3" aria-label={tr("ملخص اليوم", "Summary of the day")}>
      <div className="rounded-2xl bg-gradient-to-br from-brand/20 via-brand/10 to-brand/5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">{closed ? `🔒 ${tr("حكاية اليوم", "How the day went")}` : `✨ ${tr("كيف ماشي اليوم؟", "How is the day going?")}`}</h2>
          <span className="text-sm text-muted">{fmtDate(`${date}T12:00:00`)}</span>
          {h.rate ? (
            <span className="chip ms-auto">
              💱 <span className="num ltr">{h.rate.toLocaleString("en-US")}</span> {tr("ل.س للدولار", "SYP per $")}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[15px]">{headline}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <HeroNumber label={tr("المبيعات", "Sales")} value={usd(r.salesUsd)} sub={<Trend now={r.salesUsd} before={h.previous.salesUsd} />} />
          {showCollected ? (
            <HeroNumber label={tr("انقبض اليوم", "Collected today")} value={usd(r.collectedUsd ?? 0)} sub={<span className="text-xs text-muted">{h.rate ? money((r.collectedUsd ?? 0) * h.rate, "SYP", lang) : ""}</span>} tone="good" />
          ) : (
            <HeroNumber label={tr("القطع", "Items")} value={qty(r.items)} sub={<span className="text-xs text-muted">{tr(`${r.orders} طلب`, `${r.orders} orders`)}</span>} />
          )}
          <HeroNumber label={tr("ما اندفع لسا", "Not paid yet")} value={usd(h.unpaidUsd)} tone={h.unpaidCount ? "bad" : "good"} sub={<span className="text-xs text-muted">{h.unpaidCount ? tr(`${h.unpaidCount} طلب بالغيمة`, `${h.unpaidCount} orders in the cloud`) : tr("كلو مدفوع ✓", "All paid ✓")}</span>} />
          <HeroNumber label={r.netUsd !== undefined ? tr("الصافي", "Net") : tr("مصاريف وهدر", "Expenses & waste")} value={usd(r.netUsd ?? r.expensesUsd + r.wasteUsd)} tone={r.netUsd !== undefined ? (r.netUsd < 0 ? "bad" : "good") : undefined} sub={<span className="text-xs text-muted">{tr(`خصومات ${usd(r.discountUsd)}`, `Discounts ${usd(r.discountUsd)}`)}</span>} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 font-semibold">🏆 {tr("الأكتر مبيعاً", "Best sellers")}</h3>
          {top.length === 0 ? (
            <p className="text-sm text-muted">{tr("لسا ما انباع شي.", "Nothing sold yet.")}</p>
          ) : (
            <ul className="grid gap-2">
              {top.map((p) => (
                <li key={p.productId}>
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium">{pick(p)}</span>
                    <span className="num ltr shrink-0 text-muted">
                      ×{qty(p.qty)} · {usd(p.revenueUsd)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${maxRevenue > 0 ? Math.max(4, (p.revenueUsd / maxRevenue) * 100) : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-line pt-3">
            <div className="flex justify-between text-sm">
              <span className="font-semibold">🛵 {tr("التسليم", "Deliveries")}</span>
              <span className="num">
                {h.deliveries.done}/{h.deliveries.total}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-good transition-[width]" style={{ width: `${deliveredShare}%` }} />
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="mb-2 font-semibold">{attention ? `👀 ${tr("شغلات بدها انتباه", "Needs attention")}` : `🎉 ${tr("كلو تمام", "All good")}`}</h3>
          {attention === 0 ? (
            <p className="text-sm text-muted">{tr("كل شي تسلّم وكل شي مدفوع وما في بلاغات.", "Everything is delivered and paid, with no open reports.")}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {h.notDelivered.length > 0 && (
                <li>
                  <Link to="/deliveries" className="font-semibold text-warn hover:underline">
                    🛵 {tr(`${h.notDelivered.length} طلب لسا ما تسلّم`, `${h.notDelivered.length} orders not delivered yet`)}
                  </Link>
                  <div className="text-xs text-muted">{h.notDelivered.slice(0, 5).map((o) => `#${o.number} ${o.clientName ?? ""}`.trim()).join(" · ")}</div>
                </li>
              )}
              {h.unpaid.length > 0 && (
                <li>
                  <div className="font-semibold text-bad">💰 {tr("ما دفعوا", "Did not pay")}</div>
                  <ul className="mt-1 grid gap-1">
                    {h.unpaid.slice(0, 6).map((o) => (
                      <li key={o.orderId} className="flex justify-between gap-2">
                        {o.clientId ? (
                          <Link to={`/clients/${o.clientId}`} className="min-w-0 truncate hover:underline">
                            {o.clientName} <span className="num text-xs text-faint">#{o.number}</span>
                          </Link>
                        ) : (
                          <span className="min-w-0 truncate">#{o.number}</span>
                        )}
                        <span className="num ltr shrink-0 font-semibold">{money(o.remaining, o.currency, lang)}</span>
                      </li>
                    ))}
                  </ul>
                  {h.unpaidCount > 6 && <div className="mt-1 text-xs text-muted">{tr(`و${h.unpaidCount - 6} غيرهم`, `and ${h.unpaidCount - 6} more`)}</div>}
                </li>
              )}
              {h.openReports > 0 && (
                <li>
                  <Link to="/requests?tab=reports" className="font-semibold text-bad hover:underline">
                    ⚠️ {tr(`${h.openReports} بلاغ من الزبائن بدو رد`, `${h.openReports} client reports to answer`)}
                  </Link>
                </li>
              )}
              {h.waitingRequests > 0 && (
                <li>
                  <Link to="/requests" className="font-semibold text-warn hover:underline">
                    📱 {tr(`${h.waitingRequests} طلب من الزبائن بانتظار الرد`, `${h.waitingRequests} client requests waiting`)}
                  </Link>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** Where the close stands: each step lights up when it is done. */
function CloseSteps({ steps }: { steps: { label: string; done: boolean }[] }) {
  const { tr } = useI18n();
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div className="card" aria-label={tr("خطوات الإقفال", "Closing steps")}>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold">{tr("خطوات الإقفال", "Closing steps")}</span>
        <span className="num text-muted">
          {doneCount}/{steps.length}
        </span>
      </div>
      <ol className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <li key={i} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${s.done ? "bg-good/15 text-good" : "bg-sunken text-muted"}`}>
            <span className="num" aria-hidden>
              {s.done ? "✓" : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The numbers of one day (used after closing and for past days). */
function DaySummary({ r, cash }: { r: PeriodReport; cash?: DayTotals["cash"] | null }) {
  const { tr, pick, lang } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("المبيعات", "Sales")} value={usd(r.salesUsd)} />
        <Stat
          label={tr("الطلبات", "Orders")}
          value={String(r.orders)}
          sub={`${qty(r.items)} ${tr("قطعة", "items")}${r.freeItems ? ` · ${r.freeItems} ${tr("مجاني", "free")}` : ""}`}
        />
        <Stat label={tr("الخصومات", "Discounts")} value={usd(r.discountUsd)} />
        {cash ? (
          <Stat
            label={tr("فرق الصندوق", "Cash difference")}
            value={money(cash.difference, cash.currency, lang)}
            tone={Math.abs(cash.difference) < 0.005 ? "good" : cash.difference < 0 ? "bad" : "warn"}
            sub={`${tr("متوقع", "expected")} ${money(cash.expected, cash.currency, lang)} · ${tr("معدود", "counted")} ${money(cash.counted, cash.currency, lang)}`}
          />
        ) : (
          <Stat label={tr("مصاريف وهدر", "Expenses & waste")} value={usd(r.expensesUsd + r.wasteUsd)} />
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 font-semibold">{tr("المقبوض حسب طريقة الدفع", "Received, by payment method")}</h3>
          {r.byMethod.length === 0 ? (
            <Empty text={tr("لا شيء", "Nothing")} />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {r.byMethod.map((m, i) => (
                  <tr key={m.methodId ?? i}>
                    <td className="td">{m.nameAr ? pick({ nameAr: m.nameAr, nameEn: m.nameEn ?? m.nameAr }) : tr("مجاني", "Free")}</td>
                    <td className="td num text-end">{m.n}</td>
                    <td className="td text-end">
                      <span className="num ltr">{usd(m.usd)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3 className="mb-2 font-semibold">{tr("حسب المنتج", "By product")}</h3>
          {r.byProduct.length === 0 ? (
            <Empty text={tr("لا شيء", "Nothing")} />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {r.byProduct.map((p) => (
                  <tr key={p.productId}>
                    <td className="td">{pick(p)}</td>
                    <td className="td num text-end">×{qty(p.qty)}</td>
                    <td className="td text-end">
                      <span className="num ltr">{usd(p.revenueUsd)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {(r.waste.length > 0 || r.expenses.length > 0) && (
          <div className="card md:col-span-2">
            <h3 className="mb-2 font-semibold">{tr("مصاريف وهدر", "Expenses & waste")}</h3>
            <table className="w-full text-sm">
              <tbody>
                {r.expenses.map((e, i) => (
                  <tr key={`e${i}`}>
                    <td className="td">{e.nameAr ? pick({ nameAr: e.nameAr, nameEn: e.nameEn ?? e.nameAr }) : tr("مصروف", "Expense")}</td>
                    <td className="td text-end">
                      <span className="num ltr">{usd(e.usd)}</span>
                    </td>
                  </tr>
                ))}
                {r.waste.map((w) => (
                  <tr key={`w${w.itemId}`}>
                    <td className="td">
                      {tr("هدر", "Waste")}: {pick(w)} <span className="num text-muted">×{qty(w.qty)}</span>
                    </td>
                    <td className="td text-end">
                      <span className="num ltr">{usd(w.usd)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function DailyClosePage() {
  const { tr, pick, lang, err, fmtDate } = useI18n();
  const { can, simple } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(today());
  const view = useData<DayView>(`/days/${date}`);
  const history = useData<{ rows: DayRow[] }>(!simple ? "/days" : null);
  const [counted, setCounted] = useState("");
  const [confirm, setConfirm] = useState<"close" | "reopen" | null>(null);
  const [withdraw, setWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      await view.reload();
      void history.reload();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const [taken, setTaken] = useState<Record<string, boolean>>({});
  const [trash, setTrash] = useState<Record<string, boolean>>({});
  const d = view.data;
  const box = d?.mainBox;
  const isToday = date === today();
  // delivery cash still out: from the per-person settlement, or straight from the rep boxes
  const repCash = (
    d?.repSettlement?.length
      ? d.repSettlement
          .filter((r) => r.boxId && r.cash > 0.009)
          .map((r) => ({ boxId: r.boxId!, name: r.name, cash: r.cash, currency: r.currency, sub: tr(`${r.deliveries} توصيلة · ${r.items} قطعة`, `${r.deliveries} deliveries · ${r.items} pcs`) }))
      : (d?.reps ?? []).filter((r) => r.balance > 0.009).map((r) => ({ boxId: r.id, name: pick(r), cash: r.balance, currency: r.currency, sub: "" }))
  );
  const handover = isToday ? repCash.filter((r) => taken[r.boxId] ?? true) : [];
  const handedTotal = handover.filter((r) => r.currency === box?.currency).reduce((t, r) => t + r.cash, 0);
  // the server leaves the expected amount out for whoever counts blind; it shows once the day is closed
  const blind = box?.expected === null;
  const expected = box?.expected != null ? Math.round((box.expected + handedTotal) * 100) / 100 : 0;
  const leftovers = d?.leftovers ?? [];
  const wasteIds = isToday ? leftovers.filter((b) => trash[b.batchId] ?? b.expired).map((b) => b.batchId) : [];
  const c = num(counted);
  const diff = box && !blind && !Number.isNaN(c) ? Math.round((c - expected) * 100) / 100 : null;
  const big = simple;

  return (
    <div>
      <PageHeader
        title={tr("إقفال اليوم", "Close the day")}
        subtitle={tr("علّم كاش المندوبين، عدّ الصندوق، قرر شو بيضل بالبرّاد — وكبسة وحدة بتقفل كل شي.", "Tick the delivery cash, count the box, decide what stays in the fridge — one button does it all.")}
        actions={
          <div className="flex items-center gap-2">
            {can("daily_close", "edit") && isToday && (
              <button className="btn" onClick={() => setWithdraw(true)}>
                {tr("سحب شخصي", "Personal withdrawal")}
              </button>
            )}
            <button className="btn btn-ghost px-2" onClick={() => setDate(addDaysTo(date, -1))} aria-label={tr("اليوم السابق", "Previous day")}>
              {lang === "ar" ? "→" : "←"}
            </button>
            <TextInput type="date" className="w-auto" value={date} max={today()} onChange={(e) => e.target.value && (setDate(e.target.value), setCounted(""))} />
            <button className="btn btn-ghost px-2" disabled={isToday} onClick={() => setDate(addDaysTo(date, 1))} aria-label={tr("اليوم التالي", "Next day")}>
              {lang === "ar" ? "←" : "→"}
            </button>
          </div>
        }
      />

      {view.error ? (
        <p className="text-bad">{err(view.error)}</p>
      ) : !d || !box ? (
        <Spinner />
      ) : d.day.status === "closed" ? (
        <div className="grid gap-4">
          <div className="card flex flex-wrap items-center gap-3">
            <span className="chip">{tr("مقفل", "Closed")}</span>
            <span className="text-sm text-muted">
              {d.day.closedAt && fmtDate(d.day.closedAt, true)}
              {d.day.closedByName && ` · ${d.day.closedByName}`}
            </span>
            <div className="ms-auto flex gap-2">
              <button className="btn" onClick={() => openPrint(`/print/report?from=${date}&to=${date}`)}>
                {tr("طباعة تقرير اليوم", "Print day report")}
              </button>
              {can("daily_close", "edit") && (
                <button className="btn" disabled={busy} onClick={() => setConfirm("reopen")}>
                  {tr("إعادة فتح اليوم", "Reopen day")}
                </button>
              )}
            </div>
          </div>
          <DayStory r={d.day.totals ?? d.report} h={d.highlights} date={date} closed showCollected />
          <DaySummary r={d.day.totals ?? d.report} cash={d.day.totals?.cash} />
          {d.production && <MadeVsSold rows={d.production} />}
        </div>
      ) : (
        <div className="grid gap-4">
          <DayStory r={d.report} h={d.highlights} date={date} closed={false} showCollected={!blind} />
          <CloseSteps
            steps={[
              { label: tr("كاش المندوبين", "Delivery cash"), done: repCash.length === 0 || repCash.every((r) => taken[r.boxId] ?? true) },
              { label: tr("عدّ الصندوق", "Count the box"), done: counted !== "" && !Number.isNaN(c) },
              ...(isToday && leftovers.length > 0 ? [{ label: tr("البرّاد", "The fridge"), done: Object.keys(trash).length > 0 || leftovers.every((b) => b.expired) }] : []),
              { label: tr("اقفل اليوم", "Lock the day"), done: false },
            ]}
          />
          {/* part 1: delivery cash — ticked, received with the close */}
          <section className="card">
            <h2 className={`mb-2 font-bold ${big ? "text-xl" : "text-lg"}`}>1 · {tr("كاش المندوبين", "Delivery cash")}</h2>
            {repCash.length === 0 ? (
              <p className="text-muted">{tr("ما في نقد عند موظفي التوصيل. ✓", "No delivery person is holding cash. ✓")}</p>
            ) : (
              <div className="grid gap-2">
                {repCash.map((r) => {
                  const on = taken[r.boxId] ?? true;
                  return (
                    <label key={r.boxId} className={`flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border-2 p-3 transition-colors ${on ? "border-good bg-good/5" : "border-line"}`}>
                      <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--good))]" checked={on} disabled={!isToday} onChange={(e) => setTaken({ ...taken, [r.boxId]: e.target.checked })} />
                      <div className="min-w-0">
                        <div className="font-semibold">{r.name}</div>
                        {r.sub && <div className="text-sm text-muted">{r.sub}</div>}
                      </div>
                      <span className="ms-auto num ltr text-lg font-bold">{money(r.cash, r.currency, lang)}</span>
                      <span className={`text-sm font-semibold ${on ? "text-good" : "text-faint"}`}>{on ? tr("استلمتها ✓", "Received ✓") : tr("لسا", "Not yet")}</span>
                    </label>
                  );
                })}
                <p className="text-xs text-muted">{tr("المصاري المعلّمة بتدخل الصندوق الرئيسي لما تقفل اليوم.", "Ticked cash goes into the main box when you close the day.")}</p>
              </div>
            )}
          </section>

          {/* part 2: count */}
          <section className="card">
            <h2 className={`mb-1 font-bold ${big ? "text-xl" : "text-lg"}`}>2 · {tr("عدّ الصندوق", "Count the cash box")}</h2>
            <p className="mb-3 text-sm text-muted">
              {pick(box)} — {tr("عدّ كل النقد الموجود واكتب المجموع.", "Count all the cash in it and type the total.")}
            </p>
            {d.cashFlow && !simple && <BoxFlow f={d.cashFlow} />}
            <div className={`grid items-end gap-4 ${blind ? "" : "sm:grid-cols-3"}`}>
              <div>
                <span className="label">{tr("المعدود", "Counted")}</span>
                <div className="flex gap-2">
                  <input
                    className={`input num ltr ${big ? "py-4 text-3xl" : "text-xl"}`}
                    inputMode="decimal"
                    dir="ltr"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    placeholder="0"
                    aria-label={tr("المعدود", "Counted")}
                  />
                  {!blind && (
                    <button type="button" className="btn shrink-0 text-good" onClick={() => setCounted(String(expected))} title={tr("عبّي المعدود بنفس المبلغ المتوقع", "Fill in the expected amount as counted")}>
                      {tr("نفس المتوقع", "Same as expected")}
                    </button>
                  )}
                </div>
                {blind && <p className="mt-2 text-sm text-muted">{tr("المبلغ المتوقع والفرق بيبينو بعد ما تقفل اليوم.", "The expected amount and the difference show after you close the day.")}</p>}
              </div>
              {!blind && (
                <>
                  <div>
                    <div className="text-sm text-muted">{tr("المتوقع بالنظام", "Expected by the system")}</div>
                    <div className="num ltr text-2xl font-bold text-start">{money(expected, box.currency, lang)}</div>
                    {handedTotal > 0 && <div className="text-xs text-muted">{tr(`مع ${money(handedTotal, box.currency, lang)} من المندوبين`, `incl. ${money(handedTotal, box.currency, lang)} from delivery`)}</div>}
                  </div>
                  <div>
                    <div className="text-sm text-muted">{tr("الفرق", "Difference")}</div>
                    <div
                      className={`num ltr text-2xl font-bold text-start ${diff === null ? "text-faint" : Math.abs(diff) < 0.005 ? "text-good" : diff < 0 ? "text-bad" : "text-warn"}`}
                    >
                      {diff === null ? "—" : `${diff > 0 ? "+" : ""}${money(diff, box.currency, lang)}`}
                    </div>
                    {diff !== null && Math.abs(diff) >= 0.005 && <div className="text-xs text-muted">{diff < 0 ? tr("ناقص من الصندوق", "Short") : tr("زيادة بالصندوق", "Over")}</div>}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* part 3: what is left in the fridge */}
          {isToday && leftovers.length > 0 && (
            <section className="card">
              <h2 className={`mb-1 font-bold ${big ? "text-xl" : "text-lg"}`}>3 · {tr("شو ضل بالبرّاد؟", "What's left in the fridge?")}</h2>
              <p className="mb-3 text-sm text-muted">{tr("المنتهي معلّم للزبالة لحالو. غيّر اللي بدك.", "Expired ones are already marked for the trash. Change any you like.")}</p>
              <div className="grid gap-2">
                {leftovers.map((b) => {
                  const toTrash = trash[b.batchId] ?? b.expired;
                  return (
                    <div key={b.batchId} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-semibold">
                          {pick(b)} · <span className="num">{qty(b.qty)}</span>
                        </div>
                        <div className="text-xs text-muted">
                          <span className="ltr">{b.batchCode}</span>
                          {b.expiresAt && ` · ${tr("بتخلص", "expires")} ${fmtDate(b.expiresAt, true)}`}
                          {b.expired && <span className="ms-1 font-semibold text-bad">{tr("منتهي", "expired")}</span>}
                        </div>
                      </div>
                      <div className="ms-auto inline-flex rounded-lg bg-sunken p-0.5" role="radiogroup" aria-label={pick(b)}>
                        <button type="button" role="radio" aria-checked={!toTrash} onClick={() => setTrash({ ...trash, [b.batchId]: false })} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${!toTrash ? "bg-surface text-good shadow-sm" : "text-muted"}`}>
                          🧊 {tr("لبكرا", "Keep")}
                        </button>
                        <button type="button" role="radio" aria-checked={toTrash} onClick={() => setTrash({ ...trash, [b.batchId]: true })} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${toTrash ? "bg-surface text-bad shadow-sm" : "text-muted"}`}>
                          🗑️ {tr("للزبالة", "Trash")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {d.production && d.production.length > 0 && !simple && <MadeVsSold rows={d.production} />}

          {/* last: one button does it all */}
          <section className="card border-ink/30">
            <h2 className={`mb-2 font-bold ${big ? "text-xl" : "text-lg"}`}>{tr("اقفل اليوم", "Lock the day")}</h2>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={tr("الطلبات", "Orders")} value={String(d.report.orders)} />
              <Stat label={tr("القطع", "Items")} value={qty(d.report.items)} />
              <Stat label={tr("المبيعات", "Sales")} value={usd(d.report.salesUsd)} />
              <Stat label={tr("الخصومات", "Discounts")} value={usd(d.report.discountUsd)} />
            </div>
            <ul className="mb-3 grid gap-1 text-sm">
              <li className={handover.length ? "text-good" : "text-muted"}>{handover.length ? `✓ ${tr(`استلام كاش من ${handover.length} مندوب`, `Receive cash from ${handover.length} delivery person(s)`)}` : `· ${tr("ما في كاش مندوبين", "No delivery cash")}`}</li>
              <li className={counted !== "" && !Number.isNaN(c) ? "text-good" : "text-warn"}>{counted !== "" && !Number.isNaN(c) ? `✓ ${tr("الصندوق معدود", "Cash counted")}` : `• ${tr("لسا ما عدّيت الصندوق", "Cash not counted yet")}`}</li>
              {wasteIds.length > 0 && <li className="text-bad">🗑️ {tr(`${wasteIds.length} دفعة للزبالة`, `${wasteIds.length} batch(es) to the trash`)}</li>}
            </ul>
            <p className="mb-3 text-xs text-muted">
              {tr(
                "بعد الإقفال ما بينفع تسجيل طلبات أو حركات لهذا اليوم إلا إذا فتحه المدير.",
                "After closing, no orders or moves can be added for this day unless the admin reopens it.",
              )}
            </p>
            {can("daily_close", "create") ? (
              <button
                className={`btn btn-primary w-full ${big ? "min-h-[64px] text-xl" : "py-3 text-lg"}`}
                disabled={busy || counted === "" || Number.isNaN(c) || c < 0}
                onClick={() => setConfirm("close")}
              >
                🔒 {tr("اقفل اليوم", "Close the day")}
              </button>
            ) : (
              <p className="text-muted">{tr("دورك لا يسمح بإقفال اليوم.", "Your role cannot close the day.")}</p>
            )}
          </section>
        </div>
      )}

      {!simple && history.data && history.data.rows.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 font-semibold">{tr("الأيام السابقة", "Past days")}</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">{tr("اليوم", "Day")}</th>
                  <th className="th">{tr("الحالة", "Status")}</th>
                  <th className="th text-end">{tr("المبيعات", "Sales")}</th>
                  <th className="th text-end">{tr("الطلبات", "Orders")}</th>
                  <th className="th text-end">{tr("فرق الصندوق", "Cash difference")}</th>
                </tr>
              </thead>
              <tbody>
                {history.data.rows.map((h) => (
                  <tr key={h.id} className="cursor-pointer hover:bg-sunken" onClick={() => setDate(h.date)}>
                    <td className="td num">{fmtDate(`${h.date}T12:00:00`)}</td>
                    <td className="td">{h.status === "closed" ? tr("مقفل", "Closed") : <span className="text-warn">{tr("مفتوح", "Open")}</span>}</td>
                    <td className="td text-end">
                      <span className="num ltr">{h.totals ? usd(h.totals.salesUsd) : "—"}</span>
                    </td>
                    <td className="td num text-end">{h.totals?.orders ?? "—"}</td>
                    <td className="td text-end">
                      {h.totals?.cash ? (
                        <span className={`num ltr ${Math.abs(h.totals.cash.difference) < 0.005 ? "" : h.totals.cash.difference < 0 ? "text-bad" : "text-warn"}`}>
                          {money(h.totals.cash.difference, h.totals.cash.currency, lang)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {confirm === "close" && box && (
        <Confirm
          title={tr(`إقفال يوم ${date}؟`, `Close ${date}?`)}
          body={
            <p className="text-muted">
              {tr("المعدود", "Counted")}: <span className="num ltr font-semibold text-ink">{money(c, box.currency, lang)}</span>
              {diff !== null && Math.abs(diff) >= 0.005 && (
                <>
                  {" "}
                  · {tr("الفرق", "difference")} <span className={`num ltr font-semibold ${diff < 0 ? "text-bad" : "text-warn"}`}>{money(diff, box.currency, lang)}</span>
                </>
              )}
            </p>
          }
          yes={tr("نعم، اقفل اليوم", "Yes, close it")}
          no={tr("رجوع", "Back")}
          onClose={() => setConfirm(null)}
          onYes={() => {
            setConfirm(null);
            void run(
              () => post(`/days/${date}/close`, { counted: c, handoverBoxIds: handover.map((r) => r.boxId), wasteBatchIds: wasteIds }),
              tr("تم إقفال اليوم", "Day closed"),
            ).then(() => (setCounted(""), setTaken({}), setTrash({})));
          }}
        />
      )}
      {withdraw && <WithdrawDialog onClose={() => setWithdraw(false)} onDone={() => (setWithdraw(false), void view.reload())} />}
      {confirm === "reopen" && (
        <Confirm
          title={tr(`إعادة فتح يوم ${date}؟`, `Reopen ${date}?`)}
          body={<p className="text-muted">{tr("بعد الفتح يمكن التعديل، ثم يجب إقفاله من جديد.", "It can be changed again, then it must be closed again.")}</p>}
          yes={tr("أعد الفتح", "Reopen")}
          no={tr("رجوع", "Back")}
          onClose={() => setConfirm(null)}
          onYes={() => {
            setConfirm(null);
            void run(() => post(`/days/${date}/reopen`), tr("تمت إعادة فتح اليوم", "Day reopened"));
          }}
        />
      )}
    </div>
  );
}
