import { useState } from "react";
import { Link } from "react-router-dom";
import { Field, Modal, Select, TextInput } from "../../components/ui";
import { post } from "../../lib/api";
import { useAppSettings } from "../../lib/appSettings";
import { money, num, pct, usd } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import type { CashBox } from "../../lib/types";

export interface Five {
  date: string;
  rate: number | null;
  sold: { items: number; orders: number; salesUsd: number };
  cost: { goodsUsd: number; wasteUsd: number };
  profit: { grossUsd: number; afterExpensesUsd: number; expensesUsd: number };
  money: { cashUsd: number; collectedTodayUsd: number; clientsOweUsd: number; weOweUsd: number; goodsAtShopsUsd: number };
  prices: { ok: boolean; targetMarginPct: number; below: { productId: string; nameAr: string; nameEn: string; marginPct: number | null }[] };
}

/**
 * JJ's own end-of-day test: the system must answer five questions.
 * Amounts are kept in USD in the books; with SYP as the main currency they are shown in SYP at today's rate.
 */
export function FiveAnswers({ data }: { data: Five }) {
  const { tr, pick, lang } = useI18n();
  const { s } = useAppSettings();
  const main = s?.defaultCurrency ?? "USD";
  const show = (v: number) => (main === "SYP" && data.rate ? money(v * data.rate, "SYP", lang) : usd(v));
  const q = [
    { n: 1, ar: "كم بعت فعلياً؟", en: "How much did I really sell?", v: show(data.sold.salesUsd), sub: tr(`${data.sold.items} قطعة · ${data.sold.orders} فاتورة`, `${data.sold.items} pieces · ${data.sold.orders} invoices`) },
    { n: 2, ar: "كم كلّفتني البضاعة اللي بعتها؟", en: "What did the goods I sold cost me?", v: show(data.cost.goodsUsd), sub: data.cost.wasteUsd > 0 ? tr(`+ هدر ${show(data.cost.wasteUsd)}`, `+ waste ${show(data.cost.wasteUsd)}`) : "" },
    { n: 3, ar: "كم ربحت بعد كل المصاريف؟", en: "What did I earn after all expenses?", v: show(data.profit.afterExpensesUsd), sub: tr(`الربح الإجمالي ${show(data.profit.grossUsd)}`, `Gross profit ${show(data.profit.grossUsd)}`), bad: data.profit.afterExpensesUsd < 0 },
    {
      n: 4,
      ar: "كم معي كاش، وكم إلي ديون عند المحلات؟",
      en: "How much cash do I have, and what do shops owe me?",
      v: show(data.money.cashUsd),
      sub: tr(`المحلات عليها ${show(data.money.clientsOweUsd)} · علينا للموردين ${show(data.money.weOweUsd)}${data.money.goodsAtShopsUsd ? ` · بضاعة بالأمانة ${show(data.money.goodsAtShopsUsd)}` : ""}`, `Shops owe ${show(data.money.clientsOweUsd)} · we owe suppliers ${show(data.money.weOweUsd)}${data.money.goodsAtShopsUsd ? ` · on consignment ${show(data.money.goodsAtShopsUsd)}` : ""}`),
    },
    {
      n: 5,
      ar: "هل أسعار البيع لسا مربحة؟",
      en: "Are my prices still profitable?",
      v: data.prices.ok ? tr("نعم", "Yes") : tr(`${data.prices.below.length} صنف تحت الهدف`, `${data.prices.below.length} below target`),
      sub: data.prices.ok ? tr(`كل الأصناف فوق ${data.prices.targetMarginPct}%`, `Every product is above ${data.prices.targetMarginPct}%`) : data.prices.below.slice(0, 3).map((b) => `${pick(b)} ${pct(b.marginPct)}`).join("، "),
      bad: !data.prices.ok,
    },
  ];
  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{tr("يومك بخمس أجوبة", "Your day in five answers")}</h2>
        <div className="flex gap-2">
          {!data.prices.ok && (
            <Link to="/costing/products" className="btn btn-ghost px-3 py-1 text-sm">
              {tr("شوف الأسعار", "Check prices")}
            </Link>
          )}
          <a className="btn px-3 py-1 text-sm" href={`https://wa.me/?text=${encodeURIComponent(fiveText(data, tr, pick, show))}`} target="_blank" rel="noreferrer">
            {tr("ابعتها واتساب", "Send on WhatsApp")}
          </a>
        </div>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {q.map((x) => (
          <li key={x.n} className="rounded-xl bg-sunken p-3">
            <div className="text-xs text-muted">
              <span className="num">{x.n}.</span> {tr(x.ar, x.en)}
            </div>
            <div className={`mt-1 text-xl font-bold num ltr text-start ${x.bad ? "text-bad" : ""}`}>{x.v}</div>
            {x.sub && <div className="mt-0.5 text-xs text-faint">{x.sub}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function fiveText(d: Five, tr: (a: string, e: string) => string, pick: (o: { nameAr: string; nameEn: string }) => string, show: (v: number) => string) {
  return [
    tr(`JJ's · ملخص ${d.date}`, `JJ's · summary ${d.date}`),
    tr(`1) بعنا: ${show(d.sold.salesUsd)} (${d.sold.items} قطعة)`, `1) Sold: ${show(d.sold.salesUsd)} (${d.sold.items} pcs)`),
    tr(`2) تكلفة البضاعة: ${show(d.cost.goodsUsd)}`, `2) Goods cost: ${show(d.cost.goodsUsd)}`),
    tr(`3) الربح بعد المصاريف: ${show(d.profit.afterExpensesUsd)}`, `3) Profit after expenses: ${show(d.profit.afterExpensesUsd)}`),
    tr(`4) الكاش: ${show(d.money.cashUsd)} · ديون المحلات: ${show(d.money.clientsOweUsd)} · علينا: ${show(d.money.weOweUsd)}`, `4) Cash: ${show(d.money.cashUsd)} · shops owe: ${show(d.money.clientsOweUsd)} · we owe: ${show(d.money.weOweUsd)}`),
    d.prices.ok ? tr("5) الأسعار مربحة ✓", "5) Prices are profitable ✓") : tr(`5) تحت الهدف: ${d.prices.below.map((b) => pick(b)).join("، ")}`, `5) Below target: ${d.prices.below.map((b) => pick(b)).join(", ")}`),
  ].join("\n");
}

/** Loads and shows the five answers (for Home / daily close). */
export function FiveAnswersCard({ date }: { date?: string }) {
  const d = useData<Five>(`/reports/five${date ? `?date=${date}` : ""}`);
  if (!d.data) return null;
  return <FiveAnswers data={d.data} />;
}

/** The owner takes money out of a box for personal use (kept apart from expenses). */
export function WithdrawDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { tr, pick, err } = useI18n();
  const toast = useToast();
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  const [box, setBox] = useState("");
  const [amount, setAmount] = useState("");
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const b = boxes.data?.rows.find((x) => x.id === box);
  const save = async () => {
    try {
      await post("/money/withdraw", { boxId: box, amount: num(amount), person, note });
      toast(tr("تم تسجيل السحب", "Withdrawal saved"));
      onDone();
    } catch (e) {
      toast(err(e), "error");
    }
  };
  return (
    <Modal
      title={tr("سحب شخصي من الصندوق", "Personal withdrawal")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" disabled={!box || !(num(amount) > 0)} onClick={save}>
            {tr("تسجيل", "Save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm text-muted">{tr("السحوبات الشخصية مو مصاريف: بتنقص الصندوق بس ما بتأثر على ربح المحل، وإلها تقرير لحالها.", "Personal withdrawals are not expenses: they lower the box but not the shop's profit, and have their own report.")}</p>
        <Field label={tr("من صندوق", "From box")} htmlFor="wd-b">
          <Select id="wd-b" value={box} onChange={(e) => setBox(e.target.value)}>
            <option value="">—</option>
            {boxes.data?.rows
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {pick(x)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={tr(`المبلغ${b ? ` (${b.currency})` : ""}`, `Amount${b ? ` (${b.currency})` : ""}`)} htmlFor="wd-a">
          <TextInput id="wd-a" inputMode="decimal" dir="ltr" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={tr("مين سحب", "Taken by")} htmlFor="wd-p">
          <TextInput id="wd-p" value={person} onChange={(e) => setPerson(e.target.value)} />
        </Field>
        <Field label={tr("ملاحظة", "Note")} htmlFor="wd-n">
          <TextInput id="wd-n" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
