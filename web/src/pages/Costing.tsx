import { Fragment, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Tabs } from "../components/Tabs";
import { Empty, Field, PageHeader, Spinner, TextInput } from "../components/ui";
import { put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { addDaysTo, money, num, pct, qty as fq, thisMonth, today, usd, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { useData } from "../lib/useData";
import type { StockItem } from "../lib/types";
import { CurrencySelect, NumInput, unitOf } from "./kit";

interface CostLine {
  itemId: string;
  nameAr: string;
  nameEn: string;
  kind: string;
  unitCode: string;
  cleanQty: number;
  wastePct: number;
  qty: number;
  unitCostUsd: number;
  costUsd: number;
}
interface CostRow {
  id: string;
  nameAr: string;
  nameEn: string;
  category: { nameAr: string; nameEn: string };
  price: number;
  currency: Currency;
  priceUsd: number | null;
  costUsd: number;
  packagingUsd: number;
  profitUsd: number | null;
  marginPct: number | null;
  hasRecipe: boolean;
  lines: CostLine[];
  extraUsd: number;
  cost50Usd: number;
  cost100Usd: number;
  targetPrice: number | null;
  belowTarget: boolean;
}

/* ---------- products ---------- */
function ProductsTab() {
  const { tr, pick, lang } = useI18n();
  const d = useData<{ rows: CostRow[]; targetMarginPct: number }>("/costing/products");
  const [open, setOpen] = useState<string | null>(null);
  if (!d.data) return <Spinner />;
  const below = d.data.rows.filter((r) => r.belowTarget).length;
  return (
    <div>
      <p className="mb-3 text-muted">
        {tr(`التكلفة = المواد مع نسبة الهدر + التغليف + أي تكلفة مباشرة إضافية. الهامش المستهدف ${d.data.targetMarginPct}%.`, `Cost = ingredients with their waste % + packaging + any extra direct cost. Target margin ${d.data.targetMarginPct}%.`)}
        {below > 0 && <span className="ms-2 font-semibold text-bad">{tr(`${below} صنف تحت الهدف`, `${below} below target`)}</span>}
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">{tr("الصنف", "Product")}</th>
              <th className="th text-end">{tr("السعر", "Price")}</th>
              <th className="th text-end">{tr("التكلفة", "Cost")}</th>
              <th className="th text-end">{tr("منها تغليف", "Packaging")}</th>
              <th className="th text-end">{tr("الربح", "Profit")}</th>
              <th className="th text-end">{tr("الهامش", "Margin")}</th>
              <th className="th text-end">{tr("السعر للهدف", "Price for target")}</th>
              <th className="th text-end">{tr("50 / 100 قطعة", "50 / 100 pcs")}</th>
            </tr>
          </thead>
          <tbody>
            {d.data.rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="cursor-pointer hover:bg-sunken" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="td">
                    <div className="font-semibold">{pick(r)}</div>
                    <div className="text-xs text-faint">{pick(r.category)}</div>
                  </td>
                  <td className="td text-end num ltr">{money(r.price, r.currency, lang)}</td>
                  <td className="td text-end num ltr">{r.hasRecipe ? usd(r.costUsd) : <span className="text-warn">{tr("بلا وصفة", "No recipe")}</span>}</td>
                  <td className="td text-end num ltr text-muted">{usd(r.packagingUsd)}</td>
                  <td className="td text-end num ltr">{r.profitUsd === null ? "—" : usd(r.profitUsd)}</td>
                  <td className={`td text-end num ltr font-semibold ${r.belowTarget ? "text-bad" : ""}`}>{pct(r.marginPct)}</td>
                  <td className={`td text-end num ltr ${r.belowTarget ? "font-semibold" : "text-muted"}`}>{r.targetPrice === null ? "—" : money(r.targetPrice, r.currency, lang)}</td>
                  <td className="td text-end num ltr text-muted">
                    {usd(r.cost50Usd)} / {usd(r.cost100Usd)}
                  </td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={8} className="td bg-sunken">
                      {r.lines.length === 0 ? (
                        <span className="text-faint">{tr("ما في وصفة. زيدها من القائمة.", "No recipe. Add it from the Menu.")}</span>
                      ) : (
                        <table className="w-full text-xs">
                          <tbody>
                            {r.lines.map((l) => (
                              <tr key={l.itemId}>
                                <td className="py-1">{pick(l)}</td>
                                <td className="py-1 num ltr">
                                  {fq(l.cleanQty)} {unitOf(l.unitCode, lang)}
                                  {l.wastePct > 0 && ` + ${l.wastePct}% ${tr("هدر", "waste")}`}
                                </td>
                                <td className="py-1 num ltr">× {usd(l.unitCostUsd)}</td>
                                <td className="py-1 text-end num ltr">{usd(l.costUsd)}</td>
                              </tr>
                            ))}
                            {r.extraUsd > 0 && (
                              <tr>
                                <td className="py-1" colSpan={3}>
                                  {tr("تكلفة مباشرة إضافية", "Extra direct cost")}
                                </td>
                                <td className="py-1 text-end num ltr">{usd(r.extraUsd)}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- ingredient prices ---------- */
function IngredientsTab() {
  const { tr, pick, lang, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const items = useData<{ rows: StockItem[] }>("/stock/items");
  const [edit, setEdit] = useState<{ id: string; cost: string; currency: Currency } | null>(null);
  if (!items.data) return <Spinner />;
  const rows = items.data.rows.filter((i) => i.kind !== "product");
  const save = async () => {
    if (!edit) return;
    try {
      await put(`/costing/items/${edit.id}/cost`, { cost: num(edit.cost), currency: edit.currency });
      setEdit(null);
      void items.reload();
    } catch (e) {
      toast(err(e), "error");
    }
  };
  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-muted">{tr("سعر الوحدة بيتحدث لحاله مع كل فاتورة شراء (متوسط مرجّح). عدّله هون بس قبل أول فاتورة.", "The unit cost updates itself with every purchase (weighted average). Edit it here only before the first purchase.")}</p>
      <div className="card p-0">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td className="td font-semibold">{pick(i)}</td>
                <td className="td text-muted">{unitOf(i.unitCode, lang)}</td>
                <td className="td text-end">
                  {edit?.id === i.id ? (
                    <div className="flex justify-end gap-2">
                      <NumInput value={edit.cost} onChange={(v) => setEdit({ ...edit, cost: v })} className="max-w-[8rem]" />
                      <div className="w-28">
                        <CurrencySelect value={edit.currency} onChange={(c) => setEdit({ ...edit, currency: c })} />
                      </div>
                      <button className="btn btn-primary px-3 py-1" onClick={save} disabled={edit.cost === ""}>
                        {tr("حفظ", "Save")}
                      </button>
                    </div>
                  ) : (
                    <span className="num ltr">{usd(i.avgCostUsd)}</span>
                  )}
                </td>
                <td className="td text-end">
                  {can("costing", "edit") && edit?.id !== i.id && (
                    <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setEdit({ id: i.id, cost: String(i.avgCostUsd), currency: "USD" })}>
                      {tr("تعديل", "Edit")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- price changes (impact) ---------- */
interface Impact {
  since: string;
  targetMarginPct: number;
  changes: { id: string; itemId: string; nameAr: string; nameEn: string; unitCode: string; oldCostUsd: number; newCostUsd: number; changePct: number; businessDate: string }[];
  products: { productId: string; nameAr: string; nameEn: string; price: number; currency: Currency; costBeforeUsd: number; costNowUsd: number; marginBefore: number | null; marginNow: number | null; belowTarget: boolean; suggestedPrice: number | null }[];
}
function ImpactTab() {
  const { tr, pick, lang, fmtDate } = useI18n();
  const [days, setDays] = useState("30");
  const d = useData<Impact>(`/costing/impact?days=${Math.max(1, Math.round(num(days) || 30))}`);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={tr("آخر كم يوم", "Last … days")} htmlFor="im-d">
          <NumInput id="im-d" step="1" value={days} onChange={setDays} className="max-w-[7rem]" />
        </Field>
        <p className="max-w-xl text-sm text-muted">{tr("لما يتغيّر سعر مادة بفاتورة شراء، هون بتشوف أي سندويشة تأثرت، وشو السعر اللي بيرجّع الهامش للهدف. الفواتير القديمة ما بتتغيّر.", "When a purchase changes an ingredient's price, see which sandwiches it touched and the price that brings the margin back to target. Old invoices never change.")}</p>
      </div>
      {!d.data ? (
        <Spinner />
      ) : d.data.changes.length === 0 ? (
        <Empty text={tr("ما تغيّر سعر أي مادة بهالفترة.", "No ingredient price changed in this period.")} />
      ) : (
        <>
          <section>
            <h2 className="mb-2 font-bold">{tr("المواد اللي تغيّر سعرها", "Ingredients whose price changed")}</h2>
            <div className="card p-0">
              <table className="w-full text-sm">
                <tbody>
                  {d.data.changes.map((c) => (
                    <tr key={c.id}>
                      <td className="td">{fmtDate(c.businessDate)}</td>
                      <td className="td font-semibold">{pick(c)}</td>
                      <td className="td num ltr text-end">
                        {usd(c.oldCostUsd)} → {usd(c.newCostUsd)} / {unitOf(c.unitCode, lang)}
                      </td>
                      <td className={`td num ltr text-end font-semibold ${c.changePct > 0 ? "text-bad" : "text-good"}`}>
                        {c.changePct > 0 ? "+" : ""}
                        {pct(c.changePct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h2 className="mb-2 font-bold">{tr("الأصناف المتأثرة", "Products affected")}</h2>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">{tr("الصنف", "Product")}</th>
                    <th className="th text-end">{tr("التكلفة قبل → هلّق", "Cost before → now")}</th>
                    <th className="th text-end">{tr("الهامش قبل → هلّق", "Margin before → now")}</th>
                    <th className="th text-end">{tr("سعرك", "Your price")}</th>
                    <th className="th text-end">{tr("السعر المقترح", "Suggested price")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.data.products.map((p) => (
                    <tr key={p.productId}>
                      <td className="td font-semibold">{pick(p)}</td>
                      <td className="td text-end num ltr">
                        {usd(p.costBeforeUsd)} → {usd(p.costNowUsd)}
                      </td>
                      <td className={`td text-end num ltr ${p.belowTarget ? "font-semibold text-bad" : ""}`}>
                        {pct(p.marginBefore)} → {pct(p.marginNow)}
                      </td>
                      <td className="td text-end num ltr">{money(p.price, p.currency, lang)}</td>
                      <td className="td text-end num ltr font-semibold">{p.suggestedPrice === null ? "—" : money(p.suggestedPrice, p.currency, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-faint">{tr(`السعر المقترح بيعطي هامش ${d.data.targetMarginPct}%. غيّر الأسعار من القائمة.`, `The suggested price gives a ${d.data.targetMarginPct}% margin. Change prices in the Menu.`)}</p>
          </section>
        </>
      )}
    </div>
  );
}

/* ---------- overheads & break-even ---------- */
interface Overheads {
  month: string;
  itemsSold: number;
  expensesUsd: number;
  depreciationUsd: number;
  salariesUsd: number;
  fixedUsd: number;
  perItemUsd: number | null;
  grossProfitPerItemUsd: number | null;
  breakEvenItems: number | null;
  itemsLeftToBreakEven: number | null;
  reached: boolean;
}
function OverheadsTab() {
  const { tr } = useI18n();
  const [month, setMonth] = useState(thisMonth());
  const d = useData<Overheads>(`/costing/overheads?month=${month}`);
  const o = d.data;
  const progress = o?.breakEvenItems ? Math.min(100, Math.round((o.itemsSold / o.breakEvenItems) * 100)) : 0;
  return (
    <div className="max-w-3xl">
      <Field label={tr("الشهر", "Month")} htmlFor="oh-m">
        <TextInput id="oh-m" type="month" className="max-w-[12rem]" value={month} onChange={(e) => setMonth(e.target.value)} />
      </Field>
      {!o ? (
        <Spinner />
      ) : (
        <div className="mt-4 grid gap-4">
          <section className="card">
            <h2 className="mb-1 font-bold">{tr("نقطة التعادل", "Break-even")}</h2>
            {o.breakEvenItems === null ? (
              <p className="text-sm text-muted">{tr("بدنا مبيعات بهالشهر لنحسبها.", "Needs some sales this month to work out.")}</p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  {o.reached
                    ? tr("وصلت! كل قطعة زيادة هلّق ربح صافي.", "Reached! Every extra piece is now real profit.")
                    : tr(`باقيلك ${o.itemsLeftToBreakEven} قطعة هالشهر لتغطي كل المصاريف الثابتة.`, `${o.itemsLeftToBreakEven} more pieces this month to cover all fixed costs.`)}
                </p>
                <div className="mt-3 h-4 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`h-full ${o.reached ? "bg-good" : "bg-ink"}`} style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted num ltr">
                  <span>
                    {o.itemsSold} {tr("مباع", "sold")}
                  </span>
                  <span>
                    {o.breakEvenItems} {tr("لازم", "needed")}
                  </span>
                </div>
              </>
            )}
          </section>
          <section className="card">
            <h2 className="mb-2 font-bold">{tr("المصاريف الثابتة لهالشهر", "Fixed costs this month")}</h2>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="td">{tr("المصاريف", "Expenses")}</td>
                  <td className="td text-end num ltr">{usd(o.expensesUsd)}</td>
                </tr>
                <tr>
                  <td className="td">{tr("الرواتب", "Salaries")}</td>
                  <td className="td text-end num ltr">{usd(o.salariesUsd)}</td>
                </tr>
                <tr>
                  <td className="td">{tr("استهلاك الأصول", "Depreciation")}</td>
                  <td className="td text-end num ltr">{usd(o.depreciationUsd)}</td>
                </tr>
                <tr className="font-bold">
                  <td className="td">{tr("المجموع", "Total")}</td>
                  <td className="td text-end num ltr">{usd(o.fixedUsd)}</td>
                </tr>
                <tr>
                  <td className="td">{tr("حصّة كل قطعة مباعة", "Share per piece sold")}</td>
                  <td className="td text-end num ltr">{o.perItemUsd === null ? "—" : usd(o.perItemUsd)}</td>
                </tr>
                <tr>
                  <td className="td">{tr("ربح القطعة قبل المصاريف", "Profit per piece before costs")}</td>
                  <td className="td text-end num ltr">{o.grossProfitPerItemUsd === null ? "—" : usd(o.grossProfitPerItemUsd)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-faint">{tr("التكلفة الحقيقية للقطعة = المواد والتغليف + هالحصّة.", "Real cost per piece = ingredients and packaging + this share.")}</p>
          </section>
        </div>
      )}
    </div>
  );
}

/* ---------- prep list & forecast ---------- */
interface Need {
  itemId: string;
  nameAr: string;
  nameEn: string;
  unitCode: string;
  need: number;
  have: number;
  short: number;
}
function NeedTable({ rows }: { rows: Need[] }) {
  const { tr, pick, lang } = useI18n();
  if (!rows.length) return <p className="text-sm text-faint">{tr("ما في مواد.", "No materials.")}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className="th">{tr("المادة", "Material")}</th>
          <th className="th text-end">{tr("لازم", "Need")}</th>
          <th className="th text-end">{tr("موجود", "Have")}</th>
          <th className="th text-end">{tr("ناقص", "Short")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.itemId} className={m.short > 0 ? "text-bad" : ""}>
            <td className="td">{pick(m)}</td>
            <td className="td text-end num ltr">
              {fq(m.need)} {unitOf(m.unitCode, lang)}
            </td>
            <td className="td text-end num ltr">{fq(m.have)}</td>
            <td className="td text-end num ltr font-semibold">{m.short > 0 ? fq(m.short) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function PrepTab() {
  const { tr, pick } = useI18n();
  const [date, setDate] = useState(addDaysTo(today(), 1));
  const prep = useData<{ date: string; products: { productId: string; nameAr: string; nameEn: string; qty: number }[]; ingredients: Need[] }>(`/costing/prep?date=${date}`);
  const fc = useData<{ date: string; products: { productId: string; nameAr: string; nameEn: string; qty: number }[]; materials: Need[] }>(`/costing/forecast?date=${date}`);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={tr("اليوم", "Day")} htmlFor="pp-d">
          <TextInput id="pp-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Link to="/production/new" className="btn btn-primary">
          {tr("افتح دفعة إنتاج", "Open production run")}
        </Link>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-bold">{tr("قائمة التحضير", "Prep list")}</h2>
          <p className="mb-3 text-sm text-muted">{tr("من الطلبات الثابتة لهاليوم والطلبات المسجّلة.", "From the standing orders for this weekday and the orders already taken.")}</p>
          {!prep.data ? (
            <Spinner />
          ) : prep.data.products.length === 0 ? (
            <Empty text={tr("ما في طلبات لهاليوم.", "No orders for this day.")} />
          ) : (
            <>
              <ul className="mb-3 grid gap-1">
                {prep.data.products.map((p) => (
                  <li key={p.productId} className="flex justify-between border-b border-line py-1">
                    <span>{pick(p)}</span>
                    <b className="num ltr">{p.qty}</b>
                  </li>
                ))}
              </ul>
              <NeedTable rows={prep.data.ingredients} />
            </>
          )}
        </section>
        <section className="card">
          <h2 className="font-bold">{tr("التوقّع", "Forecast")}</h2>
          <p className="mb-3 text-sm text-muted">{tr("متوسط المبيع بنفس اليوم من آخر 4 أسابيع. تقدير، مو رقم أكيد.", "Average sold on the same weekday over the last 4 weeks. An estimate, not a promise.")}</p>
          {!fc.data ? (
            <Spinner />
          ) : fc.data.products.length === 0 ? (
            <Empty text={tr("ما في مبيعات كافية لنتوقّع.", "Not enough sales to forecast.")} />
          ) : (
            <>
              <ul className="mb-3 grid gap-1">
                {fc.data.products.map((p) => (
                  <li key={p.productId} className="flex justify-between border-b border-line py-1">
                    <span>{pick(p)}</span>
                    <b className="num ltr">~{p.qty}</b>
                  </li>
                ))}
              </ul>
              <NeedTable rows={fc.data.materials} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function CostingPage() {
  const { tr } = useI18n();
  return (
    <>
      <PageHeader title={tr("التكاليف", "Costing")} subtitle={tr("كم بتكلّف كل سندويشة، وهل الأسعار لسا مربحة.", "What every sandwich costs, and whether the prices still pay.")} />
      <Tabs
        base="/costing"
        tabs={[
          { key: "products", label: tr("تكلفة الأصناف", "Product costs") },
          { key: "ingredients", label: tr("أسعار المواد", "Ingredient prices") },
          { key: "impact", label: tr("تغيّر الأسعار", "Price changes") },
          { key: "overheads", label: tr("المصاريف الثابتة", "Fixed costs") },
          { key: "prep", label: tr("التحضير والتوقّع", "Prep & forecast") },
        ]}
      />
      <Routes>
        <Route index element={<Navigate to="products" replace />} />
        <Route path="products" element={<ProductsTab />} />
        <Route path="ingredients" element={<IngredientsTab />} />
        <Route path="impact" element={<ImpactTab />} />
        <Route path="overheads" element={<OverheadsTab />} />
        <Route path="prep" element={<PrepTab />} />
      </Routes>
    </>
  );
}
