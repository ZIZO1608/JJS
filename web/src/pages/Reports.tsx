import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Stat } from "../components/Tabs";
import { Empty, PageHeader, Spinner, TextInput } from "../components/ui";
import { useAuth } from "../lib/auth";
import { addDaysTo, monthStartOf, pct, qty, today, usd } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { openPrint } from "../lib/print";
import { useData } from "../lib/useData";
import type { PeriodReport } from "../lib/types";

type Preset = "today" | "yesterday" | "week" | "month" | "lastMonth";

function rangeOf(p: Preset): [string, string] {
  const t = today();
  if (p === "today") return [t, t];
  if (p === "yesterday") {
    const y = addDaysTo(t, -1);
    return [y, y];
  }
  if (p === "week") {
    const dow = new Date(`${t}T12:00:00`).getDay(); // week starts Saturday in Syria
    const back = (dow + 1) % 7;
    return [addDaysTo(t, -back), t];
  }
  if (p === "month") return [monthStartOf(t), t];
  const firstThis = monthStartOf(t);
  const lastPrev = addDaysTo(firstThis, -1);
  return [monthStartOf(lastPrev), lastPrev];
}

function Block({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`card min-w-0 ${wide ? "lg:col-span-2" : ""}`}>
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Two-column table rows: label → value. */
function Rows({ rows }: { rows: [ReactNode, ReactNode, string?][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([a, b, cls], i) => (
          <tr key={i} className={cls}>
            <td className="td">{a}</td>
            <td className="td text-end">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReportsPage() {
  const { tr, pick, err } = useI18n();
  const { can, simple } = useAuth();
  const [preset, setPreset] = useState<Preset | null>("today");
  const [[from, to], setRange] = useState<[string, string]>(rangeOf("today"));
  const { data: r, error } = useData<PeriodReport>(`/reports/range?from=${from}&to=${to}`);

  const presets: [Preset, string][] = [
    ["today", tr("اليوم", "Today")],
    ["yesterday", tr("أمس", "Yesterday")],
    ["week", tr("هذا الأسبوع", "This week")],
    ["month", tr("هذا الشهر", "This month")],
    ["lastMonth", tr("الشهر الماضي", "Last month")],
  ];
  const U = (v: number | undefined) => <span className="num ltr">{usd(v)}</span>;
  const showCost = r && !r.hiddenCosts;

  return (
    <div>
      <PageHeader
        title={tr("التقارير", "Reports")}
        actions={
          <button className="btn" onClick={() => openPrint(`/print/report?from=${from}&to=${to}`)}>
            {tr("طباعة", "Print")}
          </button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {presets.map(([k, label]) => (
          <button
            key={k}
            className={`btn ${preset === k ? "btn-primary" : ""} py-1.5`}
            onClick={() => {
              setPreset(k);
              setRange(rangeOf(k));
            }}
          >
            {label}
          </button>
        ))}
        <span className="ms-2 flex items-center gap-1">
          <TextInput type="date" className="w-auto" value={from} max={to} onChange={(e) => e.target.value && (setPreset(null), setRange([e.target.value, to]))} aria-label={tr("من", "From")} />
          <span className="text-muted">—</span>
          <TextInput type="date" className="w-auto" value={to} min={from} max={today()} onChange={(e) => e.target.value && (setPreset(null), setRange([from, e.target.value]))} aria-label={tr("إلى", "To")} />
        </span>
      </div>

      {error ? (
        <p className="text-bad">{err(error)}</p>
      ) : !r ? (
        <Spinner />
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={tr("المبيعات", "Sales")} value={usd(r.salesUsd)} sub={`${r.orders} ${tr("طلب", "orders")} · ${qty(r.items)} ${tr("قطعة", "items")}`} />
            <Stat label={tr("الخصومات", "Discounts")} value={usd(r.discountUsd)} sub={r.freeItems ? `${r.freeItems} ${tr("قطعة مجانية", "free items")}` : undefined} />
            {showCost ? (
              <>
                <Stat label={tr("الربح الإجمالي", "Gross profit")} value={usd(r.grossProfitUsd)} sub={`${tr("هامش", "Margin")} ${pct(r.marginPct)}`} />
                <Stat label={tr("الصافي", "Net profit")} value={usd(r.netUsd)} tone={(r.netUsd ?? 0) < 0 ? "bad" : "good"} />
              </>
            ) : (
              <>
                <Stat label={tr("المصاريف", "Expenses")} value={usd(r.expensesUsd)} />
                <Stat label={tr("الهدر", "Waste")} value={usd(r.wasteUsd)} />
              </>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Block title={tr("الملخّص", "Summary")}>
              <Rows
                rows={[
                  [tr("المبيعات قبل الخصم", "Sales before discount"), U(r.grossUsd)],
                  [tr("الخصومات", "Discounts"), <>−{U(r.discountUsd)}</>],
                  [tr("الضرائب المحصّلة", "Tax collected"), U(r.taxUsd)],
                  [tr("أجور التوصيل", "Delivery fees"), U(r.deliveryUsd)],
                  [<b key="s">{tr("المبيعات", "Sales")}</b>, <b key="v">{U(r.salesUsd)}</b>],
                  ...(showCost
                    ? ([
                        [tr("تكلفة البضاعة", "Cost of goods"), <>−{U(r.costUsd)}</>],
                        [<b key="g">{tr("الربح الإجمالي (بدون الضريبة)", "Gross profit (tax excluded)")}</b>, <b key="gv">{U(r.grossProfitUsd)}</b>],
                      ] as [ReactNode, ReactNode][])
                    : []),
                  [tr("المصاريف", "Expenses"), <>−{U(r.expensesUsd)}</>],
                  [tr("الهدر", "Waste"), <>−{U(r.wasteUsd)}</>],
                  ...(showCost
                    ? ([
                        [tr("استهلاك الأصول", "Depreciation"), <>−{U(r.depreciationUsd)}</>],
                        [tr("الرواتب المدفوعة", "Salaries paid"), <>−{U(r.salariesUsd)}</>],
                        [<b key="n">{tr("صافي الربح", "Net profit")}</b>, <b key="nv" className={(r.netUsd ?? 0) < 0 ? "text-bad" : ""}>{U(r.netUsd)}</b>],
                      ] as [ReactNode, ReactNode][])
                    : []),
                ]}
              />
              {r.hiddenCosts && <p className="mt-2 text-xs text-faint">{tr("التكاليف والأرباح مخفية لدورك.", "Costs and profit are hidden for your role.")}</p>}
            </Block>

            <Block title={tr("حسب طريقة الدفع", "By payment method")}>
              {r.byMethod.length === 0 ? (
                <Empty text={tr("لا شيء", "Nothing")} />
              ) : (
                <Rows rows={r.byMethod.map((m) => [`${m.nameAr ? pick({ nameAr: m.nameAr, nameEn: m.nameEn ?? m.nameAr }) : tr("مجاني", "Free")} (${m.n})`, U(m.usd)])} />
              )}
              {r.byStatus.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {r.byStatus.map((s) => (
                    <span key={s.status} className="chip">
                      {{ paid: tr("مدفوع", "Paid"), credit: tr("على الحساب", "On account"), free: tr("مجاني", "Free"), salary: tr("من الراتب", "From salary") }[s.status] ?? s.status}: <span className="num">{s.n}</span> ·{" "}
                      <span className="num ltr">{usd(s.usd)}</span>
                    </span>
                  ))}
                </div>
              )}
            </Block>

            <Block title={tr("حسب المنتج", "By product")} wide>
              {r.byProduct.length === 0 ? (
                <Empty text={tr("لا مبيعات", "No sales")} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="th">{tr("المنتج", "Product")}</th>
                        <th className="th text-end">{tr("الكمية", "Qty")}</th>
                        <th className="th text-end">{tr("الإيراد", "Revenue")}</th>
                        {showCost && <th className="th text-end">{tr("التكلفة", "Cost")}</th>}
                        {showCost && <th className="th text-end">{tr("الهامش", "Margin")}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {r.byProduct.map((p) => (
                        <tr key={p.productId}>
                          <td className="td">{pick(p)}</td>
                          <td className="td num text-end">{qty(p.qty)}</td>
                          <td className="td text-end">{U(p.revenueUsd)}</td>
                          {showCost && <td className="td text-end">{U(p.costUsd)}</td>}
                          {showCost && <td className={`td num text-end ${(p.marginPct ?? 0) < 20 ? "text-warn" : ""}`}>{pct(p.marginPct)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Block>

            <Block title={tr("حسب الفئة", "By category")}>
              {r.byCategory.length === 0 ? <Empty text={tr("لا شيء", "Nothing")} /> : <Rows rows={r.byCategory.map((c) => [pick(c), <span key={c.categoryId} className="num">{qty(c.qty)}</span>])} />}
              {r.byType.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {r.byType.map((t) => (
                    <span key={t.type} className="chip">
                      {{ normal: tr("عادي", "Normal"), trial: tr("تجربة", "Trial"), staff: tr("موظفين", "Staff") }[t.type] ?? t.type}: <span className="num">{t.n}</span> {tr("طلب", "orders")} · <span className="num">{qty(t.items)}</span>{" "}
                      {tr("قطعة", "items")}
                    </span>
                  ))}
                </div>
              )}
            </Block>

            <Block title={tr("حسب الزبون", "By client")}>
              {r.byClient.length === 0 ? (
                <Empty text={tr("لا شيء", "Nothing")} />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th">{tr("الزبون", "Client")}</th>
                      <th className="th text-end">{tr("طلبات", "Orders")}</th>
                      <th className="th text-end">{tr("المبيعات", "Sales")}</th>
                      <th className="th text-end">{tr("الرصيد", "Balance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byClient.map((c) => (
                      <tr key={c.clientId}>
                        <td className="td">{can("clients", "view") && !simple ? <Link to={`/clients/${c.clientId}`} className="hover:underline">{c.name}</Link> : c.name}</td>
                        <td className="td num text-end">{c.orders}</td>
                        <td className="td text-end">{U(c.salesUsd)}</td>
                        <td className={`td text-end ${c.balanceUsd < 0 ? "text-bad" : ""}`}>{U(c.balanceUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Block>

            <Block title={tr("المصاريف حسب الفئة", "Expenses by category")}>
              {r.expenses.length === 0 ? (
                <Empty text={tr("لا مصاريف", "No expenses")} />
              ) : (
                <Rows rows={r.expenses.map((e) => [`${e.nameAr ? pick({ nameAr: e.nameAr, nameEn: e.nameEn ?? e.nameAr }) : tr("بدون فئة", "No category")} (${e.n})`, U(e.usd)])} />
              )}
            </Block>

            <Block title={tr("الهدر", "Waste")}>
              {r.waste.length === 0 ? (
                <Empty text={tr("لا هدر", "No waste")} />
              ) : (
                <Rows
                  rows={r.waste.map((w) => [
                    <>
                      {pick(w)} <span className="num text-muted">×{qty(w.qty)}</span>
                    </>,
                    U(w.usd),
                  ])}
                />
              )}
            </Block>

            {showCost && r.depreciation.length > 0 && (
              <Block title={tr("استهلاك الأصول", "Depreciation")}>
                <Rows rows={r.depreciation.map((d) => [pick(d), U(d.usd)])} />
              </Block>
            )}

            <Block title={tr("التجارب المجانية", "Free trials")}>
              <Rows
                rows={[
                  [tr("تجارب أُعطيت", "Trials given"), <span key="g" className="num">{r.trials.given}</span>],
                  [tr("صاروا زبائن", "Became clients"), <span key="c" className="num">{r.trials.converted}</span>],
                  [tr("نسبة التحويل", "Conversion rate"), <span key="r" className="num">{pct(r.trials.rate)}</span>],
                ]}
              />
            </Block>

            {r.unpaid && (
              <Block title={tr("ديون الزبائن (الآن)", "Client debts (now)")}>
                {r.unpaid.length === 0 ? (
                  <Empty text={tr("لا أحد", "Nobody")} />
                ) : (
                  <Rows rows={r.unpaid.map((c) => [c.name, <span key={c.id} className="text-bad">{U(-c.balanceUsd)}</span>])} />
                )}
              </Block>
            )}
          </div>

          {can("reports", "export") && (
            <div className="card flex flex-wrap items-center gap-2">
              <span className="me-2 font-semibold">{tr("تصدير Excel (CSV)", "Export to Excel (CSV)")}</span>
              {(
                [
                  ["orders", tr("الطلبات", "Orders")],
                  ["products", tr("المنتجات", "Products")],
                  ["clients", tr("الزبائن", "Clients")],
                  ["expenses", tr("المصاريف", "Expenses")],
                ] as const
              ).map(([k, label]) => (
                <a key={k} className="btn py-1.5" href={`/api/reports/export/${k}.csv?from=${from}&to=${to}`}>
                  {label}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
