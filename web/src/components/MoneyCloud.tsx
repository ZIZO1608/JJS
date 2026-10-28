import { useState, type ReactNode } from "react";
import { money, usd, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useData } from "../lib/useData";
import { Modal, Spinner } from "./ui";

interface MyMoney {
  rate: number | null;
  boxes: { id: string; kind: string; nameAr: string; nameEn: string; currency: Currency; balance: number; usd: number }[];
  cashUsd: number;
  clientsOweUsd: number;
  goodsAtShopsUsd: number;
  weOweUsd: number;
  dueExpensesUsd: number;
  totalUsd: number;
}

const CLOUD = "M7 18h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.4 10.1 4 4 0 0 0 7 18z";

export function CloudIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={CLOUD} />
      <path d="M12 11v4M10.5 12.5 12 11l1.5 1.5" />
    </svg>
  );
}

/** Admin-only cloud in the top bar: all the money that is the owner's. */
export function MoneyCloud() {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-ghost cloud-btn px-2.5 py-1.5 text-brand" onClick={() => setOpen(true)} aria-label={tr("كل مالي", "All my money")} title={tr("كل مالي", "All my money")}>
        <CloudIcon className="h-6 w-6" />
      </button>
      {open && <MoneyCloudDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function Line({ sign, label, value, tone }: { sign: "+" | "−"; label: ReactNode; value: number; tone?: "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <span className="min-w-0">
        <span className={`me-2 inline-block w-3 font-bold ${sign === "+" ? "text-good" : "text-bad"}`}>{sign}</span>
        {label}
      </span>
      <span className={`num ltr whitespace-nowrap ${tone === "bad" ? "text-bad" : ""}`}>{usd(value)}</span>
    </div>
  );
}

function MoneyCloudDialog({ onClose }: { onClose: () => void }) {
  const { tr, pick, lang, err } = useI18n();
  const { data, error } = useData<MyMoney>("/reports/my-money");
  return (
    <Modal
      title={tr("كل مالي", "All my money")}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {tr("إغلاق", "Close")}
        </button>
      }
    >
      {error ? (
        <p className="text-bad">{err(error)}</p>
      ) : !data ? (
        <Spinner />
      ) : (
        <div>
          <div className="mb-4 rounded-2xl bg-gradient-to-br from-brand/15 to-brand/5 p-5 text-center">
            <CloudIcon className="cloud-float mx-auto mb-1 h-10 w-10 text-brand" />
            <div className="text-sm text-muted">{tr("هاد كلو إلك", "All of this is yours")}</div>
            <div className={`mt-1 text-4xl font-bold num ltr ${data.totalUsd < 0 ? "text-bad" : ""}`}>{usd(data.totalUsd)}</div>
            {data.rate ? <div className="mt-1 text-sm text-muted num">{money(data.totalUsd * data.rate, "SYP", lang)}</div> : null}
          </div>

          <Line sign="+" label={tr("بالصناديق", "In the boxes")} value={data.cashUsd} />
          {data.boxes.map((b) => (
            <div key={b.id} className="flex justify-between gap-3 ps-5 text-sm text-muted">
              <span>{pick(b)}</span>
              <span className="num ltr">{money(b.balance, b.currency, lang)}</span>
            </div>
          ))}
          <Line sign="+" label={tr("ديون على الزبائن", "Clients owe you")} value={data.clientsOweUsd} />
          <Line sign="+" label={tr("بضاعة بالمحلات (أمانة)", "Goods at shops (consignment)")} value={data.goodsAtShopsUsd} />
          <Line sign="−" label={tr("علينا للموردين", "We owe suppliers")} value={data.weOweUsd} tone={data.weOweUsd > 0 ? "bad" : undefined} />
          <Line sign="−" label={tr("مصاريف لسا ما اندفعت", "Expenses not paid yet")} value={data.dueExpensesUsd} tone={data.dueExpensesUsd > 0 ? "bad" : undefined} />
        </div>
      )}
    </Modal>
  );
}
