import { useState } from "react";
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
interface DayView {
  day: DayRow;
  report: PeriodReport;
  mainBox: { id: string; nameAr: string; nameEn: string; currency: Currency; expected: number };
  reps: { id: string; nameAr: string; nameEn: string; currency: Currency; balance: number }[];
}

/** The numbers of one day (used after closing and for past days). */
function DaySummary({ r, cash }: { r: PeriodReport; cash?: DayTotals["cash"] | null }) {
  const { tr, pick, lang } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("المبيعات", "Sales")} value={usd(r.salesUsd)} />
        <Stat label={tr("الطلبات", "Orders")} value={String(r.orders)} sub={`${qty(r.items)} ${tr("قطعة", "items")}${r.freeItems ? ` · ${r.freeItems} ${tr("مجاني", "free")}` : ""}`} />
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
          <h3 className="mb-2 font-semibold">{tr("حسب طريقة الدفع", "By payment method")}</h3>
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

  const d = view.data;
  const box = d?.mainBox;
  const c = num(counted);
  const diff = box && !Number.isNaN(c) ? Math.round((c - box.expected) * 100) / 100 : null;
  const isToday = date === today();
  const big = simple;

  return (
    <div>
      <PageHeader
        title={tr("إقفال اليوم", "Close the day")}
        subtitle={tr("سلّم نقد التوصيل، عدّ الصندوق، واقفل اليوم.", "Receive delivery cash, count the box, and lock the day.")}
        actions={
          <div className="flex items-center gap-2">
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
          <DaySummary r={d.day.totals ?? d.report} cash={d.day.totals?.cash} />
        </div>
      ) : (
        <div className="grid gap-4">
          {/* step 1: delivery cash */}
          <section className="card">
            <h2 className={`mb-2 font-bold ${big ? "text-xl" : "text-lg"}`}>1 · {tr("استلام نقد التوصيل", "Receive delivery cash")}</h2>
            {d.reps.filter((r) => r.balance > 0.009).length === 0 ? (
              <p className="text-muted">{tr("ما في نقد عند موظفي التوصيل. ✓", "No delivery person is holding cash. ✓")}</p>
            ) : (
              <ul className="grid gap-2">
                {d.reps
                  .filter((r) => r.balance > 0.009)
                  .map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold">{pick(r)}</span>
                      <span className="num ltr text-lg">{money(r.balance, r.currency, lang)}</span>
                      {can("daily_close", "create") && isToday && (
                        <button
                          className={`btn btn-primary ms-auto ${big ? "min-h-[52px] px-6 text-lg" : ""}`}
                          disabled={busy}
                          onClick={() => run(() => post("/money/handover", { boxId: r.id }), tr("تم استلام النقد", "Cash received"))}
                        >
                          {tr("استلمت المبلغ", "Cash received")}
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </section>

          {/* step 2: count */}
          <section className="card">
            <h2 className={`mb-1 font-bold ${big ? "text-xl" : "text-lg"}`}>2 · {tr("عدّ الصندوق", "Count the cash box")}</h2>
            <p className="mb-3 text-sm text-muted">
              {pick(box)} — {tr("عدّ كل النقد الموجود واكتب المجموع.", "Count all the cash in it and type the total.")}
            </p>
            <div className="grid items-end gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="label">{tr("المعدود", "Counted")}</span>
                <input
                  className={`input num ltr ${big ? "py-4 text-3xl" : "text-xl"}`}
                  inputMode="decimal"
                  dir="ltr"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  placeholder="0"
                  aria-label={tr("المعدود", "Counted")}
                />
              </label>
              <div>
                <div className="text-sm text-muted">{tr("المتوقع بالنظام", "Expected by the system")}</div>
                <div className="num ltr text-2xl font-bold text-start">{money(box.expected, box.currency, lang)}</div>
              </div>
              <div>
                <div className="text-sm text-muted">{tr("الفرق", "Difference")}</div>
                <div className={`num ltr text-2xl font-bold text-start ${diff === null ? "text-faint" : Math.abs(diff) < 0.005 ? "text-good" : diff < 0 ? "text-bad" : "text-warn"}`}>
                  {diff === null ? "—" : `${diff > 0 ? "+" : ""}${money(diff, box.currency, lang)}`}
                </div>
                {diff !== null && Math.abs(diff) >= 0.005 && <div className="text-xs text-muted">{diff < 0 ? tr("ناقص من الصندوق", "Short") : tr("زيادة بالصندوق", "Over")}</div>}
              </div>
            </div>
          </section>

          {/* step 3: close */}
          <section className="card">
            <h2 className={`mb-2 font-bold ${big ? "text-xl" : "text-lg"}`}>3 · {tr("اقفل اليوم", "Lock the day")}</h2>
            <p className="mb-3 text-sm text-muted">
              {tr("بعد الإقفال ما بينفع تسجيل طلبات أو حركات لهذا اليوم إلا إذا فتحه المدير.", "After closing, no orders or moves can be added for this day unless the admin reopens it.")}
            </p>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={tr("الطلبات", "Orders")} value={String(d.report.orders)} />
              <Stat label={tr("القطع", "Items")} value={qty(d.report.items)} />
              <Stat label={tr("المبيعات", "Sales")} value={usd(d.report.salesUsd)} />
              <Stat label={tr("الخصومات", "Discounts")} value={usd(d.report.discountUsd)} />
            </div>
            {can("daily_close", "create") ? (
              <button className={`btn btn-primary w-full ${big ? "min-h-[64px] text-xl" : "py-3 text-lg"}`} disabled={busy || counted === "" || Number.isNaN(c) || c < 0} onClick={() => setConfirm("close")}>
                {tr("اقفل اليوم", "Close the day")}
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
                        <span className={`num ltr ${Math.abs(h.totals.cash.difference) < 0.005 ? "" : h.totals.cash.difference < 0 ? "text-bad" : "text-warn"}`}>{money(h.totals.cash.difference, h.totals.cash.currency, lang)}</span>
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
            void run(() => post(`/days/${date}/close`, { counted: c }), tr("تم إقفال اليوم", "Day closed")).then(() => setCounted(""));
          }}
        />
      )}
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
