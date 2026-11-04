import { useState, type ReactNode } from "react";
import { money, MOVE_LABEL, usd, type Currency } from "../lib/format";
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

type Section = "boxes" | "clients" | "goods" | "suppliers" | "expenses";

interface Detail {
  id: string;
  who: string | null;
  kind: string;
  number: number | null;
  note: string;
  at: string | null;
  amount: number;
  currency: Currency;
  nameAr?: string | null;
  nameEn?: string | null;
  by?: string | null;
}

const KIND_LABEL: Record<string, { ar: string; en: string }> = {
  ...MOVE_LABEL,
  order_cancel: { ar: "إلغاء طلب", en: "Cancelled order" },
  charge: { ar: "فاتورة", en: "Invoice" },
  subscription: { ar: "اشتراك", en: "Subscription" },
  adjust: { ar: "تعديل", en: "Adjustment" },
  return: { ar: "مرتجع", en: "Return" },
  consignment: { ar: "أمانة", en: "Consignment" },
};

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

function Line({ sign, label, value, tone, open, onToggle }: { sign: "+" | "−"; label: ReactNode; value: number; tone?: "bad"; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-baseline justify-between gap-3 border-b border-line py-2 text-start hover:text-brand">
      <span className="min-w-0">
        <span className={`me-2 inline-block w-3 font-bold ${sign === "+" ? "text-good" : "text-bad"}`}>{sign}</span>
        {label}
      </span>
      <span className="flex items-center gap-2">
        <span className={`num ltr whitespace-nowrap ${tone === "bad" ? "text-bad" : ""}`}>{usd(value)}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 self-center text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </button>
  );
}

function Details({ section }: { section: Section }) {
  const { tr, pick, lang, err, fmtDate } = useI18n();
  const { data, error } = useData<{ rows: Detail[]; total: number }>(`/reports/my-money/details/${section}`);
  if (error) return <p className="py-2 text-sm text-bad">{err(error)}</p>;
  if (!data) return <Spinner />;
  if (!data.rows.length) return <p className="border-b border-line py-3 text-center text-sm text-muted">{tr("ما في شي هون", "Nothing here")}</p>;
  const signed = section === "boxes";
  return (
    <div className="border-b border-line">
      <ul className="max-h-72 overflow-y-auto ps-5">
        {data.rows.map((d) => {
          const kind = tr(KIND_LABEL[d.kind]?.ar ?? d.kind, KIND_LABEL[d.kind]?.en ?? d.kind);
          const place = d.nameAr && d.nameEn ? tr(d.nameAr, d.nameEn) : null;
          // Expenses without a named person go by their category; a sale without a client is a walk-in.
          const title = d.who ?? (section === "expenses" ? (place ?? kind) : tr("زبون عابر", "Walk-in"));
          return (
            <li key={d.id} className="border-b border-line py-2 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words font-medium">{title}</span>
                <span className={`num ltr whitespace-nowrap text-sm ${signed ? (d.amount < 0 ? "text-bad" : "text-good") : ""}`}>
                  {signed && d.amount > 0 ? "+" : ""}
                  {money(d.amount, d.currency, lang)}
                </span>
              </div>
              <div className="break-words text-xs text-muted">{[kind, d.number ? `#${d.number}` : "", place !== title ? place : "", d.note].filter(Boolean).join(" · ")}</div>
              <div className="text-xs text-faint num">{[d.at ? fmtDate(d.at, true) : "", d.by && d.by !== title ? tr(`سجّلها ${d.by}`, `by ${d.by}`) : ""].filter(Boolean).join(" · ")}</div>
            </li>
          );
        })}
      </ul>
      {data.total > data.rows.length && <p className="py-2 text-center text-xs text-muted num">{tr(`آخر ${data.rows.length} حركة من أصل ${data.total}`, `Latest ${data.rows.length} of ${data.total} moves`)}</p>}
    </div>
  );
}

function MoneyCloudDialog({ onClose }: { onClose: () => void }) {
  const { tr, pick, lang, err } = useI18n();
  const { data, error } = useData<MyMoney>("/reports/my-money");
  const [opened, setOpened] = useState<Section | null>(null);
  const line = (section: Section) => ({ open: opened === section, onToggle: () => setOpened(opened === section ? null : section) });
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

          <Line sign="+" label={tr("بالصناديق", "In the boxes")} value={data.cashUsd} {...line("boxes")} />
          {data.boxes.map((b) => (
            <div key={b.id} className="flex justify-between gap-3 ps-5 text-sm text-muted">
              <span>{pick(b)}</span>
              <span className="num ltr">{money(b.balance, b.currency, lang)}</span>
            </div>
          ))}
          {opened === "boxes" && <Details section="boxes" />}
          <Line sign="+" label={tr("ديون على الزبائن", "Clients owe you")} value={data.clientsOweUsd} {...line("clients")} />
          {opened === "clients" && <Details section="clients" />}
          <Line sign="+" label={tr("بضاعة بالمحلات (أمانة)", "Goods at shops (consignment)")} value={data.goodsAtShopsUsd} {...line("goods")} />
          {opened === "goods" && <Details section="goods" />}
          <Line sign="−" label={tr("علينا للموردين", "We owe suppliers")} value={data.weOweUsd} tone={data.weOweUsd > 0 ? "bad" : undefined} {...line("suppliers")} />
          {opened === "suppliers" && <Details section="suppliers" />}
          <Line sign="−" label={tr("مصاريف لسا ما اندفعت", "Expenses not paid yet")} value={data.dueExpensesUsd} tone={data.dueExpensesUsd > 0 ? "bad" : undefined} {...line("expenses")} />
          {opened === "expenses" && <Details section="expenses" />}
        </div>
      )}
    </Modal>
  );
}
