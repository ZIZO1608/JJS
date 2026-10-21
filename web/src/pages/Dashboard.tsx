import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Stat } from "../components/Tabs";
import { Empty, PageHeader, Spinner } from "../components/ui";
import { useAuth } from "../lib/auth";
import { money, pct, qty, usd, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useData } from "../lib/useData";
import type { PeriodReport } from "../lib/types";
import { payStatusLabel, timeOf, type OrderRow } from "./orders/shared";

interface AlertBatch {
  id: string;
  batchCode: string;
  nameAr: string;
  nameEn: string;
  unitCode: string;
  qtyLeft: number;
  expiresAt: string | null;
}
interface Dashboard {
  date: string;
  today: PeriodReport;
  week: { date: string; salesUsd: number; orders: number }[];
  recent: (OrderRow & { createdAt?: string })[];
  alerts: {
    expired: AlertBatch[];
    expiresToday: AlertBatch[];
    lowStock: { id: string; nameAr: string; nameEn: string; unitCode: string; qty: number; minLevel: number }[];
    nearCreditLimit: { id: string; name: string; balanceUsd: number; limitUsd: number }[];
    repCash: { id: string; nameAr: string; nameEn: string; currency: Currency; balance: number }[];
    overdueClients?: { id: string; name: string; balanceUsd: number; overdueDays: number }[];
    dueExpenses?: { id: string; date: string; amount: number; currency: Currency; note: string }[];
    suppliersOverdueUsd?: number;
  };
  stockValueUsd?: number;
  boxes: { id: string; nameAr: string; nameEn: string; kind: string; currency: Currency; balance: number; todayIn: number }[];
  unpaid: { id: string; name: string; balanceUsd: number; creditLimitUsd: number }[];
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card min-w-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DashboardPage({ embedded }: { embedded?: boolean } = {}) {
  const { tr, pick, lang, fmtDate, err } = useI18n();
  const { can } = useAuth();
  const { data, error } = useData<Dashboard>("/reports/dashboard");

  if (error) return <p className="text-bad">{err(error)}</p>;
  if (!data) return <Spinner />;
  const t = data.today;
  const maxWeek = Math.max(1, ...data.week.map((d) => d.salesUsd));
  const a = data.alerts;
  const overdue = a.overdueClients ?? [];
  const dueExp = a.dueExpenses ?? [];
  const supOverdue = a.suppliersOverdueUsd ?? 0;
  const alertCount =
    a.expired.length + a.expiresToday.length + a.lowStock.length + a.nearCreditLimit.length + a.repCash.length + overdue.length + dueExp.length + (supOverdue > 0.009 ? 1 : 0);
  const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang === "ar" ? "ar-SY-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric" });

  return (
    <div>
      {!embedded && <PageHeader title={tr("لوحة اليوم", "Dashboard")} subtitle={fmtDate(`${data.date}T12:00:00`)} />}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label={tr("مبيعات اليوم", "Sales today")} value={usd(t.salesUsd)} sub={t.discountUsd > 0 ? `${tr("خصومات", "Discounts")} ${usd(t.discountUsd)}` : undefined} />
        <Stat label={tr("طلبات", "Orders")} value={String(t.orders)} sub={`${qty(t.items)} ${tr("قطعة", "items")}`} />
        {t.grossProfitUsd !== undefined && <Stat label={tr("الربح الإجمالي", "Gross profit")} value={usd(t.grossProfitUsd)} sub={`${tr("هامش", "Margin")} ${pct(t.marginPct)}`} />}
        <Stat label={tr("مصاريف وهدر", "Expenses & waste")} value={usd(t.expensesUsd + t.wasteUsd)} />
        {t.grossProfitUsd !== undefined && (
          <Stat
            label={tr("الربح بعد المصاريف", "Profit after expenses")}
            value={usd(t.grossProfitUsd - t.expensesUsd - t.wasteUsd)}
            tone={t.grossProfitUsd - t.expensesUsd - t.wasteUsd < 0 ? "bad" : undefined}
            sub={tr("الرواتب والاستهلاك بالتقارير الشهرية", "Salaries & depreciation: see monthly reports")}
          />
        )}
        {data.stockValueUsd !== undefined && can("costing", "see_cost") && (
          <Stat label={tr("قيمة المخزون", "Stock value")} value={usd(data.stockValueUsd)} sub={tr("بمتوسط التكلفة", "At average cost")} />
        )}
      </div>

      {alertCount > 0 && (
        <section className="card mb-4 border-warn/60">
          <h2 className="mb-2 font-semibold">{tr("تنبيهات", "Needs attention")}</h2>
          <ul className="grid gap-1.5 text-sm">
            {a.expired.length > 0 && (
              <li>
                <Link to="/warehouse/fridge" className="text-bad hover:underline">
                  {tr("منتهي الصلاحية", "Expired")}: {a.expired.map((b) => `${pick(b)} (${b.batchCode})`).join("، ")}
                </Link>
              </li>
            )}
            {a.expiresToday.length > 0 && (
              <li>
                <Link to="/warehouse/fridge" className="text-warn hover:underline">
                  {tr("ينتهي اليوم", "Expires today")}: {a.expiresToday.map((b) => `${pick(b)} (${b.batchCode})`).join("، ")}
                </Link>
              </li>
            )}
            {a.lowStock.length > 0 && (
              <li>
                <Link to="/warehouse/items" className="text-warn hover:underline">
                  {tr("مخزون قليل", "Low stock")}: {a.lowStock.map((i) => `${pick(i)} ${qty(i.qty)}/${qty(i.minLevel)} ${i.unitCode}`).join("، ")}
                </Link>
              </li>
            )}
            {a.nearCreditLimit.map((c) => (
              <li key={c.id}>
                <Link to={`/clients/${c.id}`} className="text-warn hover:underline">
                  {tr("قريب من حد الدين", "Near credit limit")}: {c.name} — <span className="num ltr">{usd(-c.balanceUsd)}</span> /{" "}
                  <span className="num ltr">{usd(c.limitUsd)}</span>
                </Link>
              </li>
            ))}
            {overdue.slice(0, 6).map((c) => (
              <li key={`o${c.id}`}>
                <Link to={`/clients/${c.id}`} className="text-bad hover:underline">
                  {tr("متأخر بالدفع", "Late paying")}: {c.name} — {tr(`${c.overdueDays} يوم`, `${c.overdueDays} days`)} · <span className="num ltr">{usd(-c.balanceUsd)}</span>
                </Link>
              </li>
            ))}
            {overdue.length > 6 && <li className="text-muted">+{overdue.length - 6}</li>}
            {dueExp.length > 0 && (
              <li>
                <Link to="/expenses" className="text-warn hover:underline">
                  {tr("مصاريف مستحقة لازم تندفع", "Expenses due to pay")}: {dueExp.length} · {dueExp.map((e) => money(e.amount, e.currency, lang)).join("، ")}
                </Link>
              </li>
            )}
            {supOverdue > 0.009 && (
              <li>
                <Link to="/purchasing" className="text-warn hover:underline">
                  {tr("فواتير موردين فات موعدها", "Supplier invoices past due")}: <span className="num ltr">{usd(supOverdue)}</span>
                </Link>
              </li>
            )}
            {a.repCash.map((b) => (
              <li key={b.id}>
                <Link to="/close" className="text-warn hover:underline">
                  {tr("نقد لم يُسلَّم بعد", "Cash not handed over yet")}: {pick(b)} — <span className="num ltr">{money(b.balance, b.currency, lang)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title={tr("آخر 7 أيام", "Last 7 days")}
          action={
            can("reports", "view") ? (
              <Link to="/reports" className="text-sm text-muted hover:text-ink">
                {tr("التقارير", "Reports")}
              </Link>
            ) : undefined
          }
        >
          <div className="grid gap-1.5">
            {data.week.map((d) => (
              <div key={d.date} className="grid grid-cols-[5.5rem_1fr_5.5rem] items-center gap-2 text-sm">
                <span className="text-muted">{dayName(d.date)}</span>
                <div className="h-5 rounded bg-sunken">
                  <div className="h-5 rounded bg-ink/80" style={{ width: `${Math.max(d.salesUsd > 0 ? 2 : 0, (d.salesUsd / maxWeek) * 100)}%` }} />
                </div>
                <span className="num ltr text-end">{usd(d.salesUsd)}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title={tr("الصناديق", "Cash boxes")}>
          <table className="w-full text-sm">
            <tbody>
              {data.boxes.map((b) => (
                <tr key={b.id}>
                  <td className="td">{pick(b)}</td>
                  <td className="td text-end text-faint">
                    {b.todayIn !== 0 && (
                      <span className="num ltr">
                        {tr("اليوم", "today")} {b.todayIn > 0 ? "+" : ""}
                        {money(b.todayIn, b.currency, lang)}
                      </span>
                    )}
                  </td>
                  <td className="td text-end font-semibold">
                    <span className={`num ltr ${b.balance < 0 ? "text-bad" : ""}`}>{money(b.balance, b.currency, lang)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section
          title={tr("آخر الطلبات", "Recent orders")}
          action={
            <Link to="/orders" className="text-sm text-muted hover:text-ink">
              {tr("كل الطلبات", "All orders")}
            </Link>
          }
        >
          {data.recent.length === 0 ? (
            <Empty text={tr("لا يوجد طلبات اليوم", "No orders today")} />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {data.recent.slice(0, 8).map((o) => (
                  <tr key={o.id} className={o.status === "cancelled" ? "text-faint line-through" : ""}>
                    <td className="td num">#{o.number}</td>
                    <td className="td">
                      {o.clientName ?? tr("زبون عابر", "Walk-in")}
                      <span className="ms-2 text-xs text-faint">{timeOf(o.createdAt, lang)}</span>
                    </td>
                    <td className="td text-xs text-muted">{payStatusLabel(o.paymentStatus, tr)}</td>
                    <td className="td text-end">
                      <span className="num ltr">{money(o.total, o.currency, lang)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title={tr("زبائن عليهم دين", "Clients who owe")}>
          {data.unpaid.length === 0 ? (
            <Empty text={tr("لا أحد", "Nobody")} />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {data.unpaid.slice(0, 8).map((c) => (
                  <tr key={c.id}>
                    <td className="td">
                      <Link to={`/clients/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="td text-end">
                      <span className="num ltr text-bad">{usd(-c.balanceUsd)}</span>
                      {c.creditLimitUsd > 0 && (
                        <span className="ms-1 text-xs text-faint">
                          / <span className="num ltr">{usd(c.creditLimitUsd)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {t.byProduct.length > 0 && (
          <Section title={tr("الأكثر مبيعاً اليوم", "Best sellers today")}>
            <table className="w-full text-sm">
              <tbody>
                {t.byProduct.slice(0, 6).map((p) => (
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
          </Section>
        )}

        {(t.byMethod.length > 0 || t.trials.given > 0) && (
          <Section title={tr("طرق الدفع اليوم", "Payment today")}>
            <table className="w-full text-sm">
              <tbody>
                {t.byMethod.map((m, i) => (
                  <tr key={m.methodId ?? i}>
                    <td className="td">{m.nameAr ? pick({ nameAr: m.nameAr, nameEn: m.nameEn ?? m.nameAr }) : tr("بدون دفع (مجاني)", "No payment (free)")}</td>
                    <td className="td num text-end">{m.n}</td>
                    <td className="td text-end">
                      <span className="num ltr">{usd(m.usd)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {t.trials.given > 0 && (
              <p className="mt-2 text-sm text-muted">
                {tr("تجارب مجانية", "Free trials")}: <span className="num">{t.trials.given}</span> · {tr("صاروا زبائن", "became clients")}:{" "}
                <span className="num">{t.trials.converted}</span>
              </p>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
