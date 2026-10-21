import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Tabs } from "../../components/Tabs";
import { Empty, Field, PageHeader, Select, Spinner, TextInput } from "../../components/ui";
import { get, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { qty as fq, today, UNIT_LABEL, usd } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { openPrint } from "../../lib/print";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import type { Catalog, Employee, Location, Warehouse } from "../../lib/types";
import { QtyInput } from "../distribution/common";

interface Preview {
  products: { productId: string; nameAr: string; nameEn: string; qty: number; unitCostUsd: number; costUsd: number }[];
  materials: { itemId: string; nameAr: string; nameEn: string; kind: string; unitCode: string; need: number; have: number; short: number; costUsd: number }[];
  itemsCount: number;
  costUsd: number;
  shortages: number;
}
interface RunResult {
  id: string;
  number: number;
  batches: { productId: string; nameAr: string; nameEn: string; qty: number; batchId: string; batchCode: string; costUsd: number }[];
  costUsd: number;
  itemsCount: number;
}
interface Run {
  id: string;
  number: number;
  businessDate: string;
  createdAt: string;
  employeeName: string | null;
  userName: string | null;
  itemsCount: number;
  costUsd: number;
  note: string;
  batches: { id: string; batchCode: string; nameAr: string; nameEn: string; qtyIn: number; qtyLeft: number; expiresAt: string | null }[];
}

/** The morning run: several products at once. Ingredients are checked before anything is taken. */
function NewRun() {
  const { tr, pick, err, simple } = { ...useI18n(), simple: useAuth().simple };
  const { can } = useAuth();
  const toast = useToast();
  const catalog = useData<Catalog>("/menu/catalog");
  const employees = useData<{ rows: Employee[] }>(can("people", "view") ? "/people/employees" : null);
  const locs = useData<{ rows: Location[] }>("/stock/locations");
  const whs = useData<{ rows: Warehouse[] }>("/stock/warehouses");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [emp, setEmp] = useState("");
  const [loc, setLoc] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([productId, q]) => ({ productId, qty: q }));
  const key = JSON.stringify(lines);
  useEffect(() => {
    if (!lines.length) return setPreview(null);
    const t = setTimeout(() => {
      post<Preview>("/production/preview", { lines })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const fridgeLocs = (locs.data?.rows ?? []).filter((l) => whs.data?.rows.find((w) => w.id === l.warehouseId)?.kind !== "store");
  const confirm = async () => {
    setBusy(true);
    try {
      const r = await post<RunResult>("/production", { lines, employeeId: emp || null, locationId: loc || null, note });
      setDone(r);
      setQty({});
      toast(tr(`تم الإنتاج: دفعة رقم ${r.number}`, `Made: run #${r.number}`));
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card">
          <h2 className="text-xl font-bold">{tr(`دفعة الإنتاج رقم ${done.number} جاهزة`, `Production run #${done.number} is ready`)}</h2>
          <p className="text-muted">{tr(`${done.itemsCount} قطعة دخلت البرّاد، والمواد انخصمت من المخزون.`, `${done.itemsCount} pieces went into the fridge and the materials were taken from stock.`)}</p>
          <ul className="my-4 grid gap-2">
            {done.batches.map((b) => (
              <li key={b.batchId} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                <span>
                  <b>{pick(b)}</b> · <span className="num ltr">{b.qty}</span> · <span className="chip ltr">{b.batchCode}</span>
                </span>
                <button className="btn px-3 py-1 text-sm" onClick={() => openPrint(`/print/labels?batches=${b.batchId}&copies=${b.qty}`)}>
                  {tr(`اطبع ${b.qty} ملصق`, `Print ${b.qty} labels`)}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => openPrint(`/print/labels?batches=${done.batches.map((b) => b.batchId).join(",")}`)}>
              {tr("اطبع كل الملصقات", "Print all labels")}
            </button>
            <button className="btn" onClick={() => setDone(null)}>
              {tr("دفعة جديدة", "New run")}
            </button>
          </div>
        </div>
      </div>
    );
  if (!catalog.data) return <Spinner />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div>
        <p className="mb-3 text-muted">{tr("اكتب كم بدك تعمل من كل صنف. البرنامج بيحسب المواد اللازمة قبل ما تأكّد.", "Enter how many of each product you are making. The materials are checked before you confirm.")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {catalog.data.products
            .filter((p) => p.active)
            .map((p) => (
              <div key={p.id} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${qty[p.id] ? "border-ink" : "border-line"} bg-surface`}>
                <div className="min-w-0">
                  <div className={`truncate font-semibold ${simple ? "text-lg" : ""}`}>{pick(p)}</div>
                  <div className="text-xs text-faint ltr">{p.code}</div>
                </div>
                <QtyInput value={qty[p.id] ?? 0} onChange={(n) => setQty({ ...qty, [p.id]: n })} label={pick(p)} />
              </div>
            ))}
        </div>
      </div>
      <div className="lg:sticky lg:top-20 lg:self-start">
        <div className="card">
          <h3 className="mb-2 font-bold">{tr("المواد اللازمة", "Materials needed")}</h3>
          {!preview ? (
            <p className="text-sm text-faint">{tr("اختر الأصناف والكميات.", "Choose products and quantities.")}</p>
          ) : (
            <>
              <div className="mb-2 text-sm">
                {tr("المجموع", "Total")}: <b className="num ltr">{preview.itemsCount}</b> {tr("قطعة", "pieces")}
                {can("costing", "see_cost") && (
                  <>
                    {" "}
                    · {tr("التكلفة", "Cost")} <b className="num ltr">{usd(preview.costUsd)}</b>
                  </>
                )}
              </div>
              {preview.shortages > 0 && <p className="mb-2 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{tr(`في ${preview.shortages} مادة ناقصة بالمخزون. فيك تكمل، بس المخزون رح يصير بالسالب لحتى تسجّل المشتريات.`, `${preview.shortages} material(s) are short. You can still go ahead; stock will show below zero until the purchase is entered.`)}</p>}
              <div className="max-h-[45vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th">{tr("المادة", "Material")}</th>
                      <th className="th text-end">{tr("لازم", "Need")}</th>
                      <th className="th text-end">{tr("موجود", "Have")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.materials.map((m) => (
                      <tr key={m.itemId} className={m.short > 0 ? "text-bad" : ""}>
                        <td className="td">{pick(m)}</td>
                        <td className="td text-end num ltr">
                          {fq(m.need)} {pick(UNIT_LABEL[m.unitCode] ?? { ar: m.unitCode, en: m.unitCode })}
                        </td>
                        <td className="td text-end num ltr">{fq(m.have)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="mt-3 grid gap-3">
            {employees.data && (
              <Field label={tr("الموظف المسؤول", "Made by")} htmlFor="pr-e">
                <Select id="pr-e" value={emp} onChange={(e) => setEmp(e.target.value)}>
                  <option value="">—</option>
                  {employees.data.rows
                    .filter((e) => e.active)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            <Field label={tr("المكان", "Put in")} htmlFor="pr-l">
              <Select id="pr-l" value={loc} onChange={(e) => setLoc(e.target.value)}>
                <option value="">{tr("البرّاد الأول", "First fridge")}</option>
                {fridgeLocs.map((l) => {
                  const w = whs.data?.rows.find((x) => x.id === l.warehouseId);
                  return (
                    <option key={l.id} value={l.id}>
                      {w ? `${pick(w)} · ` : ""}
                      {pick(l)}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field label={tr("ملاحظة", "Note")} htmlFor="pr-n">
              <TextInput id="pr-n" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <button className="btn btn-primary py-3 text-lg" disabled={!lines.length || busy || !can("warehouse", "create")} onClick={confirm}>
              {tr("اعتماد الإنتاج", "Confirm production")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Runs() {
  const { tr, pick, fmtDate } = useI18n();
  const { can } = useAuth();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const list = useData<{ rows: Run[] }>(`/production?from=${from}&to=${to}`);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={tr("من", "From")} htmlFor="rn-f">
          <TextInput id="rn-f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={tr("إلى", "To")} htmlFor="rn-t">
          <TextInput id="rn-t" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {!list.data ? (
        <Spinner />
      ) : list.data.rows.length === 0 ? (
        <Empty text={tr("ما في دفعات إنتاج بهالفترة.", "No production runs in this period.")} />
      ) : (
        <div className="grid gap-3">
          {list.data.rows.map((r) => (
            <div key={r.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold">
                  {tr("دفعة", "Run")} #{r.number} · {fmtDate(r.createdAt, true)}
                </div>
                <div className="text-sm text-muted">
                  {r.employeeName ?? r.userName ?? ""} · <span className="num ltr">{r.itemsCount}</span> {tr("قطعة", "pcs")}
                  {can("costing", "see_cost") && (
                    <>
                      {" "}
                      · <span className="num ltr">{usd(r.costUsd)}</span>
                    </>
                  )}
                </div>
              </div>
              <ul className="mt-2 grid gap-1 text-sm">
                {r.batches.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2">
                    <span className="chip ltr">{b.batchCode}</span>
                    {pick(b)} · {tr("صنع", "made")} <span className="num ltr">{b.qtyIn}</span> · {tr("باقي", "left")} <span className="num ltr">{b.qtyLeft}</span>
                    <Link className="text-muted underline" to={`/production/trace?code=${b.batchCode}`}>
                      {tr("مين أخد منها؟", "Who got it?")}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Trace {
  batch: { batchCode: string; nameAr: string; nameEn: string; producedAt: string; expiresAt: string | null; qtyIn: number; qtyLeft: number };
  run: { number: number; employeeName: string | null; date: string } | null;
  received: { kind: "order" | "consignment"; id: string; number: number; date: string; clientId: string | null; clientName: string | null; phone: string | null; qty: number; status: string }[];
  clientsCount: number;
}

/** Scan a label: which shops got this batch (for a quality problem or a recall). */
function TraceTab() {
  const { tr, pick, fmtDate, err } = useI18n();
  const params = new URLSearchParams(window.location.search);
  const [code, setCode] = useState(params.get("code") ?? "");
  const [data, setData] = useState<Trace | null>(null);
  const [error, setError] = useState("");
  const look = async (c = code) => {
    if (!c.trim()) return;
    setError("");
    try {
      setData(await get<Trace>(`/trace/${encodeURIComponent(c.trim())}`));
    } catch (e) {
      setData(null);
      setError(err(e));
    }
  };
  useEffect(() => {
    if (code) void look(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-muted">{tr("امسح باركود الملصق أو اكتب رقم الدفعة، بيطلعلك كل المحلات اللي أخدت منها.", "Scan the label's barcode or type the batch number to see every shop that received it.")}</p>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void look();
        }}
      >
        <TextInput autoFocus dir="ltr" placeholder="B-1021-01" value={code} onChange={(e) => setCode(e.target.value)} aria-label={tr("رقم الدفعة", "Batch number")} />
        <button className="btn btn-primary">{tr("بحث", "Find")}</button>
      </form>
      {error && <p className="text-bad">{error}</p>}
      {data && (
        <div className="card">
          <div className="text-lg font-bold">
            {pick(data.batch)} · <span className="ltr">{data.batch.batchCode}</span>
          </div>
          <div className="text-sm text-muted">
            {tr("صُنعت", "Made")} {fmtDate(data.batch.producedAt, true)}
            {data.batch.expiresAt && ` · ${tr("تنتهي", "expires")} ${fmtDate(data.batch.expiresAt, true)}`}
            {data.run && ` · ${tr("دفعة إنتاج", "run")} #${data.run.number}${data.run.employeeName ? ` (${data.run.employeeName})` : ""}`}
          </div>
          <div className="mt-1 text-sm">
            {tr("الكمية", "Quantity")} <b className="num ltr">{data.batch.qtyIn}</b> · {tr("باقي بالبرّاد", "left in fridge")} <b className="num ltr">{data.batch.qtyLeft}</b> · {tr("وصلت إلى", "went to")} <b className="num ltr">{data.clientsCount}</b> {tr("زبون", "clients")}
          </div>
          {data.received.length === 0 ? (
            <p className="mt-3 text-faint">{tr("ما طلع شي من هالدفعة لزبائن.", "Nothing from this batch went to clients.")}</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr>
                  <th className="th">{tr("الزبون", "Client")}</th>
                  <th className="th">{tr("الهاتف", "Phone")}</th>
                  <th className="th">{tr("المستند", "Document")}</th>
                  <th className="th text-end">{tr("الكمية", "Qty")}</th>
                </tr>
              </thead>
              <tbody>
                {data.received.map((r) => (
                  <tr key={r.kind + r.id}>
                    <td className="td font-semibold">{r.clientName ?? tr("زبون عابر", "Walk-in")}</td>
                    <td className="td ltr">{r.phone ?? ""}</td>
                    <td className="td">
                      {r.kind === "order" ? `#${r.number}` : `C${r.number}`} · {fmtDate(r.date)}
                    </td>
                    <td className="td text-end num">{r.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function ProductionPage() {
  const { tr } = useI18n();
  return (
    <>
      <PageHeader title={tr("الإنتاج اليومي", "Daily production")} subtitle={tr("دفعة الصبح بكل أصنافها، المواد قبل الاعتماد، وتتبّع كل دفعة لوين راحت.", "The morning run with all its products, materials before you confirm, and where every batch went.")} />
      <Tabs
        base="/production"
        tabs={[
          { key: "new", label: tr("دفعة جديدة", "New run") },
          { key: "runs", label: tr("الدفعات", "Runs") },
          { key: "trace", label: tr("تتبّع دفعة", "Trace a batch") },
        ]}
      />
      <Routes>
        <Route index element={<Navigate to="new" replace />} />
        <Route path="new" element={<NewRun />} />
        <Route path="runs" element={<Runs />} />
        <Route path="trace" element={<TraceTab />} />
      </Routes>
    </>
  );
}
