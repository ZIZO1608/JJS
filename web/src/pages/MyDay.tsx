import { useEffect, useState, type ReactNode } from "react";
import { Empty, Modal, PageHeader, Spinner, TextInput } from "../components/ui";
import { addDaysTo, money, pct, qty, today, UNIT_LABEL, usd, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useData } from "../lib/useData";

interface Day {
  date: string;
  rate: number | null;
  profit: { usd: number; salesUsd: number; costUsd: number; marginPct: number } | null;
  net: { usd: number; expensesUsd: number; wasteUsd: number } | null;
  made: { total: number; sold: number; orders: number; rows: { productId: string; nameAr: string; nameEn: string; made: number; sold: number }[] };
  used: { usd: number | null; count: number; rows: { itemId: string; nameAr: string; nameEn: string; unitCode: string; qty: number; usd?: number }[] };
  boxes: { totalUsd: number; rows: { id: string; systemKey: string; nameAr: string; nameEn: string; currency: Currency; in: number; out: number; balance: number; balanceUsd: number }[] };
  hiddenCosts?: boolean;
}

type BoxKey = "profit" | "net" | "made" | "used" | "cash";

/** Counts up from 0 to the value once it loads; instant when the user prefers less motion. */
function useCountUp(target: number) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(target);
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

const PATHS: Record<BoxKey, string> = {
  profit: "M3 17l6-6 4 4 8-8M15 7h6v6",
  net: "M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5s2 2.8 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3",
  made: "M3 11h18M4 11a8 5 0 0 1 16 0M4 15h16l-1 3a2 2 0 0 1-2 1.5H7A2 2 0 0 1 5 18z",
  used: "M5 2.5h14v19H5zM5 10h14M8.5 6v1.5M8.5 13v2.5",
  cash: "M3 7h18v12H3zM3 7l2-3h14l2 3M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
};

function BoxIcon({ k }: { k: BoxKey }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d={PATHS[k]} />
    </svg>
  );
}

function DayBox({
  k,
  n,
  label,
  value,
  sub,
  tone,
  big,
  onOpen,
}: {
  k: BoxKey;
  n: number;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "good" | "bad";
  big?: boolean;
  onOpen?: () => void;
}) {
  const { tr } = useI18n();
  const ring = tone === "good" ? "bg-good/10 text-good" : tone === "bad" ? "bg-bad/10 text-bad" : "bg-brand/10 text-brand";
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      style={{ animationDelay: `${n * 60}ms` }}
      className="day-box card group relative min-w-0 overflow-hidden text-start transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-lg disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:shadow-none"
    >
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ring}`}>
          <BoxIcon k={k} />
        </span>
        <span className="min-w-0 truncate font-semibold">{label}</span>
        <span className="ms-auto text-xs text-faint num">{n}</span>
      </div>
      <div className={`mt-4 truncate font-bold num ltr text-start ${big ? "text-4xl" : "text-3xl"} ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""}`}>{value}</div>
      {sub && <div className="mt-1.5 text-sm text-muted">{sub}</div>}
      {onOpen && <div className="mt-3 text-xs font-semibold text-brand opacity-70 transition-opacity group-hover:opacity-100">{tr("التفاصيل", "Details")}</div>}
    </button>
  );
}

function Locked() {
  const { tr } = useI18n();
  return <span className="text-xl text-faint">🔒 {tr("للمدير فقط", "Owner only")}</span>;
}

/** The day in five boxes. Click a box for the details. */
export function MyDayPage() {
  const { tr, pick, lang, fmtDate, err } = useI18n();
  const [date, setDate] = useState(today());
  const [open, setOpen] = useState<BoxKey | null>(null);
  const { data, error } = useData<Day>(`/reports/day?date=${date}`);

  const profit = useCountUp(data?.profit?.usd ?? 0);
  const net = useCountUp(data?.net?.usd ?? 0);
  const made = useCountUp(data?.made.total ?? 0);
  const used = useCountUp(data?.used.usd ?? data?.used.count ?? 0);
  const cash = useCountUp(data?.boxes.totalUsd ?? 0);

  const isToday = date === today();
  const syp = (v: number) => (data?.rate ? money(v * data.rate, "SYP", lang) : null);
  const unit = (u: string) => pick(UNIT_LABEL[u] ?? { ar: u, en: u });
  const toneOf = (v: number | undefined) => (v === undefined ? undefined : v < 0 ? "bad" : v > 0 ? "good" : undefined);

  return (
    <div>
      <PageHeader
        title={tr("يومي", "My day")}
        subtitle={isToday ? tr("كل شي صار اليوم، بخمس مربعات", "Everything that happened today, in five boxes") : fmtDate(`${date}T12:00:00`)}
        actions={
          <div className="flex items-center gap-1.5">
            <button className="btn px-3" onClick={() => setDate(addDaysTo(date, -1))} aria-label={tr("اليوم السابق", "Previous day")}>
              <span className="rtl:hidden">‹</span>
              <span className="ltr:hidden">›</span>
            </button>
            <div className="w-52">
              <TextInput type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={tr("التاريخ", "Date")} />
            </div>
            <button className="btn px-3" onClick={() => setDate(addDaysTo(date, 1))} disabled={isToday} aria-label={tr("اليوم التالي", "Next day")}>
              <span className="rtl:hidden">›</span>
              <span className="ltr:hidden">‹</span>
            </button>
            {!isToday && (
              <button className="btn" onClick={() => setDate(today())}>
                {tr("اليوم", "Today")}
              </button>
            )}
          </div>
        }
      />

      {error ? (
        <p className="text-bad">{err(error)}</p>
      ) : !data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <DayBox
              k="profit"
              n={1}
              big
              label={tr("الربح", "Profit")}
              tone={toneOf(data.profit?.usd)}
              value={data.profit ? usd(profit) : <Locked />}
              sub={data.profit ? `${tr("هامش", "Margin")} ${pct(data.profit.marginPct)}${syp(data.profit.usd) ? ` · ${syp(data.profit.usd)}` : ""}` : undefined}
              onOpen={data.profit ? () => setOpen("profit") : undefined}
            />
            <DayBox
              k="net"
              n={2}
              big
              label={tr("الصافي", "Net")}
              tone={toneOf(data.net?.usd)}
              value={data.net ? usd(net) : <Locked />}
              sub={data.net ? `${tr("بعد المصاريف والهدر", "After expenses & waste")}${syp(data.net.usd) ? ` · ${syp(data.net.usd)}` : ""}` : undefined}
              onOpen={data.net ? () => setOpen("net") : undefined}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DayBox
              k="made"
              n={3}
              label={tr("شو عملنا", "What we made")}
              value={qty(Math.round(made))}
              sub={tr(`انباع ${qty(data.made.sold)} قطعة · ${data.made.orders} طلب`, `${qty(data.made.sold)} sold · ${data.made.orders} orders`)}
              onOpen={() => setOpen("made")}
            />
            <DayBox
              k="used"
              n={4}
              label={tr("طلع من المستودع", "Used from warehouse")}
              value={data.used.usd !== null ? usd(used) : tr(`${Math.round(used)} مادة`, `${Math.round(used)} items`)}
              sub={data.used.usd !== null ? tr(`${data.used.count} مادة`, `${data.used.count} items`) : undefined}
              onOpen={() => setOpen("used")}
            />
            <DayBox
              k="cash"
              n={5}
              label={tr("الصندوق", "Cash box")}
              value={usd(cash)}
              sub={data.boxes.rows.map((b) => `${pick(b)} ${money(b.balance, b.currency, lang)}`).join(" · ")}
              onOpen={() => setOpen("cash")}
            />
          </div>

          {open && <Details k={open} data={data} unit={unit} onClose={() => setOpen(null)} />}
        </>
      )}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: "bad" | "good" }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0 ${strong ? "font-bold" : ""}`}>
      <span className="min-w-0">{label}</span>
      <span className={`num ltr whitespace-nowrap ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""}`}>{value}</span>
    </div>
  );
}

function Details({ k, data, unit, onClose }: { k: BoxKey; data: Day; unit: (u: string) => string; onClose: () => void }) {
  const { tr, pick, lang } = useI18n();
  const titles: Record<BoxKey, string> = {
    profit: tr("الربح", "Profit"),
    net: tr("الصافي", "Net"),
    made: tr("شو عملنا", "What we made"),
    used: tr("طلع من المستودع", "Used from warehouse"),
    cash: tr("الصندوق", "Cash box"),
  };
  return (
    <Modal
      title={titles[k]}
      onClose={onClose}
      wide={k === "made" || k === "used"}
      footer={
        <button className="btn" onClick={onClose}>
          {tr("إغلاق", "Close")}
        </button>
      }
    >
      {k === "profit" && data.profit && (
        <div>
          <Row label={tr("المبيعات", "Sales")} value={usd(data.profit.salesUsd)} />
          <Row label={`− ${tr("تكلفة البضاعة", "Cost of goods")}`} value={usd(data.profit.costUsd)} />
          <Row label={tr("الربح", "Profit")} value={usd(data.profit.usd)} strong tone={data.profit.usd < 0 ? "bad" : "good"} />
        </div>
      )}
      {k === "net" && data.net && data.profit && (
        <div>
          <Row label={tr("الربح", "Profit")} value={usd(data.profit.usd)} />
          <Row label={`− ${tr("المصاريف", "Expenses")}`} value={usd(data.net.expensesUsd)} />
          <Row label={`− ${tr("الهدر", "Waste")}`} value={usd(data.net.wasteUsd)} />
          <Row label={tr("الصافي", "Net")} value={usd(data.net.usd)} strong tone={data.net.usd < 0 ? "bad" : "good"} />
          <p className="mt-3 text-xs text-faint">{tr("الرواتب والاستهلاك شهرية — بتلاقيها بالتقارير.", "Salaries and depreciation are monthly — see Reports.")}</p>
        </div>
      )}
      {k === "made" &&
        (data.made.rows.length ? (
          <div>
            <Row label={<span className="text-muted">{tr("المنتج", "Product")}</span>} value={<span className="text-muted">{tr("انعمل / انباع", "Made / sold")}</span>} />
            {data.made.rows.map((r) => (
              <Row key={r.productId} label={pick(r)} value={`${qty(r.made)} / ${qty(r.sold)}`} />
            ))}
            <Row label={tr("المجموع", "Total")} value={`${qty(data.made.total)} / ${qty(data.made.sold)}`} strong />
          </div>
        ) : (
          <Empty text={tr("ما انعمل شي بهاليوم", "Nothing was made this day")} />
        ))}
      {k === "used" &&
        (data.used.rows.length ? (
          <div>
            {data.used.rows.map((r) => (
              <Row
                key={r.itemId}
                label={pick(r)}
                value={
                  <>
                    {qty(r.qty)} {unit(r.unitCode)}
                    {r.usd !== undefined && <span className="ms-3 text-muted">{usd(r.usd)}</span>}
                  </>
                }
              />
            ))}
            {data.used.usd !== null && <Row label={tr("المجموع", "Total")} value={usd(data.used.usd)} strong />}
          </div>
        ) : (
          <Empty text={tr("ما طلع شي من المستودع", "Nothing left the warehouse")} />
        ))}
      {k === "cash" && (
        <div className="grid gap-4">
          {data.boxes.rows.map((b) => (
            <div key={b.id} className="rounded-xl bg-sunken p-3">
              <div className="mb-1 font-semibold">{pick(b)}</div>
              <Row label={`+ ${tr("دخل", "In")}`} value={money(b.in, b.currency, lang)} tone="good" />
              <Row label={`− ${tr("طلع", "Out")}`} value={money(b.out, b.currency, lang)} tone={b.out > 0 ? "bad" : undefined} />
              <Row label={tr("بالصندوق آخر اليوم", "In the box at day end")} value={money(b.balance, b.currency, lang)} strong />
            </div>
          ))}
          <Row label={tr("المجموع بالدولار", "Total in USD")} value={usd(data.boxes.totalUsd)} strong />
        </div>
      )}
    </Modal>
  );
}
