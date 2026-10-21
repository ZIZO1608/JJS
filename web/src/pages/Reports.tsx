import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Stat } from "../components/Tabs";
import { Empty, PageHeader, Spinner, TextInput } from "../components/ui";
import { useAuth } from "../lib/auth";
import { addDaysTo, money, monthStartOf, pct, qty, today, usd, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { openPrint } from "../lib/print";
import { useData } from "../lib/useData";
import type { PeriodReport } from "../lib/types";
import { MOVE_TYPE } from "./DailyClose";

type Preset = "today" | "yesterday" | "week" | "month" | "lastMonth";

/** The range report with the wholesale fields. */
type Report = Omit<PeriodReport, "byCategory" | "byClient"> & {
  returnsUsd?: number;
  returnsCount?: number;
  returnedQty?: { restock: number; waste: number };
  netSalesUsd?: number;
  collectedUsd?: number;
  purchasesUsd?: number;
  purchasesCount?: number;
  internalUse?: { orders: number; items: number; costUsd: number };
  withdrawalsUsd?: number;
  dueExpensesUsd?: number;
  operatingProfitUsd?: number;
  avgRate?: number | null;
  byCategory: { categoryId: string; nameAr: string; nameEn: string; qty: number; revenueUsd?: number; costUsd?: number; marginPct?: number }[];
  byClient: {
    clientId: string | null;
    name: string | null;
    orders: number;
    items: number;
    salesUsd: number;
    balanceUsd: number | null;
    returnsUsd?: number;
    costUsd?: number;
    profitUsd?: number;
    marginPct?: number;
    overdueDays?: number;
  }[];
};

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

type Extra = "production" | "cashflow" | "months" | "delivery";

interface ProdRow {
  productId: string | null;
  nameAr: string;
  nameEn: string;
  opening: number;
  made: number;
  fromFridge: number;
  madeFresh: number;
  consigned: number;
  consignSold: number;
  returnedIn: number;
  wasted: number;
  closing: number;
}
interface CashFlow {
  boxes: { id: string; nameAr: string; nameEn: string; currency: Currency; opening: number; moves: { type: string; amount: number; usd: number; n: number }[]; closing: number }[];
  byType: { type: string; usd: number }[];
  inUsd: number;
  outUsd: number;
  netUsd: number;
}
interface MonthRow {
  month: string;
  orders: number;
  items: number;
  salesUsd: number;
  costUsd: number;
  grossProfitUsd: number;
  expensesUsd: number;
  netUsd: number;
  marginPct: number;
}
interface DeliveryCost {
  rows: { employeeId: string | null; name: string | null; category: string | null; usd: number; n: number }[];
  totalUsd: number;
  deliveries: number;
  perDeliveryUsd: number | null;
  feesCollectedUsd: number;
}

/** The longer reports, loaded only when asked for. */
function ExtraReports({ from, to, U }: { from: string; to: string; U: (v: number | undefined) => ReactNode }) {
  const { tr, pick, lang } = useI18n();
  const { can } = useAuth();
  const seeCost = can("costing", "see_cost");
  const [open, setOpen] = useState<Extra | null>(null);
  const prod = useData<{ rows: ProdRow[] }>(open === "production" ? `/reports/production?from=${from}&to=${to}` : null);
  const cash = useData<CashFlow>(open === "cashflow" ? `/reports/cashflow?from=${from}&to=${to}` : null);
  const months = useData<{ rows: MonthRow[] }>(open === "months" ? "/reports/months?n=6" : null);
  const dc = useData<DeliveryCost>(open === "delivery" ? `/reports/delivery-cost?from=${from}&to=${to}` : null);
  const tabs: [Extra, string, boolean][] = [
    ["production", tr("المنتَج مقابل المباع", "Made vs sold"), true],
    ["cashflow", tr("التدفق النقدي", "Cash flow"), seeCost],
    ["months", tr("مقارنة الأشهر", "Month comparison"), seeCost],
    ["delivery", tr("تكلفة التوصيل", "Delivery cost"), seeCost],
  ];
  const maxMonth = Math.max(1, ...(months.data?.rows ?? []).map((m) => m.salesUsd));
  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="me-2 font-semibold">{tr("تقارير إضافية", "More reports")}</h2>
        {tabs
          .filter(([, , ok]) => ok)
          .map(([k, label]) => (
            <button key={k} className={`btn py-1.5 ${open === k ? "btn-primary" : ""}`} onClick={() => setOpen(open === k ? null : k)}>
              {label}
            </button>
          ))}
      </div>

      {open === "production" &&
        (!prod.data ? (
          <Spinner />
        ) : prod.data.rows.length === 0 ? (
          <Empty text={tr("ما في حركة منتجات بالفترة", "No product moves in this period")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">{tr("الصنف", "Product")}</th>
                  <th className="th text-end">{tr("البداية", "Opening")}</th>
                  <th className="th text-end">{tr("انصنع", "Made")}</th>
                  <th className="th text-end">{tr("انباع من البرّاد", "Sold from fridge")}</th>
                  <th className="th text-end">{tr("طازة للطلبات", "Made fresh")}</th>
                  <th className="th text-end">{tr("بالأمانة", "Consigned")}</th>
                  <th className="th text-end">{tr("رجع", "Returned")}</th>
                  <th className="th text-end">{tr("تالف", "Wasted")}</th>
                  <th className="th text-end">{tr("النهاية", "Closing")}</th>
                </tr>
              </thead>
              <tbody>
                {prod.data.rows.map((r, i) => (
                  <tr key={r.productId ?? i}>
                    <td className="td font-semibold">{pick(r)}</td>
                    <td className="td num text-end">{qty(r.opening)}</td>
                    <td className="td num text-end">{qty(r.made)}</td>
                    <td className="td num text-end">{qty(r.fromFridge)}</td>
                    <td className="td num text-end">{qty(r.madeFresh)}</td>
                    <td className="td num text-end">
                      {qty(r.consigned)}
                      {r.consignSold > 0 && (
                        <span className="text-xs text-faint">
                          {" "}
                          ({tr("انباع", "sold")} {qty(r.consignSold)})
                        </span>
                      )}
                    </td>
                    <td className="td num text-end">{qty(r.returnedIn)}</td>
                    <td className={`td num text-end ${r.wasted > 0 ? "text-bad" : ""}`}>{qty(r.wasted)}</td>
                    <td className="td num text-end font-semibold">{qty(r.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {open === "cashflow" &&
        (!cash.data ? (
          <Spinner />
        ) : (
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={tr("دخل", "Money in")} value={usd(cash.data.inUsd)} />
              <Stat label={tr("طلع", "Money out")} value={usd(cash.data.outUsd)} />
              <Stat label={tr("الصافي", "Net")} value={usd(cash.data.netUsd)} tone={cash.data.netUsd < 0 ? "bad" : undefined} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {cash.data.boxes
                .filter((b) => b.moves.length > 0 || Math.abs(b.opening) > 0.009)
                .map((b) => (
                  <div key={b.id} className="rounded-xl border border-line p-3">
                    <div className="mb-1 font-semibold">{pick(b)}</div>
                    <Rows
                      rows={[
                        [
                          tr("البداية", "Opening"),
                          <span key="o" className="num ltr">
                            {money(b.opening, b.currency, lang)}
                          </span>,
                        ],
                        ...b.moves.map(
                          (m) =>
                            [
                              `${tr(...(MOVE_TYPE[m.type] ?? [m.type, m.type]))} (${m.n})`,
                              <span key={m.type} className={`num ltr ${m.amount < 0 ? "text-muted" : ""}`}>
                                {money(m.amount, b.currency, lang)}
                              </span>,
                            ] as [ReactNode, ReactNode],
                        ),
                        [
                          <b key="c">{tr("النهاية", "Closing")}</b>,
                          <b key="cv" className="num ltr">
                            {money(b.closing, b.currency, lang)}
                          </b>,
                        ],
                      ]}
                    />
                  </div>
                ))}
            </div>
          </div>
        ))}

      {open === "months" &&
        (!months.data ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">{tr("الشهر", "Month")}</th>
                  <th className="th">{tr("المبيعات", "Sales")}</th>
                  <th className="th text-end">{tr("التكلفة", "Cost")}</th>
                  <th className="th text-end">{tr("الربح الإجمالي", "Gross profit")}</th>
                  <th className="th text-end">{tr("المصاريف", "Expenses")}</th>
                  <th className="th text-end">{tr("الصافي", "Net")}</th>
                </tr>
              </thead>
              <tbody>
                {months.data.rows.map((m) => (
                  <tr key={m.month}>
                    <td className="td num">{m.month}</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded bg-sunken">
                          <div className="h-2 rounded bg-ink" style={{ width: `${Math.round((m.salesUsd / maxMonth) * 100)}%` }} />
                        </div>
                        <span className="w-24 text-end">{U(m.salesUsd)}</span>
                      </div>
                    </td>
                    <td className="td text-end">{U(m.costUsd)}</td>
                    <td className="td text-end">
                      {U(m.grossProfitUsd)} <span className="text-xs text-faint">{pct(m.marginPct)}</span>
                    </td>
                    <td className="td text-end">{U(m.expensesUsd)}</td>
                    <td className={`td text-end font-semibold ${m.netUsd < 0 ? "text-bad" : ""}`}>{U(m.netUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {open === "delivery" &&
        (!dc.data ? (
          <Spinner />
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={tr("تكلفة التوصيل", "Delivery cost")} value={usd(dc.data.totalUsd)} />
              <Stat
                label={tr("عدد التوصيلات", "Deliveries")}
                value={String(dc.data.deliveries)}
                sub={dc.data.perDeliveryUsd !== null ? `${usd(dc.data.perDeliveryUsd)} ${tr("للتوصيلة", "each")}` : undefined}
              />
              <Stat label={tr("أجور توصيل محصّلة", "Delivery fees collected")} value={usd(dc.data.feesCollectedUsd)} />
            </div>
            {dc.data.rows.length === 0 ? (
              <Empty text={tr("ما في مصاريف توصيل أو وقود مسجّلة", "No delivery or fuel expenses recorded")} />
            ) : (
              <Rows rows={dc.data.rows.map((x) => [`${x.name ?? tr("بدون مندوب", "No rep")}${x.category ? ` · ${x.category}` : ""} (${x.n})`, U(x.usd)])} />
            )}
          </div>
        ))}
    </section>
  );
}

export function ReportsPage() {
  const { tr, pick, err, lang } = useI18n();
  const { can, simple } = useAuth();
  const [preset, setPreset] = useState<Preset | null>("today");
  const [[from, to], setRange] = useState<[string, string]>(rangeOf("today"));
  const [cur, setCur] = useState<"USD" | "SYP">("USD");
  const { data: r, error } = useData<Report>(`/reports/range?from=${from}&to=${to}`);

  const presets: [Preset, string][] = [
    ["today", tr("اليوم", "Today")],
    ["yesterday", tr("أمس", "Yesterday")],
    ["week", tr("هذا الأسبوع", "This week")],
    ["month", tr("هذا الشهر", "This month")],
    ["lastMonth", tr("الشهر الماضي", "Last month")],
  ];
  const rate = r?.avgRate ?? null;
  const show = (v: number | undefined) => (v === undefined ? "—" : cur === "SYP" && rate ? money(v * rate, "SYP", lang) : usd(v));
  const U = (v: number | undefined) => <span className="num ltr">{show(v)}</span>;
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
          <TextInput
            type="date"
            className="w-auto"
            value={from}
            max={to}
            onChange={(e) => e.target.value && (setPreset(null), setRange([e.target.value, to]))}
            aria-label={tr("من", "From")}
          />
          <span className="text-muted">—</span>
          <TextInput
            type="date"
            className="w-auto"
            value={to}
            min={from}
            max={today()}
            onChange={(e) => e.target.value && (setPreset(null), setRange([from, e.target.value]))}
            aria-label={tr("إلى", "To")}
          />
        </span>
        {rate && (
          <div className="ms-auto inline-flex rounded-lg bg-sunken p-0.5" role="group" aria-label={tr("العملة", "Currency")}>
            {(["USD", "SYP"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCur(c)}
                aria-pressed={cur === c}
                className={`rounded-md px-2.5 py-1 text-sm font-semibold ${cur === c ? "bg-surface shadow-sm" : "text-muted"}`}
              >
                {c === "USD" ? "$" : tr("ل.س", "SYP")}
              </button>
            ))}
          </div>
        )}
      </div>
      {cur === "SYP" && rate && (
        <p className="-mt-3 mb-4 text-xs text-faint">
          {tr("تقريباً، بمتوسط سعر الفترة", "Approx. at the period's average rate")}: <span className="num ltr">{Math.round(rate).toLocaleString("en-US")}</span>
        </p>
      )}

      {error ? (
        <p className="text-bad">{err(error)}</p>
      ) : !r ? (
        <Spinner />
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label={tr("صافي المبيعات", "Net sales")}
              value={show(r.netSalesUsd ?? r.salesUsd)}
              sub={`${r.orders} ${tr("طلب", "orders")} · ${qty(r.items)} ${tr("قطعة", "items")}`}
            />
            <Stat label={tr("المقبوض فعلياً", "Money collected")} value={show(r.collectedUsd ?? 0)} sub={tr("كاش وتحويلات ودفعات زبائن", "Cash, transfers and client payments")} />
            {showCost ? (
              <>
                <Stat label={tr("الربح الإجمالي", "Gross profit")} value={show(r.grossProfitUsd)} sub={`${tr("هامش", "Margin")} ${pct(r.marginPct)}`} />
                <Stat label={tr("الصافي", "Net profit")} value={show(r.netUsd)} tone={(r.netUsd ?? 0) < 0 ? "bad" : "good"} />
              </>
            ) : (
              <>
                <Stat label={tr("المصاريف", "Expenses")} value={show(r.expensesUsd)} />
                <Stat label={tr("الهدر", "Waste")} value={show(r.wasteUsd)} />
              </>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Block title={tr("الأرباح والخسائر", "Profit & loss")}>
              <Rows
                rows={[
                  [tr("المبيعات قبل الخصم", "Sales before discount"), U(r.grossUsd)],
                  [tr("الخصومات", "Discounts"), <>−{U(r.discountUsd)}</>],
                  [tr("الضرائب المحصّلة", "Tax collected"), U(r.taxUsd)],
                  [tr("أجور التوصيل", "Delivery fees"), U(r.deliveryUsd)],
                  [<b key="s">{tr("المبيعات", "Sales")}</b>, <b key="v">{U(r.salesUsd)}</b>],
                  ...((r.returnsUsd ?? 0) > 0
                    ? ([
                        [`${tr("المرتجعات", "Returns")} (${r.returnsCount ?? 0})`, <>−{U(r.returnsUsd)}</>],
                        [<b key="ns">{tr("صافي المبيعات", "Net sales")}</b>, <b key="nsv">{U(r.netSalesUsd)}</b>],
                      ] as [ReactNode, ReactNode][])
                    : []),
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
                        [tr("الرواتب المدفوعة", "Salaries paid"), <>−{U(r.salariesUsd)}</>],
                        ...(r.operatingProfitUsd !== undefined
                          ? ([[<b key="op">{tr("الربح التشغيلي", "Operating profit")}</b>, <b key="opv">{U(r.operatingProfitUsd)}</b>]] as [ReactNode, ReactNode][])
                          : []),
                        [tr("استهلاك الأصول", "Depreciation"), <>−{U(r.depreciationUsd)}</>],
                        [
                          <b key="n">{tr("صافي الربح", "Net profit")}</b>,
                          <b key="nv" className={(r.netUsd ?? 0) < 0 ? "text-bad" : ""}>
                            {U(r.netUsd)}
                          </b>,
                        ],
                      ] as [ReactNode, ReactNode][])
                    : []),
                ]}
              />
              {r.hiddenCosts && <p className="mt-2 text-xs text-faint">{tr("التكاليف والأرباح مخفية لدورك.", "Costs and profit are hidden for your role.")}</p>}
            </Block>

            <Block title={tr("المال", "Money")}>
              {r.byMethod.length === 0 ? (
                <Empty text={tr("لا شيء", "Nothing")} />
              ) : (
                <Rows rows={r.byMethod.map((m) => [`${m.nameAr ? pick({ nameAr: m.nameAr, nameEn: m.nameEn ?? m.nameAr }) : tr("مجاني", "Free")} (${m.n})`, U(m.usd)])} />
              )}
              <Rows
                rows={[
                  [tr("المقبوض فعلياً", "Collected"), U(r.collectedUsd ?? 0)],
                  [`${tr("المشتريات", "Purchases")} (${r.purchasesCount ?? 0})`, U(r.purchasesUsd ?? 0)],
                  ...((r.dueExpensesUsd ?? 0) > 0 ? ([[tr("مصاريف مستحقة لسا ما اندفعت", "Expenses still due"), U(r.dueExpensesUsd)]] as [ReactNode, ReactNode][]) : []),
                  ...(r.withdrawalsUsd !== undefined ? ([[tr("سحوبات شخصية", "Personal withdrawals"), U(r.withdrawalsUsd)]] as [ReactNode, ReactNode][]) : []),
                  ...(r.internalUse && r.internalUse.costUsd > 0
                    ? ([[`${tr("استهلاك داخلي وتذوّق", "Internal use & tasting")} (${qty(r.internalUse.items)} ${tr("قطعة", "pcs")})`, U(r.internalUse.costUsd)]] as [
                        ReactNode,
                        ReactNode,
                      ][])
                    : []),
                ]}
              />
              {r.byStatus.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {r.byStatus.map((s) => (
                    <span key={s.status} className="chip">
                      {{
                        paid: tr("مدفوع", "Paid"),
                        partial: tr("مدفوع جزئياً", "Part paid"),
                        credit: tr("على الحساب", "On account"),
                        free: tr("مجاني", "Free"),
                        salary: tr("من الراتب", "From salary"),
                      }[s.status] ?? s.status}
                      : <span className="num">{s.n}</span> · {U(s.usd)}
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
              {r.byCategory.length === 0 ? (
                <Empty text={tr("لا شيء", "Nothing")} />
              ) : (
                <Rows
                  rows={r.byCategory.map((c) => [
                    <>
                      {pick(c)} <span className="num text-muted">×{qty(c.qty)}</span>
                    </>,
                    <>
                      {c.revenueUsd !== undefined && U(c.revenueUsd)}
                      {showCost && c.marginPct !== undefined && <span className="ms-2 text-xs text-faint">{pct(c.marginPct)}</span>}
                    </>,
                  ])}
                />
              )}
              {r.byType.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {r.byType.map((t) => (
                    <span key={t.type} className="chip">
                      {{ normal: tr("عادي", "Normal"), trial: tr("تجربة", "Trial"), staff: tr("موظفين", "Staff"), internal: tr("داخلي", "Internal") }[t.type] ?? t.type}:{" "}
                      <span className="num">{t.n}</span> {tr("طلب", "orders")} · <span className="num">{qty(t.items)}</span> {tr("قطعة", "items")}
                    </span>
                  ))}
                </div>
              )}
            </Block>

            <Block title={tr("حسب الزبون", "By client")}>
              {r.byClient.length === 0 ? (
                <Empty text={tr("لا شيء", "Nothing")} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="th">{tr("الزبون", "Client")}</th>
                        <th className="th text-end">{tr("المبيعات", "Sales")}</th>
                        {showCost && <th className="th text-end">{tr("الربح", "Profit")}</th>}
                        <th className="th text-end">{tr("الرصيد", "Balance")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byClient.map((c) => (
                        <tr key={c.clientId ?? "walkin"}>
                          <td className="td">
                            {c.clientId && can("clients", "view") && !simple ? (
                              <Link to={`/clients/${c.clientId}`} className="hover:underline">
                                {c.name}
                              </Link>
                            ) : (
                              (c.name ?? tr("زبائن عابرون", "Walk-in"))
                            )}
                            {(c.overdueDays ?? 0) > 0 && <span className="ms-2 text-xs text-bad">{tr(`متأخر ${c.overdueDays} يوم`, `${c.overdueDays}d late`)}</span>}
                          </td>
                          <td className="td text-end">
                            {U(c.salesUsd)}
                            {(c.returnsUsd ?? 0) > 0 && <div className="text-xs text-faint">−{show(c.returnsUsd)}</div>}
                          </td>
                          {showCost && (
                            <td className="td text-end">
                              {U(c.profitUsd)} {c.marginPct !== undefined && <span className="text-xs text-faint">{pct(c.marginPct)}</span>}
                            </td>
                          )}
                          <td className={`td text-end ${(c.balanceUsd ?? 0) < -0.009 ? "text-bad" : ""}`}>
                            {c.balanceUsd === null ? (
                              "—"
                            ) : c.balanceUsd < -0.009 ? (
                              <>
                                {tr("عليه", "owes")} {U(-c.balanceUsd)}
                              </>
                            ) : (
                              U(c.balanceUsd)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Block>

            <Block title={tr("المصاريف حسب الفئة", "Expenses by category")}>
              {r.expenses.length === 0 ? (
                <Empty text={tr("لا مصاريف", "No expenses")} />
              ) : (
                <Rows rows={r.expenses.map((e) => [`${e.nameAr ? pick({ nameAr: e.nameAr, nameEn: e.nameEn ?? e.nameAr }) : tr("بدون فئة", "No category")} (${e.n})`, U(e.usd)])} />
              )}
            </Block>

            <Block title={tr("الهدر والمرتجعات", "Waste & returns")}>
              {r.waste.length === 0 && !r.returnsCount ? (
                <Empty text={tr("لا هدر", "No waste")} />
              ) : (
                <>
                  <Rows
                    rows={r.waste.map((w) => [
                      <>
                        {pick(w)} <span className="num text-muted">×{qty(w.qty)}</span>
                      </>,
                      U(w.usd),
                    ])}
                  />
                  {r.returnedQty && (r.returnedQty.restock > 0 || r.returnedQty.waste > 0) && (
                    <p className="mt-2 text-sm text-muted">
                      {tr("مرتجعات", "Returned")}: <span className="num">{r.returnedQty.restock}</span> {tr("رجعت للبرّاد", "back to fridge")} ·{" "}
                      <span className="num">{r.returnedQty.waste}</span> {tr("تالفة", "wasted")}
                    </p>
                  )}
                </>
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
                  [
                    tr("تجارب أُعطيت", "Trials given"),
                    <span key="g" className="num">
                      {r.trials.given}
                    </span>,
                  ],
                  [
                    tr("صاروا زبائن", "Became clients"),
                    <span key="c" className="num">
                      {r.trials.converted}
                    </span>,
                  ],
                  [
                    tr("نسبة التحويل", "Conversion rate"),
                    <span key="r" className="num">
                      {pct(r.trials.rate)}
                    </span>,
                  ],
                ]}
              />
            </Block>

            {r.unpaid && (
              <Block title={tr("ديون الزبائن (الآن)", "Client debts (now)")}>
                {r.unpaid.length === 0 ? (
                  <Empty text={tr("لا أحد", "Nobody")} />
                ) : (
                  <Rows
                    rows={r.unpaid.map((c) => [
                      c.name,
                      <span key={c.id} className="text-bad">
                        {U(-c.balanceUsd)}
                      </span>,
                    ])}
                  />
                )}
              </Block>
            )}
          </div>

          <ExtraReports from={from} to={to} U={U} />

          {can("reports", "export") && (
            <div className="card flex flex-wrap items-center gap-2">
              <span className="me-2 font-semibold">{tr("تصدير Excel (CSV)", "Export to Excel (CSV)")}</span>
              {(
                [
                  ["orders", tr("الطلبات", "Orders")],
                  ["products", tr("المنتجات", "Products")],
                  ["clients", tr("الزبائن", "Clients")],
                  ["expenses", tr("المصاريف", "Expenses")],
                  ["returns", tr("المرتجعات", "Returns")],
                  ["purchases", tr("المشتريات", "Purchases")],
                  ["client-debts", tr("ديون الزبائن", "Client debts")],
                  ["supplier-debts", tr("ديون الموردين", "Supplier debts")],
                  ["withdrawals", tr("السحوبات", "Withdrawals")],
                  ["production", tr("الإنتاج مقابل المبيعات", "Production vs sales")],
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
