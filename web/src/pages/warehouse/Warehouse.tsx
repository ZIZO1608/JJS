import { useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DataTable } from "../../components/DataTable";
import { LookupSelect } from "../../components/LookupSelect";
import { Tabs } from "../../components/Tabs";
import { Empty, Field, Modal, PageHeader, Select, Spinner, TextInput } from "../../components/ui";
import { ApiError, get, post, put } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { addDaysTo, num, qty as fmtQty, today, usd } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { openPrint } from "../../lib/print";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import type { Batch, BatchStatus, Catalog, Location, StockItem, Warehouse } from "../../lib/types";
import { ActionDialog, Check, DeleteConfirm, NameFields, NumInput, RowActions, unitOf, useSaver } from "../kit";

/* ---------- shared bits ---------- */

const STATUS: Record<BatchStatus, { ar: string; en: string; cls: string }> = {
  expired: { ar: "منتهي", en: "Expired", cls: "!bg-bad !text-white" },
  today: { ar: "ينتهي اليوم", en: "Ends today", cls: "!bg-warn !text-white" },
  soon: { ar: "قريب", en: "Soon", cls: "" },
  fresh: { ar: "طازج", en: "Fresh", cls: "" },
  none: { ar: "بلا تاريخ", en: "No date", cls: "" },
};
function StatusChip({ s }: { s: BatchStatus }) {
  const { pick } = useI18n();
  return <span className={`chip ${STATUS[s].cls}`}>{pick(STATUS[s])}</span>;
}

const WH_KIND: Record<Warehouse["kind"], { ar: string; en: string }> = { store: { ar: "مستودع", en: "Store" }, fridge: { ar: "برّاد", en: "Fridge" }, freezer: { ar: "فريزر", en: "Freezer" } };

/** Every location with its warehouse, for dropdowns: "Fridge 1 · Top shelf". */
function usePlaces() {
  const whs = useData<{ rows: Warehouse[] }>("/stock/warehouses");
  const locs = useData<{ rows: Location[] }>("/stock/locations");
  const list = useMemo(() => {
    const w = whs.data?.rows ?? [];
    return (locs.data?.rows ?? [])
      .filter((l) => l.active)
      .map((l) => ({ loc: l, wh: w.find((x) => x.id === l.warehouseId) }))
      .filter((x): x is { loc: Location; wh: Warehouse } => !!x.wh)
      .sort((a, b) => a.wh.sort - b.wh.sort);
  }, [whs.data, locs.data]);
  return { list, whs, locs, ready: !!whs.data && !!locs.data };
}
function PlaceSelect({ value, onChange, id, only, places }: { value: string; onChange: (v: string) => void; id?: string; only?: Warehouse["kind"][]; places: ReturnType<typeof usePlaces>["list"] }) {
  const { pick, tr } = useI18n();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{tr("اختر المكان…", "Choose a place…")}</option>
      {places
        .filter((p) => !only || only.includes(p.wh.kind))
        .map((p) => (
          <option key={p.loc.id} value={p.loc.id}>
            {pick(p.wh)} · {pick(p.loc)}
          </option>
        ))}
    </Select>
  );
}

/** "12 pc", "0.8 كغ" */
function Q({ v, unit }: { v: number; unit: string }) {
  const { lang } = useI18n();
  return (
    <span className="whitespace-nowrap">
      <span className="num ltr">{fmtQty(v)}</span> <span className="text-xs text-muted">{unitOf(unit, lang)}</span>
    </span>
  );
}

/* ---------- one batch: labels, waste, move, count ---------- */

type BatchAction = "labels" | "waste" | "move" | "count";

function BatchDialog({ batch, initial, onClose, onDone }: { batch: Batch; initial?: BatchAction; onClose: () => void; onDone: () => void }) {
  const { tr, pick, fmtDate, lang } = useI18n();
  const { can, simple } = useAuth();
  const { errors, busy, run } = useSaver();
  const places = usePlaces();
  const [action, setAction] = useState<BatchAction | null>(initial ?? null);
  const isProduct = batch.item.kind === "product";
  const [copies, setCopies] = useState(String(isProduct ? Math.max(1, Math.round(batch.qtyLeft)) : 1));
  const [w, setW] = useState({ qty: String(batch.qtyLeft), reasonId: "", note: "" });
  const [m, setM] = useState({ to: "", qty: String(batch.qtyLeft) });
  const [counted, setCounted] = useState(String(batch.qtyLeft));

  const doIt = async () => {
    if (action === "labels") {
      openPrint(`/print/labels?batches=${batch.id}&copies=${Math.max(1, Math.round(num(copies) || 1))}`);
      onClose();
      return;
    }
    let ok = false;
    if (action === "waste") {
      const q = num(w.qty);
      ok = await run(() => post("/stock/waste", { batchId: batch.id, qty: q >= batch.qtyLeft ? undefined : q, reasonId: w.reasonId || null, note: w.note || undefined }), tr("انسجّل الهدر.", "Waste recorded."));
    } else if (action === "move") {
      const q = num(m.qty);
      ok = await run(() => post("/stock/transfer", { batchId: batch.id, toLocationId: m.to, qty: q >= batch.qtyLeft ? undefined : q }), tr("انتقل.", "Moved."));
    } else if (action === "count") {
      ok = await run(() => post("/stock/count", { batchId: batch.id, counted: num(counted) }), tr("انحفظ الجرد.", "Count saved."));
    }
    if (ok) onDone();
  };

  const actions: { k: BatchAction; label: string; show: boolean }[] = [
    { k: "labels", label: tr("اطبع ملصقات", "Print labels"), show: true },
    { k: "waste", label: tr("هدر", "Waste"), show: can("warehouse", "create") },
    { k: "move", label: tr("نقل", "Move"), show: can("warehouse", "create") },
    { k: "count", label: tr("جرد", "Count"), show: can("warehouse", "edit") },
  ];
  const invalid =
    action === null ||
    (action === "waste" && !(num(w.qty) > 0 && num(w.qty) <= batch.qtyLeft)) ||
    (action === "move" && (!m.to || m.to === batch.locationId || !(num(m.qty) > 0 && num(m.qty) <= batch.qtyLeft))) ||
    (action === "count" && !(num(counted) >= 0));

  return (
    <Modal
      title={pick(batch.item)}
      onClose={onClose}
      footer={
        action && (
          <>
            <button className="btn" onClick={() => (initial ? onClose() : setAction(null))}>
              {initial ? tr("إلغاء", "Cancel") : tr("رجوع", "Back")}
            </button>
            <button className={`btn btn-primary ${action === "waste" ? "!border-bad !bg-bad !text-white" : ""}`} disabled={invalid || busy} onClick={doIt}>
              {action === "labels" ? tr("اطبع", "Print") : action === "waste" ? tr("سجّل الهدر", "Record waste") : action === "move" ? tr("انقل", "Move") : tr("احفظ الجرد", "Save count")}
            </button>
          </>
        )
      }
    >
      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{tr("رقم الدفعة", "Batch")}</dt>
        <dd className="num ltr text-start font-semibold">{batch.batchCode}</dd>
        <dt className="text-muted">{tr("الكمية الباقية", "Left")}</dt>
        <dd>
          <Q v={batch.qtyLeft} unit={batch.item.unitCode} />
        </dd>
        <dt className="text-muted">{tr("المكان", "Place")}</dt>
        <dd>
          {pick(batch.warehouse)} · {pick(batch.location)}
        </dd>
        <dt className="text-muted">{tr("الإنتاج", "Made")}</dt>
        <dd>{fmtDate(batch.producedAt, true)}</dd>
        <dt className="text-muted">{tr("الانتهاء", "Expires")}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {batch.expiresAt ? fmtDate(batch.expiresAt, true) : "—"} <StatusChip s={batch.status} />
        </dd>
        {!simple && can("costing", "see_cost") && (
          <>
            <dt className="text-muted">{tr("كلفة الوحدة", "Unit cost")}</dt>
            <dd className="num ltr text-start">{usd(batch.unitCostUsd)}</dd>
          </>
        )}
      </dl>

      {action === null && (
        <div className="grid grid-cols-2 gap-2">
          {actions
            .filter((a) => a.show)
            .map((a) => (
              <button key={a.k} className={`btn min-h-[52px] text-base ${a.k === "labels" ? "btn-primary" : ""} ${a.k === "waste" ? "btn-danger" : ""}`} onClick={() => setAction(a.k)}>
                {a.label}
              </button>
            ))}
        </div>
      )}
      {action === "labels" && (
        <Field label={tr("كم ملصق؟", "How many labels?")} htmlFor="b-copies" hint={isProduct ? tr("ملصق لكل قطعة", "One label per piece") : undefined}>
          <NumInput id="b-copies" step="1" min={1} value={copies} onChange={setCopies} />
        </Field>
      )}
      {action === "waste" && (
        <div className="grid gap-3">
          <Field label={tr(`الكمية (حتى ${fmtQty(batch.qtyLeft)} ${unitOf(batch.item.unitCode, lang)})`, `Quantity (up to ${fmtQty(batch.qtyLeft)} ${unitOf(batch.item.unitCode, lang)})`)} htmlFor="w-qty" error={errors.qty}>
            <NumInput id="w-qty" value={w.qty} onChange={(v) => setW({ ...w, qty: v })} />
          </Field>
          <Field label={tr("السبب", "Reason")} htmlFor="w-reason">
            <LookupSelect id="w-reason" listType="waste_reason" value={w.reasonId} onChange={(v) => setW({ ...w, reasonId: v })} />
          </Field>
          <Field label={tr("ملاحظة", "Note")} htmlFor="w-note">
            <TextInput id="w-note" value={w.note} onChange={(e) => setW({ ...w, note: e.target.value })} />
          </Field>
        </div>
      )}
      {action === "move" && (
        <div className="grid gap-3">
          <Field label={tr("إلى", "To")} htmlFor="m-to">
            <PlaceSelect id="m-to" value={m.to} onChange={(v) => setM({ ...m, to: v })} places={places.list.filter((p) => p.loc.id !== batch.locationId)} />
          </Field>
          <Field label={tr("الكمية", "Quantity")} htmlFor="m-qty">
            <NumInput id="m-qty" value={m.qty} onChange={(v) => setM({ ...m, qty: v })} />
          </Field>
        </div>
      )}
      {action === "count" && (
        <Field label={tr("كم موجود فعلاً؟", "How many are really there?")} htmlFor="c-qty">
          <NumInput id="c-qty" value={counted} onChange={setCounted} />
        </Field>
      )}
    </Modal>
  );
}

/* ---------- fridge & stock ---------- */

function ScanBox({ onBatch }: { onBatch: (b: Batch) => void }) {
  const { tr, err, pick } = useI18n();
  const toast = useToast();
  const [code, setCode] = useState("");
  const scan = async () => {
    const c = code.trim();
    if (!c) return;
    try {
      const r = await get<{ kind: "batch"; batch: Batch } | { kind: "product"; product: { nameAr: string; nameEn: string } }>(`/stock/scan/${encodeURIComponent(c)}`);
      if (r.kind === "batch") onBatch(r.batch);
      else toast(tr(`هذا كود منتج: ${pick(r.product)}`, `That is a product code: ${pick(r.product)}`));
    } catch (e) {
      toast(e instanceof ApiError && e.status === 404 ? tr(`ما لقينا شي بالكود ${c}`, `Nothing found for ${c}`) : err(e), "error");
    }
    setCode("");
    document.getElementById("scan")?.focus();
  };
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void scan();
      }}
    >
      <TextInput id="scan" dir="ltr" className="num max-w-xs uppercase" placeholder={tr("امسح الباركود أو اكتب رقم الدفعة", "Scan a barcode or type a batch code")} value={code} onChange={(e) => setCode(e.target.value)} aria-label={tr("مسح", "Scan")} />
      <button className="btn" type="submit">
        {tr("بحث", "Find")}
      </button>
    </form>
  );
}

function BatchRow({ b, onOpen, big }: { b: Batch; onOpen: () => void; big?: boolean }) {
  const { pick, fmtDate, tr } = useI18n();
  return (
    <button onClick={onOpen} className={`flex w-full items-center gap-3 border-b border-line px-3 text-start last:border-b-0 hover:bg-sunken ${big ? "py-3.5" : "py-2.5"}`}>
      <div className="min-w-0 flex-1">
        <div className={`font-semibold ${big ? "text-base" : ""}`}>{pick(b.item)}</div>
        <div className="text-xs text-faint">
          <span className="num ltr">{b.batchCode}</span> · {b.expiresAt ? `${tr("ينتهي", "ends")} ${fmtDate(b.expiresAt, true)}` : tr("بلا تاريخ انتهاء", "no expiry")}
        </div>
      </div>
      <Q v={b.qtyLeft} unit={b.item.unitCode} />
      <StatusChip s={b.status} />
    </button>
  );
}

function FridgeTab({ wasteMode }: { wasteMode?: boolean }) {
  const { tr, pick } = useI18n();
  const { simple } = useAuth();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState<"" | "product" | "ingredient" | "packaging">(simple ? "product" : "");
  const [wh, setWh] = useState("");
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (kind) qs.set("kind", kind);
  if (wh) qs.set("warehouseId", wh);
  const batches = useData<{ rows: Batch[] }>(`/stock/batches?${qs}`);
  const whs = useData<{ rows: Warehouse[] }>("/stock/warehouses");
  const [open, setOpen] = useState<{ b: Batch; a?: BatchAction } | null>(null);

  const groups = useMemo(() => {
    const out: { key: string; title: string; list: Batch[] }[] = [];
    let rows = batches.data?.rows ?? [];
    if (wasteMode) rows = [...rows].sort((a, b) => (a.status === "expired" ? 0 : 1) - (b.status === "expired" ? 0 : 1));
    for (const b of rows) {
      const key = `${b.warehouse.id}/${b.location.id}`;
      let g = out.find((x) => x.key === key);
      if (!g) out.push((g = { key, title: `${pick(b.warehouse)} · ${pick(b.location)}`, list: [] }));
      g.list.push(b);
    }
    return out;
  }, [batches.data, pick, wasteMode]);

  const counts = useMemo(() => {
    const r = batches.data?.rows ?? [];
    return { expired: r.filter((b) => b.status === "expired").length, today: r.filter((b) => b.status === "today").length };
  }, [batches.data]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ScanBox onBatch={(b) => setOpen({ b, a: wasteMode ? "waste" : undefined })} />
        <div className="ms-auto flex flex-wrap gap-2">
          <Select aria-label={tr("الحالة", "Status")} className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tr("كل الحالات", "Any status")}</option>
            {(Object.keys(STATUS) as BatchStatus[]).map((s) => (
              <option key={s} value={s}>
                {pick(STATUS[s])}
              </option>
            ))}
          </Select>
          <Select aria-label={tr("النوع", "Kind")} className="!w-auto" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="">{tr("كل شي", "Everything")}</option>
            <option value="product">{tr("منتجات جاهزة", "Ready products")}</option>
            <option value="ingredient">{tr("مكوّنات", "Ingredients")}</option>
            <option value="packaging">{tr("تغليف", "Packaging")}</option>
          </Select>
          {!simple && (
            <Select aria-label={tr("المستودع", "Storage")} className="!w-auto" value={wh} onChange={(e) => setWh(e.target.value)}>
              <option value="">{tr("كل الأماكن", "All places")}</option>
              {(whs.data?.rows ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {pick(w)}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>
      {(counts.expired > 0 || counts.today > 0) && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {counts.expired > 0 && (
            <button className="chip !bg-bad !py-1 !text-white" onClick={() => setStatus("expired")}>
              {tr(`${counts.expired} منتهية — لازم تنرمى`, `${counts.expired} expired — throw away`)}
            </button>
          )}
          {counts.today > 0 && (
            <button className="chip !bg-warn !py-1 !text-white" onClick={() => setStatus("today")}>
              {tr(`${counts.today} تنتهي اليوم`, `${counts.today} end today`)}
            </button>
          )}
        </div>
      )}
      {!batches.data ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <Empty text={tr("ما في شي هون.", "Nothing here.")} />
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => (
            <section key={g.key} className="card p-0">
              <h3 className="border-b border-line px-3 py-2 text-sm font-semibold text-muted">{g.title}</h3>
              {g.list.map((b) => (
                <BatchRow key={b.id} b={b} big={simple} onOpen={() => setOpen({ b, a: wasteMode ? "waste" : undefined })} />
              ))}
            </section>
          ))}
        </div>
      )}
      {open && (
        <BatchDialog
          batch={open.b}
          initial={open.a}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            void batches.reload();
          }}
        />
      )}
    </>
  );
}

/* ---------- make (production) ---------- */

function MakeTab() {
  const { tr, pick, fmtDate } = useI18n();
  const places = usePlaces();
  const catalog = useData<Catalog>("/menu/catalog");
  const { busy, run } = useSaver();
  const [productId, setProductId] = useState("");
  const [count, setCount] = useState(10);
  const [loc, setLoc] = useState("");
  const [done, setDone] = useState<{ batchId: string; batchCode: string; qty: number; name: string; expires: string } | null>(null);
  const [cat, setCat] = useState("");
  if (!catalog.data || !places.ready) return <Spinner />;
  const products = catalog.data.products.filter((p) => !cat || p.categoryId === cat);
  const product = catalog.data.products.find((p) => p.id === productId);
  const fridgePlaces = places.list.filter((p) => p.wh.kind !== "store");

  const make = async () => {
    if (!product) return;
    let res: { batchId: string; batchCode: string } | null = null;
    const ok = await run(async () => {
      res = await post<{ batchId: string; batchCode: string; costUsd: number }>("/stock/produce", { productId: product.id, qty: count, locationId: loc || undefined });
    }, tr("انسجّل التحضير.", "Production recorded."));
    if (ok && res) {
      const r = res as { batchId: string; batchCode: string };
      setDone({ ...r, qty: count, name: pick(product), expires: new Date(Date.now() + product.shelfLifeHours * 3600e3).toISOString() });
    }
  };

  if (done)
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="card">
          <p className="text-muted">{tr("تحضّر", "Made")}</p>
          <p className="mt-1 text-2xl font-bold">
            <span className="num ltr">{done.qty}</span> × {done.name}
          </p>
          <p className="mt-2 text-sm text-muted">
            {tr("رقم الدفعة", "Batch")} <span className="num ltr font-semibold text-ink">{done.batchCode}</span> · {tr("ينتهي", "ends")} {fmtDate(done.expires, true)}
          </p>
          <button className="btn btn-primary mt-5 min-h-[56px] w-full text-lg" onClick={() => openPrint(`/print/labels?batches=${done.batchId}&copies=${done.qty}`)}>
            {tr(`اطبع ${done.qty} ملصق`, `Print ${done.qty} labels`)}
          </button>
          <button className="btn mt-2 w-full" onClick={() => (setDone(null), setProductId(""))}>
            {tr("حضّر شي تاني", "Make something else")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="grid gap-5">
      <section>
        <h2 className="mb-2 font-semibold">{tr("١. شو حضّرت؟", "1. What did you make?")}</h2>
        {catalog.data.categories.length > 1 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button className={`chip !py-1 ${!cat ? "!bg-ink !text-bg" : ""}`} onClick={() => setCat("")}>
              {tr("الكل", "All")}
            </button>
            {catalog.data.categories.map((c) => (
              <button key={c.id} className={`chip !py-1 ${cat === c.id ? "!bg-ink !text-bg" : ""}`} onClick={() => setCat(c.id)}>
                {pick(c)}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => setProductId(p.id)}
              className={`flex min-h-[72px] items-center gap-2 rounded-xl border p-3 text-start font-semibold transition active:scale-[.98] ${productId === p.id ? "border-ink bg-ink text-bg" : "border-line bg-surface hover:border-ink"}`}
            >
              {p.photo && <img src={p.photo} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />}
              <span className="min-w-0">{pick(p)}</span>
            </button>
          ))}
        </div>
      </section>
      {product && (
        <section>
          <h2 className="mb-2 font-semibold">{tr("٢. كم قطعة؟", "2. How many?")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn h-14 w-14 text-2xl" onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="-1">
              −
            </button>
            <input className="input num h-14 w-28 text-center text-2xl font-bold" dir="ltr" inputMode="numeric" value={count} onChange={(e) => setCount(Math.max(1, Math.min(5000, Math.round(num(e.target.value) || 1))))} aria-label={tr("العدد", "Count")} />
            <button className="btn h-14 w-14 text-2xl" onClick={() => setCount((c) => Math.min(5000, c + 1))} aria-label="+1">
              +
            </button>
            {[5, 10, 20].map((n) => (
              <button key={n} className="btn h-14" onClick={() => setCount(n)}>
                <span className="num">{n}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {product && (
        <section>
          <h2 className="mb-2 font-semibold">{tr("٣. وين حطّيتها؟", "3. Where did it go?")}</h2>
          <div className="flex flex-wrap gap-2">
            <button className={`btn min-h-[48px] ${loc === "" ? "btn-primary" : ""}`} onClick={() => setLoc("")}>
              {tr("البرّاد الافتراضي", "Default fridge")}
            </button>
            {fridgePlaces.map((p) => (
              <button key={p.loc.id} className={`btn min-h-[48px] ${loc === p.loc.id ? "btn-primary" : ""}`} onClick={() => setLoc(p.loc.id)}>
                {pick(p.wh)} · {pick(p.loc)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">{tr("المكوّنات بتنسحب من المخزن حسب الوصفة، وبتنطلع دفعة جديدة بتاريخ انتهاء.", "Ingredients are taken from stock by the recipe, and a new batch with an expiry date is created.")}</p>
          <button className="btn btn-primary mt-4 min-h-[56px] w-full text-lg sm:w-auto sm:px-10" disabled={busy} onClick={make}>
            {tr(`سجّل ${count} × ${pick(product)}`, `Record ${count} × ${pick(product)}`)}
          </button>
        </section>
      )}
    </div>
  );
}

/* ---------- items ---------- */

const KIND_LABEL: Record<StockItem["kind"], { ar: string; en: string }> = { ingredient: { ar: "مكوّن", en: "Ingredient" }, packaging: { ar: "تغليف", en: "Packaging" }, product: { ar: "منتج جاهز", en: "Ready product" } };

function ItemDialog({ item, onClose, onSaved }: { item: StockItem | null; onClose: () => void; onSaved: () => void }) {
  const { tr, pick, lang, t } = useI18n();
  const { can } = useAuth();
  const { errors, busy, run } = useSaver();
  const isProduct = item?.kind === "product";
  const [f, setF] = useState({
    kind: (item?.kind === "product" ? "ingredient" : item?.kind) ?? ("ingredient" as "ingredient" | "packaging"),
    nameAr: item?.nameAr ?? "",
    nameEn: item?.nameEn ?? "",
    unitCode: item?.unitCode ?? ("kg" as StockItem["unitCode"]),
    minLevel: String(item?.minLevel ?? 0),
    avgCostUsd: String(item?.avgCostUsd ?? 0),
    active: item?.active ?? true,
  });
  const save = async () => {
    const body = isProduct ? { minLevel: num(f.minLevel) || 0 } : { kind: f.kind, nameAr: f.nameAr, nameEn: f.nameEn, unitCode: f.unitCode, minLevel: num(f.minLevel) || 0, avgCostUsd: num(f.avgCostUsd) || 0, active: f.active };
    if (await run(() => (item ? put(`/stock/items/${item.id}`, body) : post("/stock/items", body)))) onSaved();
  };
  return (
    <ActionDialog title={item ? (isProduct ? pick(item) : tr("تعديل مادة", "Edit item")) : tr("مادة جديدة", "New item")} onClose={onClose} onSave={save} busy={busy} disabled={!isProduct && (!f.nameAr || !f.nameEn)}>
      {!isProduct && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("النوع", "Kind")} htmlFor="i-kind">
              <Select id="i-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>
                <option value="ingredient">{pick(KIND_LABEL.ingredient)}</option>
                <option value="packaging">{pick(KIND_LABEL.packaging)}</option>
              </Select>
            </Field>
            <Field label={tr("الوحدة", "Unit")} htmlFor="i-unit">
              <Select id="i-unit" value={f.unitCode} onChange={(e) => setF({ ...f, unitCode: e.target.value as StockItem["unitCode"] })}>
                {(["kg", "g", "l", "ml", "pc"] as const).map((u) => (
                  <option key={u} value={u}>
                    {unitOf(u, lang)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <NameFields f={f} set={setF} errors={errors} idp="i" />
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("الحد الأدنى (تنبيه)", "Minimum (alert)")} htmlFor="i-min" error={errors.minLevel} hint={tr("0 = بلا تنبيه", "0 = no alert")}>
          <NumInput id="i-min" value={f.minLevel} onChange={(v) => setF({ ...f, minLevel: v })} />
        </Field>
        {!isProduct && can("costing", "see_cost") && (
          <Field label={tr("كلفة الوحدة $", "Unit cost $")} htmlFor="i-cost" hint={tr("بتتحدث تلقائياً مع المشتريات", "Updates itself with purchases")}>
            <NumInput id="i-cost" value={f.avgCostUsd} onChange={(v) => setF({ ...f, avgCostUsd: v })} />
          </Field>
        )}
      </div>
      {!isProduct && (
        <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
          {t("common.active")}
        </Check>
      )}
    </ActionDialog>
  );
}

function ReceiveDialog({ item, onClose, onSaved }: { item: StockItem; onClose: () => void; onSaved: () => void }) {
  const { tr, pick, lang } = useI18n();
  const { can } = useAuth();
  const places = usePlaces();
  const { busy, run } = useSaver();
  const [f, setF] = useState({ qty: "", loc: "", cost: String(item.avgCostUsd), expires: "" });
  const save = async () => {
    const body = { itemId: item.id, locationId: f.loc, qty: num(f.qty), unitCostUsd: can("costing", "see_cost") ? num(f.cost) || 0 : undefined, expiresAt: f.expires ? new Date(`${f.expires}T23:59:00`).toISOString() : null };
    if (await run(() => post("/stock/receive", body), tr("انضاف للمخزن.", "Added to stock."))) onSaved();
  };
  return (
    <ActionDialog title={`${tr("استلام", "Receive")}: ${pick(item)}`} onClose={onClose} onSave={save} busy={busy} disabled={!(num(f.qty) > 0) || !f.loc}>
      <p className="text-sm text-muted">{tr("للبضاعة بلا فاتورة شراء (رصيد أول مدة، هدية…). المشتريات العادية سجّلها من «المشتريات».", "For stock without a purchase invoice (opening stock, a gift…). Normal buying goes in Purchasing.")}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${tr("الكمية", "Quantity")} (${unitOf(item.unitCode, lang)})`} htmlFor="r-qty">
          <NumInput id="r-qty" value={f.qty} onChange={(v) => setF({ ...f, qty: v })} />
        </Field>
        {can("costing", "see_cost") && (
          <Field label={tr("كلفة الوحدة $", "Unit cost $")} htmlFor="r-cost">
            <NumInput id="r-cost" value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
          </Field>
        )}
      </div>
      <Field label={tr("المكان", "Place")} htmlFor="r-loc">
        <PlaceSelect id="r-loc" value={f.loc} onChange={(v) => setF({ ...f, loc: v })} places={places.list} />
      </Field>
      <Field label={tr("تاريخ الانتهاء", "Expiry date")} htmlFor="r-exp" hint={tr("اختياري", "Optional")}>
        <TextInput id="r-exp" type="date" dir="ltr" min={today()} value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />
      </Field>
    </ActionDialog>
  );
}

function CountItemDialog({ item, onClose, onSaved }: { item: StockItem; onClose: () => void; onSaved: () => void }) {
  const { tr, pick, lang } = useI18n();
  const { busy, run } = useSaver();
  const [c, setC] = useState(String(item.qty < 0 ? 0 : item.qty));
  const save = async () => {
    if (await run(() => post("/stock/count", { itemId: item.id, counted: num(c) }), tr("انحفظ الجرد.", "Count saved."))) onSaved();
  };
  return (
    <ActionDialog title={`${tr("جرد", "Count")}: ${pick(item)}`} onClose={onClose} onSave={save} busy={busy} disabled={!(num(c) >= 0)}>
      <p className="text-sm text-muted">
        {tr("بالنظام:", "In the system:")} <Q v={item.qty} unit={item.unitCode} />
      </p>
      <Field label={`${tr("الموجود فعلاً", "Really there")} (${unitOf(item.unitCode, lang)})`} htmlFor="ci-qty">
        <NumInput id="ci-qty" value={c} onChange={setC} />
      </Field>
    </ActionDialog>
  );
}

function ItemsTab() {
  const { tr, pick } = useI18n();
  const { can } = useAuth();
  const seeCost = can("costing", "see_cost");
  const items = useData<{ rows: StockItem[] }>("/stock/items");
  const [kind, setKind] = useState<"" | StockItem["kind"]>("");
  const [lowOnly, setLowOnly] = useState(false);
  const [dlg, setDlg] = useState<{ t: "edit" | "receive" | "count"; item: StockItem } | "new" | null>(null);
  const [toDelete, setToDelete] = useState<StockItem | null>(null);
  if (!items.data) return <Spinner />;
  const rows = items.data.rows.filter((i) => (!kind || i.kind === kind) && (!lowOnly || i.low));
  const reload = () => void items.reload();
  const done = () => {
    setDlg(null);
    reload();
  };
  const total = rows.reduce((s, i) => s + i.valueUsd, 0);
  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.nameAr} ${r.nameEn}`}
        pageSize={25}
        toolbar={
          <>
            <Select aria-label={tr("النوع", "Kind")} className="!w-auto" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="">{tr("كل المواد", "All items")}</option>
              {(Object.keys(KIND_LABEL) as StockItem["kind"][]).map((k) => (
                <option key={k} value={k}>
                  {pick(KIND_LABEL[k])}
                </option>
              ))}
            </Select>
            <Check checked={lowOnly} onChange={setLowOnly}>
              {tr("الناقص فقط", "Low only")}
            </Check>
            {can("warehouse", "create") && (
              <button className="btn btn-primary" onClick={() => setDlg("new")}>
                {tr("+ مادة", "+ Item")}
              </button>
            )}
          </>
        }
        columns={[
          {
            key: "name",
            header: tr("المادة", "Item"),
            render: (i) => (
              <div className={i.active ? "" : "opacity-60"}>
                <div className="font-semibold">{pick(i)}</div>
                <div className="text-xs text-faint">{pick(KIND_LABEL[i.kind])}</div>
              </div>
            ),
            sortValue: (i) => pick(i),
          },
          {
            key: "qty",
            header: tr("الموجود", "In stock"),
            align: "end",
            render: (i) => (
              <span className={i.low || i.qty < 0 ? "font-semibold text-bad" : ""}>
                <Q v={i.qty} unit={i.unitCode} />
              </span>
            ),
            sortValue: (i) => i.qty,
          },
          { key: "min", header: tr("الحد الأدنى", "Minimum"), align: "end", render: (i) => (i.minLevel ? <Q v={i.minLevel} unit={i.unitCode} /> : "—"), sortValue: (i) => i.minLevel },
          ...(seeCost
            ? [
                { key: "cost", header: tr("كلفة الوحدة", "Unit cost"), align: "end" as const, render: (i: StockItem) => <span className="num ltr">{usd(i.avgCostUsd)}</span>, sortValue: (i: StockItem) => i.avgCostUsd },
                { key: "val", header: tr("القيمة", "Value"), align: "end" as const, render: (i: StockItem) => <span className="num ltr">{usd(i.valueUsd)}</span>, sortValue: (i: StockItem) => i.valueUsd },
              ]
            : []),
          {
            key: "a",
            header: "",
            render: (i) => (
              <RowActions
                canEdit={can("warehouse", "edit")}
                canDelete={can("warehouse", "delete") && i.kind !== "product"}
                onEdit={() => setDlg({ t: "edit", item: i })}
                onDelete={() => setToDelete(i)}
                extra={
                  <>
                    {can("warehouse", "create") && i.kind !== "product" && (
                      <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setDlg({ t: "receive", item: i })}>
                        {tr("استلام", "Receive")}
                      </button>
                    )}
                    {can("warehouse", "edit") && (
                      <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setDlg({ t: "count", item: i })}>
                        {tr("جرد", "Count")}
                      </button>
                    )}
                  </>
                }
              />
            ),
          },
        ]}
      />
      {seeCost && (
        <p className="mt-2 text-sm text-muted">
          {tr("قيمة المعروض:", "Value shown:")} <span className="num ltr font-semibold text-ink">{usd(total)}</span>
        </p>
      )}
      {dlg === "new" && <ItemDialog item={null} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg && dlg !== "new" && dlg.t === "edit" && <ItemDialog item={dlg.item} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg && dlg !== "new" && dlg.t === "receive" && <ReceiveDialog item={dlg.item} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg && dlg !== "new" && dlg.t === "count" && <CountItemDialog item={dlg.item} onClose={() => setDlg(null)} onSaved={done} />}
      {toDelete && <DeleteConfirm name={pick(toDelete)} path={`/stock/items/${toDelete.id}`} onClose={() => setToDelete(null)} onDone={reload} />}
    </>
  );
}

/* ---------- moves ---------- */

const MOVE_TYPE: Record<string, { ar: string; en: string }> = {
  purchase: { ar: "شراء", en: "Purchase" },
  production: { ar: "تحضير", en: "Made" },
  use: { ar: "استهلاك بالوصفة", en: "Used in recipe" },
  sale: { ar: "بيع", en: "Sale" },
  transfer: { ar: "نقل", en: "Move" },
  waste: { ar: "هدر", en: "Waste" },
  count: { ar: "جرد", en: "Count" },
  adjust: { ar: "استلام / تعديل", en: "Received / adjust" },
};
interface Move {
  id: string;
  itemId: string;
  type: string;
  qty: number;
  unitCostUsd: number;
  refType: string | null;
  note: string | null;
  businessDate: string;
  createdAt?: string;
  nameAr: string;
  nameEn: string;
  unitCode: string;
  batchCode: string | null;
}

function MovesTab() {
  const { tr, pick } = useI18n();
  const { can } = useAuth();
  const items = useData<{ rows: StockItem[] }>("/stock/items");
  const [f, setF] = useState({ itemId: "", type: "", from: addDaysTo(today(), -7), to: today() });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const moves = useData<{ rows: Move[] }>(`/stock/moves?${qs}`);
  const seeCost = can("costing", "see_cost");
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select aria-label={tr("المادة", "Item")} className="!w-auto" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
          <option value="">{tr("كل المواد", "All items")}</option>
          {(items.data?.rows ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {pick(i)}
            </option>
          ))}
        </Select>
        <Select aria-label={tr("النوع", "Type")} className="!w-auto" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="">{tr("كل الحركات", "All moves")}</option>
          {Object.entries(MOVE_TYPE).map(([k, v]) => (
            <option key={k} value={k}>
              {pick(v)}
            </option>
          ))}
        </Select>
        <TextInput type="date" dir="ltr" className="!w-auto" aria-label={tr("من", "From")} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <TextInput type="date" dir="ltr" className="!w-auto" aria-label={tr("إلى", "To")} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
      </div>
      {!moves.data ? (
        <Spinner />
      ) : (
        <DataTable
          rows={moves.data.rows}
          rowKey={(r) => r.id}
          pageSize={30}
          columns={[
            { key: "d", header: tr("التاريخ", "Date"), render: (m) => <span className="num ltr">{m.businessDate}</span> },
            { key: "i", header: tr("المادة", "Item"), render: (m) => <span className="font-semibold">{pick(m)}</span> },
            { key: "t", header: tr("الحركة", "Move"), render: (m) => <span className="chip">{MOVE_TYPE[m.type] ? pick(MOVE_TYPE[m.type]!) : m.type}</span> },
            {
              key: "q",
              header: tr("الكمية", "Qty"),
              align: "end",
              render: (m) => (
                <span className={m.qty < 0 ? "text-muted" : "font-semibold"}>
                  {m.qty > 0 ? "+" : ""}
                  <Q v={m.qty} unit={m.unitCode} />
                </span>
              ),
            },
            { key: "b", header: tr("الدفعة", "Batch"), render: (m) => <span className="num ltr text-xs text-muted">{m.batchCode ?? ""}</span> },
            ...(seeCost ? [{ key: "c", header: tr("القيمة", "Value"), align: "end" as const, render: (m: Move) => <span className="num ltr">{usd(Math.abs(m.qty) * m.unitCostUsd)}</span> }] : []),
            { key: "n", header: tr("ملاحظة", "Note"), render: (m) => <span className="text-xs text-muted">{m.note ?? ""}</span> },
          ]}
        />
      )}
      <p className="mt-2 text-xs text-faint">{tr("آخر 300 حركة ضمن الفلتر.", "Latest 300 moves within the filter.")}</p>
    </>
  );
}

/* ---------- places ---------- */

function WarehouseDialog({ wh, onClose, onSaved }: { wh: Warehouse | null; onClose: () => void; onSaved: () => void }) {
  const { tr, pick, t } = useI18n();
  const { errors, busy, run } = useSaver();
  const [f, setF] = useState({ nameAr: wh?.nameAr ?? "", nameEn: wh?.nameEn ?? "", kind: wh?.kind ?? ("fridge" as Warehouse["kind"]), sort: String(wh?.sort ?? 0), active: wh?.active ?? true });
  const save = async () => {
    const body = { ...f, sort: Math.round(num(f.sort) || 0) };
    if (await run(() => (wh ? put(`/stock/warehouses/${wh.id}`, body) : post("/stock/warehouses", body)))) onSaved();
  };
  return (
    <ActionDialog title={wh ? tr("تعديل مكان تخزين", "Edit storage") : tr("مكان تخزين جديد", "New storage")} onClose={onClose} onSave={save} busy={busy} disabled={!f.nameAr || !f.nameEn}>
      <NameFields f={f} set={setF} errors={errors} idp="wh" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("النوع", "Kind")} htmlFor="wh-kind">
          <Select id="wh-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Warehouse["kind"] })}>
            {(Object.keys(WH_KIND) as Warehouse["kind"][]).map((k) => (
              <option key={k} value={k}>
                {pick(WH_KIND[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.sort")} htmlFor="wh-sort">
          <NumInput id="wh-sort" step="1" value={f.sort} onChange={(v) => setF({ ...f, sort: v })} />
        </Field>
      </div>
      <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
        {t("common.active")}
      </Check>
    </ActionDialog>
  );
}

function LocationDialog({ warehouseId, loc, onClose, onSaved }: { warehouseId: string; loc: Location | null; onClose: () => void; onSaved: () => void }) {
  const { tr, t } = useI18n();
  const { errors, busy, run } = useSaver();
  const [f, setF] = useState({ nameAr: loc?.nameAr ?? "", nameEn: loc?.nameEn ?? "", active: loc?.active ?? true });
  const save = async () => {
    const body = { warehouseId, ...f };
    if (await run(() => (loc ? put(`/stock/locations/${loc.id}`, body) : post("/stock/locations", body)))) onSaved();
  };
  return (
    <ActionDialog title={loc ? tr("تعديل رف / مكان", "Edit shelf / spot") : tr("رف / مكان جديد", "New shelf / spot")} onClose={onClose} onSave={save} busy={busy} disabled={!f.nameAr || !f.nameEn}>
      <NameFields f={f} set={setF} errors={errors} idp="loc" />
      <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
        {t("common.active")}
      </Check>
    </ActionDialog>
  );
}

function PlacesTab() {
  const { tr, pick } = useI18n();
  const { can } = useAuth();
  const p = usePlaces();
  const [whDlg, setWhDlg] = useState<Warehouse | "new" | null>(null);
  const [locDlg, setLocDlg] = useState<{ wh: string; loc: Location | null } | null>(null);
  const [del, setDel] = useState<{ name: string; path: string } | null>(null);
  if (!p.ready) return <Spinner />;
  const reload = () => {
    void p.whs.reload();
    void p.locs.reload();
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-muted">{tr("البرّادات والمستودع، وجوّا كل واحد الرفوف والأماكن.", "Fridges and the store, and the shelves and spots inside each one.")}</p>
        {can("warehouse", "create") && (
          <button className="btn btn-primary" onClick={() => setWhDlg("new")}>
            {tr("+ برّاد / مستودع", "+ Fridge / store")}
          </button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {p.whs.data!.rows.map((w) => (
          <div key={w.id} className={`card p-0 ${w.active ? "" : "opacity-60"}`}>
            <div className="flex items-center gap-2 border-b border-line p-3">
              <div>
                <div className="font-bold">{pick(w)}</div>
                <div className="text-xs text-muted">{pick(WH_KIND[w.kind])}</div>
              </div>
              <div className="ms-auto">
                <RowActions
                  canEdit={can("warehouse", "edit")}
                  canDelete={can("warehouse", "delete")}
                  onEdit={() => setWhDlg(w)}
                  onDelete={() => setDel({ name: pick(w), path: `/stock/warehouses/${w.id}` })}
                  extra={
                    can("warehouse", "create") && (
                      <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setLocDlg({ wh: w.id, loc: null })}>
                        {tr("+ رف", "+ Shelf")}
                      </button>
                    )
                  }
                />
              </div>
            </div>
            {p.locs
              .data!.rows.filter((l) => l.warehouseId === w.id)
              .map((l) => (
                <div key={l.id} className={`flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0 ${l.active ? "" : "opacity-60"}`}>
                  <span>{pick(l)}</span>
                  <div className="ms-auto">
                    <RowActions canEdit={can("warehouse", "edit")} canDelete={can("warehouse", "delete")} onEdit={() => setLocDlg({ wh: w.id, loc: l })} onDelete={() => setDel({ name: pick(l), path: `/stock/locations/${l.id}` })} />
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
      {whDlg && (
        <WarehouseDialog
          wh={whDlg === "new" ? null : whDlg}
          onClose={() => setWhDlg(null)}
          onSaved={() => {
            setWhDlg(null);
            reload();
          }}
        />
      )}
      {locDlg && (
        <LocationDialog
          warehouseId={locDlg.wh}
          loc={locDlg.loc}
          onClose={() => setLocDlg(null)}
          onSaved={() => {
            setLocDlg(null);
            reload();
          }}
        />
      )}
      {del && <DeleteConfirm name={del.name} path={del.path} onClose={() => setDel(null)} onDone={reload} />}
    </>
  );
}

/* ---------- page ---------- */

export function WarehousePage() {
  const { tr } = useI18n();
  const { simple, can } = useAuth();
  const tabs = simple
    ? [
        { key: "fridge", label: tr("البرّاد", "Fridge") },
        ...(can("warehouse", "create") ? [{ key: "produce", label: tr("تحضير وملصقات", "Make & label") }, { key: "waste", label: tr("هدر", "Waste") }] : []),
      ]
    : [
        { key: "fridge", label: tr("البرّاد والمخزن", "Fridge & stock") },
        ...(can("warehouse", "create") ? [{ key: "produce", label: tr("تحضير", "Make") }] : []),
        { key: "items", label: tr("المواد", "Items") },
        { key: "moves", label: tr("الحركات", "Moves") },
        { key: "places", label: tr("الأماكن", "Places") },
      ];
  return (
    <>
      <PageHeader
        title={tr("المخزن", "Warehouse")}
        subtitle={simple ? undefined : tr("الدفعات بتواريخ الانتهاء، التحضير والملصقات، الهدر والجرد.", "Batches with expiry dates, making and labels, waste and counts.")}
      />
      <Tabs base="/warehouse" tabs={tabs} />
      <Routes>
        <Route index element={<Navigate to="fridge" replace />} />
        <Route path="fridge" element={<FridgeTab />} />
        <Route path="produce" element={<MakeTab />} />
        <Route path="waste" element={<FridgeTab wasteMode />} />
        {!simple && <Route path="items" element={<ItemsTab />} />}
        {!simple && <Route path="moves" element={<MovesTab />} />}
        {!simple && <Route path="places" element={<PlacesTab />} />}
        <Route path="*" element={<Navigate to="fridge" replace />} />
      </Routes>
    </>
  );
}
