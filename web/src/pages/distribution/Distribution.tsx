import { useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Tabs } from "../../components/Tabs";
import { ConfirmDialog, Empty, Field, PageHeader, Select, Spinner, TextInput } from "../../components/ui";
import { get, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { money, today, usd, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { openPrint } from "../../lib/print";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import type { Lookup } from "../../lib/types";
import { ConsignmentDialog, ReturnDialog, STATUS_LABEL, SettleDialog, useLists, waLink, type Consignment } from "./common";

interface Stop {
  clientId: string;
  name: string;
  phone: string;
  address: string;
  areaId: string | null;
  standing: { id: string; lines: { productId: string; qty: number }[]; note: string }[];
  orders: { id: string; number: number; total: number; currency: Currency; paymentStatus: string; status: string; items: number }[];
  consignments: { id: string; number: number; date: string }[];
  balanceUsd: number;
  overdueDays: number;
}
export interface RouteSheet {
  date: string;
  rep: { id: string; name: string } | null;
  stops: Stop[];
}

/** The delivery person's day: every shop to visit, what to bring, what to collect. */
function RouteTab() {
  const { tr, pick, lang } = useI18n();
  const { can } = useAuth();
  const { reps, products } = useLists();
  const areas = useData<{ items: Lookup[] }>("/lookups?type=area");
  const [date, setDate] = useState(today());
  const [rep, setRep] = useState("");
  const sheet = useData<RouteSheet>(`/route-sheet?date=${date}${rep ? `&repId=${rep}` : ""}`);
  const [consFor, setConsFor] = useState<string | null>(null);
  const [retFor, setRetFor] = useState<string | null>(null);
  const [settle, setSettle] = useState<Consignment | null>(null);
  const toast = useToast();
  const areaName = (id: string | null) => {
    const a = areas.data?.items.find((x) => x.id === id);
    return a ? pick(a) : tr("بدون منطقة", "No area");
  };
  const prodName = (id: string) => {
    const p = products.find((x) => x.id === id);
    return p ? pick(p) : "?";
  };
  const openSettle = async (id: string) => {
    try {
      setSettle((await get<{ consignment: Consignment }>(`/consignments/${id}`)).consignment);
    } catch {
      toast(tr("تعذّر الفتح", "Could not open"), "error");
    }
  };
  if (!sheet.data) return <Spinner />;
  let lastArea: string | null | undefined;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={tr("اليوم", "Day")} htmlFor="rs-d">
          <TextInput id="rs-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={tr("المندوب", "Rep")} htmlFor="rs-r">
          <Select id="rs-r" value={rep} onChange={(e) => setRep(e.target.value)}>
            <option value="">{tr("الكل", "Everyone")}</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <button className="btn" onClick={() => openPrint(`/print/route?date=${date}${rep ? `&repId=${rep}` : ""}`)}>
          {tr("اطبع ورقة التوزيع", "Print route sheet")}
        </button>
      </div>
      {sheet.data.stops.length === 0 ? (
        <Empty text={tr("ما في محلات بهالخط اليوم. المحلات بتظهر هون إذا عندها طلب ثابت لهاليوم، أو فاتورة توصيل، أو بضاعة بالأمانة.", "No stops today. A shop shows here when it has a standing order for this weekday, a delivery invoice, or goods on consignment.")} />
      ) : (
        <div className="grid gap-3">
          {sheet.data.stops.map((s, i) => {
            const header = s.areaId !== lastArea;
            lastArea = s.areaId;
            return (
              <div key={s.clientId}>
                {header && <h3 className="mb-2 mt-2 text-sm font-semibold text-muted">{areaName(s.areaId)}</h3>}
                <div className="card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-bold">
                        <span className="me-2 text-faint num">{i + 1}.</span>
                        <Link to={`/clients/${s.clientId}`} className="hover:underline">
                          {s.name}
                        </Link>
                      </div>
                      <div className="text-sm text-muted">
                        {s.address}
                        {s.address && s.phone && " · "}
                        {s.phone && <span className="ltr">{s.phone}</span>}
                        {!s.address && !s.phone && "—"}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className={`text-lg font-bold num ltr ${s.balanceUsd < -0.009 ? "text-bad" : ""}`}>{s.balanceUsd < -0.009 ? `${tr("عليه", "Owes")} ${usd(-s.balanceUsd)}` : s.balanceUsd > 0.009 ? `${tr("له", "Credit")} ${usd(s.balanceUsd)}` : tr("ما عليه شي", "Nothing owed")}</div>
                      {s.overdueDays > 0 && <div className="chip !bg-bad/10 !text-bad">{tr(`متأخر ${s.overdueDays} يوم`, `${s.overdueDays} days late`)}</div>}
                    </div>
                  </div>
                  {(s.standing.length > 0 || s.orders.length > 0 || s.consignments.length > 0) && (
                    <ul className="mt-3 grid gap-1 text-sm">
                      {s.standing.map((st) => (
                        <li key={st.id}>
                          <span className="chip me-2">{tr("طلب ثابت", "Standing order")}</span>
                          {st.lines.map((l) => `${l.qty} × ${prodName(l.productId)}`).join("، ")}
                        </li>
                      ))}
                      {s.orders.map((o) => (
                        <li key={o.id}>
                          <span className="chip me-2">#{o.number}</span>
                          <span className="num ltr">{money(o.total, o.currency, lang)}</span> · {pick(STATUS_LABEL[o.paymentStatus] ?? { ar: o.paymentStatus, en: o.paymentStatus })}
                        </li>
                      ))}
                      {s.consignments.map((c) => (
                        <li key={c.id}>
                          <span className="chip me-2">C{c.number}</span>
                          {tr("بضاعة بالأمانة عند المحل", "Goods on consignment at the shop")}
                          {can("orders", "create") && (
                            <button className="btn btn-ghost ms-2 px-2 py-0.5 text-sm" onClick={() => void openSettle(c.id)}>
                              {tr("تسوية", "Settle")}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {can("orders", "create") && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link className="btn btn-primary" to={`/orders/new?client=${s.clientId}`}>
                        {tr("فاتورة", "Invoice")}
                      </Link>
                      <button className="btn" onClick={() => setConsFor(s.clientId)}>
                        {tr("بضاعة بالأمانة", "Consignment")}
                      </button>
                      <button className="btn" onClick={() => setRetFor(s.clientId)}>
                        {tr("مرتجع", "Return")}
                      </button>
                      {s.phone && s.balanceUsd < -0.009 && (
                        <a
                          className="btn btn-ghost"
                          href={waLink(s.phone, tr(`مرحباً ${s.name}، رصيدكم المستحق لدى JJ's هو ${usd(-s.balanceUsd)}. شكراً لكم.`, `Hello ${s.name}, your balance due to JJ's is ${usd(-s.balanceUsd)}. Thank you.`))}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {tr("تذكير واتساب", "WhatsApp reminder")}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {consFor && <ConsignmentDialog clientId={consFor} onClose={() => setConsFor(null)} onDone={() => (setConsFor(null), void sheet.reload())} />}
      {retFor && <ReturnDialog clientId={retFor} onClose={() => setRetFor(null)} onDone={() => (setRetFor(null), void sheet.reload())} />}
      {settle && <SettleDialog c={settle} onClose={() => setSettle(null)} onDone={() => (setSettle(null), void sheet.reload())} />}
    </div>
  );
}

function ConsignmentsTab() {
  const { tr, pick, fmtDate, lang, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "settled" | "cancelled" | "">("open");
  const list = useData<{ rows: Consignment[] }>(`/consignments${status ? `?status=${status}` : ""}`);
  const [adding, setAdding] = useState(false);
  const [settle, setSettle] = useState<Consignment | null>(null);
  const [cancel, setCancel] = useState<Consignment | null>(null);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["open", "settled", "cancelled", ""] as const).map((s) => (
          <button key={s || "all"} className={`btn ${status === s ? "btn-primary" : ""}`} onClick={() => setStatus(s)}>
            {s ? pick(STATUS_LABEL[s]!) : tr("الكل", "All")}
          </button>
        ))}
        {can("orders", "create") && (
          <button className="btn ms-auto" onClick={() => setAdding(true)}>
            {tr("+ تسليم بالأمانة", "+ Leave goods")}
          </button>
        )}
      </div>
      {!list.data ? (
        <Spinner />
      ) : list.data.rows.length === 0 ? (
        <Empty text={tr("ما في بضاعة بالأمانة. المحلات اللي بتدفع بس على المباع بتتعلّم «بالأمانة» من صفحة الزبون.", "No consignments. Shops that pay only for what they sell are marked “consignment” on their client page.")} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">#</th>
                <th className="th">{tr("التاريخ", "Date")}</th>
                <th className="th">{tr("المحل", "Shop")}</th>
                <th className="th">{tr("المندوب", "Rep")}</th>
                <th className="th text-end">{tr("القطع", "Pieces")}</th>
                <th className="th text-end">{tr("القيمة", "Value")}</th>
                <th className="th">{tr("الحالة", "Status")}</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {list.data.rows.map((c) => (
                <tr key={c.id}>
                  <td className="td num">C{c.number}</td>
                  <td className="td">{fmtDate(c.businessDate)}</td>
                  <td className="td font-semibold">{c.clientName}</td>
                  <td className="td">{c.repName ?? "—"}</td>
                  <td className="td text-end num">
                    {c.qty}
                    {c.status === "settled" && <span className="text-faint"> ({tr("رجع", "back")} {c.lines.reduce((s, l) => s + l.returnedQty, 0)})</span>}
                  </td>
                  <td className="td text-end num ltr">{money(c.value, c.currency, lang)}</td>
                  <td className="td">
                    <span className="chip">{pick(STATUS_LABEL[c.status]!)}</span> {c.orderNumber && <span className="text-xs text-muted">#{c.orderNumber}</span>}
                  </td>
                  <td className="td whitespace-nowrap text-end">
                    {c.status === "open" && can("orders", "create") && (
                      <button className="btn btn-primary px-3 py-1 text-sm" onClick={() => setSettle(c)}>
                        {tr("تسوية", "Settle")}
                      </button>
                    )}
                    {c.status === "open" && can("orders", "delete") && (
                      <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setCancel(c)}>
                        {tr("إلغاء", "Cancel")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <ConsignmentDialog onClose={() => setAdding(false)} onDone={() => (setAdding(false), void list.reload())} />}
      {settle && <SettleDialog c={settle} onClose={() => setSettle(null)} onDone={() => (setSettle(null), void list.reload())} />}
      {cancel && (
        <ConfirmDialog
          text={tr(`إلغاء C${cancel.number}؟ البضاعة بترجع للبرّاد.`, `Cancel C${cancel.number}? The goods go back to the fridge.`)}
          onClose={() => setCancel(null)}
          onConfirm={async () => {
            try {
              await post(`/consignments/${cancel.id}/cancel`);
              setCancel(null);
              void list.reload();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </div>
  );
}

interface ReturnRow {
  id: string;
  number: number;
  businessDate: string;
  clientName: string | null;
  orderNumber: number | null;
  total: number;
  currency: Currency;
  settlement: "credit" | "refund" | "none";
  note: string;
  lines: { productId: string; nameAr: string; nameEn: string; qty: number; action: "restock" | "waste" }[];
}

function ReturnsTab() {
  const { tr, pick, fmtDate, lang } = useI18n();
  const { can } = useAuth();
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const list = useData<{ rows: ReturnRow[] }>(`/returns?from=${from}&to=${to}`);
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={tr("من", "From")} htmlFor="rt-f">
          <TextInput id="rt-f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={tr("إلى", "To")} htmlFor="rt-t">
          <TextInput id="rt-t" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {can("orders", "create") && (
          <button className="btn btn-primary ms-auto" onClick={() => setAdding(true)}>
            {tr("+ مرتجع", "+ Return")}
          </button>
        )}
      </div>
      {!list.data ? (
        <Spinner />
      ) : list.data.rows.length === 0 ? (
        <Empty text={tr("ما في مرتجعات بهالفترة.", "No returns in this period.")} />
      ) : (
        <div className="grid gap-2">
          {list.data.rows.map((r) => (
            <div key={r.id} className="card flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold">
                  R{r.number} · {r.clientName ?? tr("زبون عابر", "Walk-in")} {r.orderNumber && <span className="text-sm font-normal text-muted">({tr("فاتورة", "invoice")} #{r.orderNumber})</span>}
                </div>
                <div className="text-sm text-muted">
                  {fmtDate(r.businessDate)} · {r.lines.map((l) => `${l.qty} × ${pick(l)} (${pick(STATUS_LABEL[l.action]!)})`).join("، ")}
                </div>
                {r.note && <div className="text-sm text-muted">{r.note}</div>}
              </div>
              <div className="text-end">
                <div className="text-lg font-bold num ltr">{money(r.total, r.currency, lang)}</div>
                <span className="chip">{pick(STATUS_LABEL[r.settlement === "credit" ? "credit_s" : r.settlement]!)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <ReturnDialog onClose={() => setAdding(false)} onDone={() => (setAdding(false), void list.reload())} />}
    </div>
  );
}

export function DistributionPage() {
  const { tr } = useI18n();
  return (
    <>
      <PageHeader title={tr("التوزيع", "Distribution")} subtitle={tr("خط المندوب اليوم، البضاعة بالأمانة، والمرتجعات.", "The rep's route today, goods on consignment, and returns.")} />
      <Tabs
        base="/distribution"
        tabs={[
          { key: "route", label: tr("خط التوزيع", "Route sheet") },
          { key: "consignments", label: tr("بالأمانة", "Consignment") },
          { key: "returns", label: tr("المرتجعات", "Returns") },
        ]}
      />
      <Routes>
        <Route index element={<Navigate to="route" replace />} />
        <Route path="route" element={<RouteTab />} />
        <Route path="consignments" element={<ConsignmentsTab />} />
        <Route path="returns" element={<ReturnsTab />} />
      </Routes>
    </>
  );
}
