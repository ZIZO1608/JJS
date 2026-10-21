import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Empty, Field, Modal, Select, Spinner, TextInput } from "../../components/ui";
import { get, post } from "../../lib/api";
import { useAppSettings } from "../../lib/appSettings";
import { useAuth } from "../../lib/auth";
import { money, num, usd, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { openPrint } from "../../lib/print";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import type { Catalog, CatalogProduct, ClientSummary, Employee, OptionGroup, PaymentMethod } from "../../lib/types";
import { discountWords, type AppliedTax } from "./shared";

type WhoKind = "walkin" | "client" | "trial" | "staff" | "internal";
interface CartLine {
  key: string;
  productId: string;
  qty: number;
  optionIds: string[];
}
interface Quote {
  empty?: boolean;
  currency: Currency;
  rate: number | null;
  client: { id: string; name: string; creditLimitUsd: number; creditBlock: boolean; balanceUsd: number | null } | null;
  lines: {
    productId: string;
    nameAr: string;
    nameEn: string;
    qty: number;
    freeQty: number;
    unitPrice: number;
    lineTotal: number;
    specialPrice: boolean;
    priceFrom?: "menu" | "list" | "client" | "agreed";
    options: { id: string; nameAr: string; nameEn: string }[];
  }[];
  subtotal: number;
  discount: number;
  discountPct: number;
  discountReason: string;
  freeItems: number;
  subFree: number;
  loyaltyFree: number;
  taxes: AppliedTax[];
  taxTotal: number;
  deliveryFee: number;
  total: number;
  totalUsd: number;
  itemsCount: number;
  loyalty: { enabled: boolean; buyQty: number; freeQty: number; count: number; progress: number; available: number } | null;
  subscription: { planNameAr: string; planNameEn: string; availableIncluded: number; endDate: string } | null;
}
interface DueRow {
  id: string;
  clientId: string;
  lines: { productId: string; qty: number; optionIds?: string[] }[];
}

interface Snapshot {
  client: { id: string; name: string; phone: string; creditLimitUsd: number; consignment: boolean; paymentTermsDays: number };
  lastOrder: { id: string; number: number; date: string; total: number; currency: Currency; items: number } | null;
  aging: { balanceUsd: number; overdueDays: number; daysOutstanding: number; termsDays: number };
  month: { orders: number; salesUsd: number; items: number };
  tier: { nameAr: string; nameEn: string; discountPct: number } | null;
  agreedPrices: { productId: string }[];
  openConsignments: number;
}

/** What you need to know the moment a shop is picked: last order, debt, late or not, agreed prices. */
function SnapshotCard({ clientId }: { clientId: string }) {
  const { tr, fmtDate, lang, pick } = useI18n();
  const snap = useData<Snapshot>(`/clients/${clientId}/snapshot`);
  const d = snap.data;
  if (!d) return null;
  const owes = d.aging.balanceUsd < -0.009;
  return (
    <div className="card mb-3 grid gap-1 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{d.client.name}</span>
        <span className={`num ltr font-bold ${owes ? "text-bad" : ""}`}>
          {owes
            ? `${tr("عليه", "Owes")} ${usd(-d.aging.balanceUsd)}`
            : d.aging.balanceUsd > 0.009
              ? `${tr("له", "Credit")} ${usd(d.aging.balanceUsd)}`
              : tr("ما عليه شي", "Nothing owed")}
        </span>
      </div>
      {d.aging.overdueDays > 0 && <div className="font-semibold text-bad">{tr(`متأخر بالدفع ${d.aging.overdueDays} يوم`, `${d.aging.overdueDays} days late paying`)}</div>}
      <div className="text-muted">
        {tr("آخر طلب", "Last order")}:{" "}
        {d.lastOrder ? (
          <>
            {fmtDate(d.lastOrder.date)} · <span className="num ltr">{money(d.lastOrder.total, d.lastOrder.currency, lang)}</span>
          </>
        ) : (
          "—"
        )}
      </div>
      <div className="text-muted">
        {tr("هالشهر", "This month")}: <span className="num ltr">{usd(d.month.salesUsd)}</span> · <span className="num">{d.month.items}</span> {tr("قطعة", "pcs")}
      </div>
      {(d.agreedPrices.length > 0 || d.tier) && (
        <div className="text-muted">
          {d.agreedPrices.length > 0 && tr(`${d.agreedPrices.length} سعر متفق عليه`, `${d.agreedPrices.length} agreed prices`)}
          {d.agreedPrices.length > 0 && d.tier && " · "}
          {d.tier && `${pick(d.tier)} ${d.tier.discountPct}%`}
        </div>
      )}
      {d.openConsignments > 0 && <div className="text-muted">{tr(`عنده ${d.openConsignments} بضاعة بالأمانة`, `${d.openConsignments} open consignment(s)`)}</div>}
    </div>
  );
}

const keyOf = (productId: string, optionIds: string[]) => `${productId}|${[...optionIds].sort().join(",")}`;

const readAutoPrint = () => {
  try {
    return localStorage.getItem("jjs.autoPrint") === "1";
  } catch {
    return false;
  }
};
const writeAutoPrint = (v: boolean) => {
  try {
    localStorage.setItem("jjs.autoPrint", v ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
};

/** Big choice button used across the 3 steps. */
function Choice({ active, onClick, children, big, disabled }: { active?: boolean; onClick: () => void; children: ReactNode; big?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border text-start font-semibold transition active:scale-[.98] disabled:opacity-40 ${big ? "min-h-[64px] px-4 py-3 text-lg" : "px-3 py-2"} ${
        active ? "border-ink bg-ink text-bg" : "border-line bg-surface hover:border-ink"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------------- add-ons dialog ---------------- */
function AddonsDialog({
  product,
  groups,
  onClose,
  onAdd,
}: {
  product: CatalogProduct;
  groups: OptionGroup[];
  onClose: () => void;
  onAdd: (optionIds: string[], qty: number) => void;
}) {
  const { tr, pick, lang } = useI18n();
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [q, setQ] = useState(1);
  const toggle = (g: OptionGroup, id: string) =>
    setSel((s) => {
      const cur = s[g.id] ?? [];
      if (cur.includes(id)) return { ...s, [g.id]: cur.filter((x) => x !== id) };
      if (g.maxSelect === 1) return { ...s, [g.id]: [id] };
      if (cur.length >= g.maxSelect) return s;
      return { ...s, [g.id]: [...cur, id] };
    });
  const missing = groups.filter((g) => (sel[g.id]?.length ?? 0) < g.minSelect);
  return (
    <Modal
      title={pick(product)}
      onClose={onClose}
      wide
      footer={
        <>
          <div className="me-auto flex items-center gap-2">
            <button className="btn h-11 w-11 p-0 text-xl" onClick={() => setQ(Math.max(1, q - 1))} aria-label="−">
              −
            </button>
            <span className="num w-10 text-center text-xl font-bold">{q}</span>
            <button className="btn h-11 w-11 p-0 text-xl" onClick={() => setQ(q + 1)} aria-label="+">
              +
            </button>
          </div>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary px-6" disabled={missing.length > 0} onClick={() => onAdd(Object.values(sel).flat(), q)}>
            {tr("أضف للطلب", "Add to order")}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        {groups.map((g) => {
          const cur = sel[g.id] ?? [];
          return (
            <div key={g.id}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="font-semibold">{pick(g)}</h3>
                <span className="text-xs text-faint">
                  {g.minSelect > 0 ? tr(`اختر ${g.minSelect} على الأقل`, `choose at least ${g.minSelect}`) : tr("اختياري", "optional")}
                  {g.maxSelect > 0 && ` · ${tr("حتى", "up to")} ${g.maxSelect}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {g.options
                  .filter((o) => o.active)
                  .map((o) => (
                    <Choice key={o.id} active={cur.includes(o.id)} onClick={() => toggle(g, o.id)}>
                      {pick(o)}
                      {o.priceDelta !== 0 && (
                        <span className="ms-2 text-sm font-normal opacity-75">
                          <span className="num ltr">
                            {o.priceDelta > 0 ? "+" : ""}
                            {money(o.priceDelta, o.currency, lang)}
                          </span>
                        </span>
                      )}
                    </Choice>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* ---------------- quick new client (for trials) ---------------- */
function NewClientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: ClientSummary) => void }) {
  const { tr, err } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ name: "", contactPerson: "", phone: "", type: "business" as "business" | "individual" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ row: ClientSummary }>("/clients", f);
      onCreated(r.row);
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={tr("زبون جديد", "New client")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" disabled={!f.name.trim() || busy} onClick={save}>
            {tr("حفظ واختيار", "Save & choose")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex gap-2">
          <Choice active={f.type === "business"} onClick={() => setF({ ...f, type: "business" })}>
            {tr("محل / شركة", "Business")}
          </Choice>
          <Choice active={f.type === "individual"} onClick={() => setF({ ...f, type: "individual" })}>
            {tr("شخص", "Person")}
          </Choice>
        </div>
        <Field label={tr("الاسم", "Name")} htmlFor="nc-name">
          <TextInput id="nc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        {f.type === "business" && (
          <Field label={tr("الشخص المسؤول", "Contact person")} htmlFor="nc-cp">
            <TextInput id="nc-cp" value={f.contactPerson} onChange={(e) => setF({ ...f, contactPerson: e.target.value })} />
          </Field>
        )}
        <Field label={tr("الهاتف", "Phone")} htmlFor="nc-ph">
          <TextInput id="nc-ph" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------- the page ---------------- */
export function NewOrderPage() {
  const { tr, pick, lang, err } = useI18n();
  const { can, simple } = useAuth();
  const { s: settings } = useAppSettings();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const canClients = can("clients", "view");
  const canStaff = can("people", "view");
  const catalog = useData<Catalog>("/menu/catalog");
  const clientsQ = useData<{ rows: ClientSummary[] }>(canClients ? "/clients" : null);
  const employeesQ = useData<{ rows: Employee[] }>(canStaff ? "/people/employees" : null);
  const methodsQ = useData<{ rows: PaymentMethod[] }>("/money/methods");
  const repsQ = useData<{ rows: { id: string; name: string }[] }>("/money/reps");

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [who, setWho] = useState<WhoKind>("walkin");
  const [clientId, setClientId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [newClient, setNewClient] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cat, setCat] = useState<string>("all");
  const [scan, setScan] = useState("");
  const [addonsFor, setAddonsFor] = useState<CatalogProduct | null>(null);
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">("pickup");
  const [fee, setFee] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [methodId, setMethodId] = useState<string | null>(null);
  const [manualPct, setManualPct] = useState("");
  const [useLoyalty, setUseLoyalty] = useState(true);
  const [note, setNote] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ id: string; number: number; total: number; currency: Currency; status: string } | null>(null);
  const [autoPrint, setAutoPrint] = useState(readAutoPrint);
  const scanRef = useRef<HTMLInputElement>(null);

  const products = useMemo(() => (catalog.data?.products ?? []).filter((p) => p.active), [catalog.data]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const optionById = useMemo(() => new Map((catalog.data?.groups ?? []).flatMap((g) => g.options.map((o) => [o.id, o] as const))), [catalog.data]);
  const groupsFor = useCallback((p: CatalogProduct) => (catalog.data?.groups ?? []).filter((g) => p.groupIds.includes(g.id) && g.options.some((o) => o.active)), [catalog.data]);
  const client = clientsQ.data?.rows.find((c) => c.id === clientId) ?? null;
  const employee = employeesQ.data?.rows.find((e) => e.id === employeeId) ?? null;
  const methods = (methodsQ.data?.rows ?? []).filter((m) => m.active);

  /* ----- preload from ?client= or ?recurring= ----- */
  const preloaded = useRef(false);
  useEffect(() => {
    if (preloaded.current) return;
    const cid = params.get("client");
    const rid = params.get("recurring");
    if (cid) {
      preloaded.current = true;
      setWho("client");
      setClientId(cid);
      setStep(2);
    } else if (rid) {
      preloaded.current = true;
      void (async () => {
        try {
          const r = await get<{ rows: DueRow[] }>("/orders/recurring/due");
          const row = r.rows.find((x) => x.id === rid);
          if (!row) return;
          setWho("client");
          setClientId(row.clientId);
          setCart(row.lines.map((l) => ({ key: keyOf(l.productId, l.optionIds ?? []), productId: l.productId, qty: l.qty, optionIds: l.optionIds ?? [] })));
          setStep(2);
        } catch (e) {
          toast(err(e), "error");
        }
      })();
    }
  }, [params, toast, err]);

  /* ----- default payment method ----- */
  useEffect(() => {
    if (!methods.length) return;
    const valid = (m: PaymentMethod) => (m.kind === "credit" ? !!clientId && who !== "staff" : m.kind === "salary" ? who === "staff" : true);
    const cur = methods.find((m) => m.id === methodId);
    if (cur && valid(cur)) return;
    const def = who === "staff" ? methods.find((m) => m.kind === "salary") : (methods.find((m) => m.systemKey === "cash") ?? methods.find((m) => m.kind === "box"));
    setMethodId(def?.id ?? null);
  }, [methods, who, clientId, methodId]);

  /* ----- live quote ----- */
  const noPay = who === "trial" || who === "internal";
  const methodKind = methods.find((m) => m.id === methodId)?.kind;
  const paidValue = !noPay && methodKind === "box" && paidNow.trim() !== "" && !Number.isNaN(num(paidNow)) ? Math.max(0, num(paidNow)) : null;
  const payload = useMemo(
    () => ({
      clientId: who === "client" || who === "trial" ? clientId : null,
      type: who === "trial" ? "trial" : who === "staff" ? "staff" : who === "internal" ? "internal" : "normal",
      employeeId: who === "staff" ? employeeId : null,
      fulfilment: who === "internal" ? "pickup" : fulfilment,
      deliveryFee: fulfilment === "delivery" && fee !== "" && !Number.isNaN(num(fee)) ? num(fee) : null,
      assignedTo: fulfilment === "delivery" && assignedTo ? assignedTo : null,
      methodId: noPay ? null : methodId,
      ...(can("orders", "edit") && !noPay && manualPct !== "" && num(manualPct) > 0 ? { manualDiscountPct: Math.min(100, num(manualPct)) } : {}),
      ...(paidValue !== null ? { paidAmount: paidValue } : {}),
      useLoyalty,
      note: note.trim() || undefined,
      lines: cart.map((l) => ({ productId: l.productId, qty: l.qty, optionIds: l.optionIds })),
    }),
    [who, clientId, employeeId, fulfilment, fee, assignedTo, methodId, manualPct, useLoyalty, note, cart, can, noPay, paidValue],
  );
  useEffect(() => {
    if (!cart.length) {
      setQuote(null);
      setQuoteErr("");
      return;
    }
    if (who === "staff" && !employeeId) return;
    const h = setTimeout(async () => {
      try {
        const q = await post<Quote>("/orders/quote", payload);
        setQuote(q.empty ? null : q);
        setQuoteErr("");
      } catch (e) {
        setQuoteErr(err(e));
      }
    }, 220);
    return () => clearTimeout(h);
  }, [payload, cart.length, who, employeeId, err]);

  /* ----- cart actions ----- */
  const addLine = (productId: string, optionIds: string[], qty = 1) => {
    const key = keyOf(productId, optionIds);
    setCart((c) => (c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: Math.min(1000, l.qty + qty) } : l)) : [...c, { key, productId, qty, optionIds }]));
  };
  const tapProduct = (p: CatalogProduct) => {
    if (groupsFor(p).length) setAddonsFor(p);
    else addLine(p.id, []);
  };
  const setQty = (key: string, q: number) => setCart((c) => (q <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, qty: Math.min(1000, q) } : l))));
  const onScan = () => {
    const code = scan.trim().toUpperCase();
    if (!code) return;
    const p = products.find((x) => x.code.toUpperCase() === code);
    if (p) {
      tapProduct(p);
      setScan("");
    } else toast(tr(`ما في منتج بالكود ${code}`, `No product with code ${code}`), "error");
  };
  useEffect(() => {
    if (step === 2 && !simple) scanRef.current?.focus();
  }, [step, simple]);

  /* ----- confirm ----- */
  const confirm = async () => {
    setSaving(true);
    try {
      const r = await post<{ id: string; number: number; receipt: { order: { total: number; currency: Currency; paymentStatus: string } } }>("/orders", payload);
      setDone({ id: r.id, number: r.number, total: r.receipt.order.total, currency: r.receipt.order.currency, status: r.receipt.order.paymentStatus });
      setStep(4);
      if (autoPrint) openPrint(`/print/receipt/${r.id}`);
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setSaving(false);
    }
  };
  const reset = () => {
    setStep(1);
    setWho("walkin");
    setClientId(null);
    setEmployeeId(null);
    setCart([]);
    setFulfilment("pickup");
    setFee("");
    setAssignedTo("");
    setManualPct("");
    setUseLoyalty(true);
    setNote("");
    setPaidNow("");
    setQuote(null);
    setDone(null);
    nav("/orders/new", { replace: true });
  };

  if (!catalog.data || !methodsQ.data) return catalog.error ? <p className="text-bad">{err(catalog.error)}</p> : <Spinner />;

  /* ----- done screen ----- */
  if (step === 4 && done) {
    return (
      <div className="mx-auto max-w-md py-8 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-ink text-3xl text-bg">✓</div>
        <h1 className="text-2xl font-bold">
          {tr("تم تسجيل الطلب", "Order saved")} <span className="num">#{done.number}</span>
        </h1>
        <p className="mt-2 text-xl">
          <span className="num ltr font-bold">{money(done.total, done.currency, lang)}</span>
        </p>
        <div className="mt-6 grid gap-3">
          <button className="btn btn-primary min-h-[60px] text-lg" onClick={() => openPrint(`/print/receipt/${done.id}`)}>
            {tr("طباعة الفاتورة", "Print receipt")}
          </button>
          {!simple && (
            <button className="btn" onClick={() => openPrint(`/print/receipt/${done.id}?size=a4`)}>
              {tr("فاتورة A4", "A4 invoice")}
            </button>
          )}
          <button className="btn min-h-[60px] text-lg" onClick={reset}>
            {tr("طلب جديد", "New order")}
          </button>
          <Link to="/orders" className="btn btn-ghost">
            {tr("طلبات اليوم", "Today's orders")}
          </Link>
        </div>
      </div>
    );
  }

  const whoName =
    who === "walkin"
      ? tr("زبون عابر", "Walk-in")
      : who === "internal"
        ? tr("تذوّق / استهلاك داخلي", "Tasting / internal use")
        : who === "staff"
          ? (employee?.name ?? tr("موظف", "Staff"))
          : `${client?.name ?? "…"}${who === "trial" ? ` · ${tr("تجربة مجانية", "free trial")}` : ""}`;
  const whoReady = who === "walkin" || who === "internal" || ((who === "client" || who === "trial") && !!clientId) || (who === "staff" && !!employeeId);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const cur = quote?.currency ?? settings?.defaultCurrency ?? "USD";

  /* ----- credit warning ----- */
  const method = methods.find((m) => m.id === methodId);
  let creditWarn = "";
  if (quote?.client && method?.kind === "credit" && quote.client.creditLimitUsd > 0) {
    const after = (quote.client.balanceUsd ?? 0) - quote.totalUsd;
    if (-after > quote.client.creditLimitUsd + 0.001)
      creditWarn = quote.client.creditBlock
        ? tr("هذا الطلب يتجاوز حد الدين للزبون وسيُرفض.", "This order passes the client's credit limit and will be refused.")
        : tr("تنبيه: هذا الطلب يتجاوز حد الدين للزبون.", "Warning: this order passes the client's credit limit.");
  }

  const stepTab = (n: 1 | 2 | 3, label: string) => (
    <button
      key={n}
      type="button"
      disabled={n > 1 && !whoReady}
      onClick={() => (n === 3 && !cart.length ? undefined : setStep(n))}
      className={`flex flex-1 items-center gap-2 rounded-xl px-3 py-2 text-start ${step === n ? "bg-ink text-bg" : "bg-sunken text-muted"}`}
    >
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${step === n ? "bg-bg text-ink" : "bg-surface"}`}>{n}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {n === 1 && step !== 1 && <span className="block truncate text-xs opacity-75">{whoName}</span>}
        {n === 2 && step !== 2 && cartCount > 0 && (
          <span className="block text-xs opacity-75">
            <span className="num">{cartCount}</span> {tr("قطعة", "items")}
          </span>
        )}
      </span>
    </button>
  );

  /* ----- order summary (cart + totals) ----- */
  const renderSummary = (editable: boolean) => (
    <div className="card">
      <h2 className="mb-2 flex items-center justify-between font-semibold">
        <span>{tr("الطلب", "Order")}</span>
        <span className="text-sm font-normal text-muted">{whoName}</span>
      </h2>
      {cart.length === 0 ? (
        <Empty text={tr("اضغط على المنتجات لإضافتها", "Tap products to add them")} />
      ) : (
        <ul className="divide-y divide-line">
          {cart.map((l, i) => {
            const p = productById.get(l.productId);
            const ql = quote?.lines[i];
            return (
              <li key={l.key} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{p ? pick(p) : "?"}</div>
                  {l.optionIds.length > 0 && (
                    <div className="text-xs text-muted">
                      {l.optionIds
                        .map((id) => optionById.get(id))
                        .filter(Boolean)
                        .map((o) => pick(o!))
                        .join("، ")}
                    </div>
                  )}
                  {ql && ql.freeQty > 0 && (
                    <div className="text-xs text-good">
                      {tr("مجاني", "Free")} ×{ql.freeQty}
                    </div>
                  )}
                  {ql?.priceFrom === "list" && <div className="text-xs text-muted">{tr("سعر القائمة", "Price list")}</div>}
                  {ql?.priceFrom === "client" && <div className="text-xs text-muted">{tr("سعر خاص للزبون", "Client's special price")}</div>}
                </div>
                {editable ? (
                  <div className="flex items-center gap-1">
                    <button className={`btn p-0 ${simple ? "h-11 w-11 text-xl" : "h-8 w-8"}`} onClick={() => setQty(l.key, l.qty - 1)} aria-label="−">
                      −
                    </button>
                    <span className="num w-8 text-center font-bold">{l.qty}</span>
                    <button className={`btn p-0 ${simple ? "h-11 w-11 text-xl" : "h-8 w-8"}`} onClick={() => setQty(l.key, l.qty + 1)} aria-label="+">
                      +
                    </button>
                  </div>
                ) : (
                  <span className="num">×{l.qty}</span>
                )}
                <span className="num ltr w-20 text-end">{ql ? money(ql.lineTotal, cur, lang) : ""}</span>
              </li>
            );
          })}
        </ul>
      )}
      {quote && (
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
          <dt className="text-muted">{tr("المجموع", "Subtotal")}</dt>
          <dd className="num ltr text-end">{money(quote.subtotal, cur, lang)}</dd>
          {quote.discount > 0 && (
            <>
              <dt className="text-muted">{discountWords(quote.discountReason, tr) || tr("خصم", "Discount")}</dt>
              <dd className="num ltr text-end">−{money(quote.discount, cur, lang)}</dd>
            </>
          )}
          {quote.taxes.map((t) => (
            <div key={t.id} className="contents">
              <dt className="text-muted">
                {pick(t)} {t.kind === "percent" && `${t.value}%`}
              </dt>
              <dd className="num ltr text-end">{money(t.amount, cur, lang)}</dd>
            </div>
          ))}
          {quote.deliveryFee > 0 && (
            <>
              <dt className="text-muted">{tr("أجرة التوصيل", "Delivery fee")}</dt>
              <dd className="num ltr text-end">{money(quote.deliveryFee, cur, lang)}</dd>
            </>
          )}
          <dt className="text-lg font-bold">{tr("الإجمالي", "Total")}</dt>
          <dd className="num ltr text-end text-lg font-bold">{money(quote.total, cur, lang)}</dd>
          {cur !== "USD" && (
            <>
              <dt className="text-xs text-faint">USD</dt>
              <dd className="num ltr text-end text-xs text-faint">{usd(quote.totalUsd)}</dd>
            </>
          )}
        </dl>
      )}
      {quote?.client && quote.client.balanceUsd !== null && (
        <p className="mt-2 text-sm text-muted">
          {tr("رصيد الزبون", "Client balance")}:{" "}
          <span className={quote.client.balanceUsd < -0.009 ? "text-bad" : ""}>
            {quote.client.balanceUsd < -0.009 ? tr("عليه", "owes") : quote.client.balanceUsd > 0.009 ? tr("له", "credit") : ""}{" "}
            <span className="num ltr">{usd(Math.abs(quote.client.balanceUsd))}</span>
          </span>
          {quote.client.creditLimitUsd > 0 && (
            <>
              {" "}
              · {tr("حد الدين", "limit")} <span className="num ltr">{usd(quote.client.creditLimitUsd)}</span>
            </>
          )}
        </p>
      )}
      {quote?.subscription && (
        <p className="mt-1 text-sm text-muted">
          {pick({ nameAr: quote.subscription.planNameAr, nameEn: quote.subscription.planNameEn })}: {tr("باقي", "left")}{" "}
          <span className="num">{quote.subscription.availableIncluded}</span> {tr("قطعة ضمن الاشتراك", "included items")}
        </p>
      )}
      {quote?.loyalty?.enabled && who === "client" && (
        <p className="mt-1 text-sm text-muted">
          {tr("الولاء", "Loyalty")}: <span className="num">{quote.loyalty.progress}</span>/<span className="num">{quote.loyalty.buyQty}</span>
          {quote.loyalty.available > 0 && (
            <span className="text-good">
              {" "}
              · {tr("متاح مجاناً", "free available")}: <span className="num">{quote.loyalty.available}</span>
            </span>
          )}
        </p>
      )}
      {quoteErr && <p className="mt-2 text-sm text-bad">{quoteErr}</p>}
    </div>
  );

  const clientList = (clientsQ.data?.rows ?? []).filter(
    (c) => c.active && (!clientSearch.trim() || `${c.name} ${c.contactPerson} ${c.phone}`.toLowerCase().includes(clientSearch.trim().toLowerCase())),
  );
  const big = simple;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{tr("طلب جديد", "New order")}</h1>
        <Link to="/orders" className="btn btn-ghost">
          {tr("الطلبات", "Orders")}
        </Link>
      </div>
      <div className="mb-5 flex gap-2">
        {stepTab(1, tr("مين الزبون؟", "Who"))}
        {stepTab(2, tr("الأصناف", "Items"))}
        {stepTab(3, tr("الدفع", "Pay"))}
      </div>

      {/* ---------- step 1: who ---------- */}
      {step === 1 && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Choice big active={who === "walkin"} onClick={() => (setWho("walkin"), setClientId(null), setStep(2))}>
              {tr("زبون عابر", "Walk-in")}
            </Choice>
            {canClients && (
              <Choice big active={who === "client"} onClick={() => setWho("client")}>
                {tr("زبون مسجّل", "Account client")}
              </Choice>
            )}
            {canClients && (
              <Choice big active={who === "trial"} onClick={() => setWho("trial")}>
                {tr("تجربة مجانية", "Free trial")}
              </Choice>
            )}
            {canStaff && (
              <Choice big active={who === "staff"} onClick={() => (setWho("staff"), setClientId(null))}>
                {tr("شراء موظف", "Staff purchase")}
              </Choice>
            )}
            <Choice big active={who === "internal"} onClick={() => (setWho("internal"), setClientId(null), setStep(2))}>
              {tr("تذوّق / داخلي", "Tasting / internal")}
            </Choice>
          </div>
          {who === "internal" && (
            <p className="text-sm text-muted">
              {tr("بدون فاتورة ولا دفع: البضاعة بتطلع من المخزون وتكلفتها بتنحسب.", "No invoice, no payment: the goods leave stock and their cost is recorded.")}
            </p>
          )}

          {(who === "client" || who === "trial") && (
            <div className="card">
              {who === "trial" && (
                <p className="mb-3 text-sm text-muted">
                  {tr("التجربة مجانية بالكامل. اختر الزبون أو أضفه كزبون جديد.", "A trial is completely free. Choose the prospect or add them as a new client.")}
                </p>
              )}
              <div className="mb-3 flex gap-2">
                <TextInput
                  type="search"
                  autoFocus
                  placeholder={tr("ابحث بالاسم أو الهاتف", "Search name or phone")}
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
                {can("clients", "create") && (
                  <button className="btn whitespace-nowrap" onClick={() => setNewClient(true)}>
                    {tr("+ زبون جديد", "+ New client")}
                  </button>
                )}
              </div>
              {!clientsQ.data ? (
                <Spinner />
              ) : clientList.length === 0 ? (
                <Empty text={tr("ما في نتائج", "No match")} />
              ) : (
                <div className="grid max-h-[50vh] gap-2 overflow-auto sm:grid-cols-2">
                  {clientList.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => (setClientId(c.id), setStep(2))}
                      className={`rounded-xl border p-3 text-start hover:border-ink ${clientId === c.id ? "border-ink" : "border-line"}`}
                    >
                      <div className="font-semibold">{c.name}</div>
                      <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                        {c.phone && <span className="ltr">{c.phone}</span>}
                        <span>
                          {tr("الرصيد", "Balance")} <span className={`num ltr ${c.balanceUsd < 0 ? "text-bad" : ""}`}>{usd(c.balanceUsd)}</span>
                        </span>
                        {c.subscription && <span>{tr("مشترك", "Subscriber")}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {who === "staff" && (
            <div className="card">
              {!employeesQ.data ? (
                <Spinner />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {employeesQ.data.rows
                    .filter((e) => e.active)
                    .map((e) => (
                      <button
                        key={e.id}
                        onClick={() => (setEmployeeId(e.id), setStep(2))}
                        className={`rounded-xl border p-3 text-start hover:border-ink ${employeeId === e.id ? "border-ink" : "border-line"}`}
                      >
                        <div className="font-semibold">{e.name}</div>
                        <div className="text-xs text-muted">
                          {tr("خصم الموظف", "Staff discount")} <span className="num">{e.staffDiscountPct}%</span>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- step 2: items ---------- */}
      {step === 2 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap gap-2">
              <Choice big={big} active={cat === "all"} onClick={() => setCat("all")}>
                {tr("الكل", "All")}
              </Choice>
              {catalog.data.categories
                .filter((c) => c.active)
                .map((c) => (
                  <Choice key={c.id} big={big} active={cat === c.id} onClick={() => setCat(c.id)}>
                    {pick(c)}
                  </Choice>
                ))}
            </div>
            <form
              className="mb-3"
              onSubmit={(e) => {
                e.preventDefault();
                onScan();
              }}
            >
              <input
                ref={scanRef}
                className="input"
                id="scan"
                dir="ltr"
                placeholder={tr("امسح الباركود أو اكتب كود المنتج ثم Enter", "Scan a barcode or type a product code, then Enter")}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
              />
            </form>
            {products.length === 0 ? (
              <Empty text={tr("ما في منتجات بالمنيو بعد", "No products on the menu yet")} />
            ) : (
              <div className={`grid gap-2 ${big ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4"}`}>
                {products
                  .filter((p) => cat === "all" || p.categoryId === cat)
                  .map((p) => {
                    const inCart = cart.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
                    return (
                      <button
                        key={p.id}
                        onClick={() => tapProduct(p)}
                        className={`relative flex flex-col items-start gap-1 rounded-xl border bg-surface p-3 text-start transition hover:border-ink active:scale-[.98] ${big ? "min-h-[110px]" : "min-h-[88px]"} ${inCart ? "border-ink" : "border-line"}`}
                      >
                        {p.photo && <img src={p.photo} alt="" className="mb-1 h-14 w-full rounded-lg object-cover" />}
                        <span className={`font-semibold leading-tight ${big ? "text-lg" : ""}`}>{pick(p)}</span>
                        <span className="num ltr text-sm text-muted">{money(p.price, p.currency, lang)}</span>
                        {groupsFor(p).length > 0 && <span className="text-xs text-faint">{tr("+ إضافات", "+ add-ons")}</span>}
                        {inCart > 0 && (
                          <span className="num absolute end-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-ink px-1.5 text-sm font-bold text-bg">{inCart}</span>
                        )}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="lg:sticky lg:top-20">
              {clientId && (who === "client" || who === "trial") && <SnapshotCard clientId={clientId} />}
              {renderSummary(true)}
              <button className={`btn btn-primary mt-3 w-full ${big ? "min-h-[60px] text-lg" : "py-3"}`} disabled={!cart.length} onClick={() => setStep(3)}>
                {tr("التالي: الدفع", "Next: payment")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- step 3: pay ---------- */}
      {step === 3 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="grid min-w-0 content-start gap-4">
            {who !== "internal" && (
              <div className="card">
                <h2 className="mb-2 font-semibold">{tr("الاستلام", "Pickup or delivery")}</h2>
                <div className="flex flex-wrap gap-2">
                  <Choice big={big} active={fulfilment === "pickup"} onClick={() => setFulfilment("pickup")}>
                    {tr("استلام من المحل", "Pickup")}
                  </Choice>
                  <Choice big={big} active={fulfilment === "delivery"} onClick={() => setFulfilment("delivery")}>
                    {tr("توصيل", "Delivery")}
                  </Choice>
                </div>
                {fulfilment === "delivery" && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {who !== "trial" && (
                      <Field
                        label={tr("أجرة التوصيل", "Delivery fee")}
                        htmlFor="fee"
                        hint={tr(`الافتراضي ${settings?.orders.defaultDeliveryFee ?? 0}`, `Default ${settings?.orders.defaultDeliveryFee ?? 0}`)}
                      >
                        <TextInput
                          id="fee"
                          inputMode="decimal"
                          dir="ltr"
                          className="num"
                          placeholder={String(settings?.orders.defaultDeliveryFee ?? 0)}
                          value={fee}
                          onChange={(e) => setFee(e.target.value)}
                        />
                      </Field>
                    )}
                    <Field label={tr("مين يوصّل؟", "Delivered by")} htmlFor="rep">
                      <Select id="rep" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                        <option value="">—</option>
                        {(repsQ.data?.rows ?? []).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}
                {fulfilment === "delivery" && assignedTo && method?.kind === "box" && (
                  <p className="mt-2 text-sm text-muted">
                    {tr("المبلغ النقدي يبقى مع موظف التوصيل حتى يسلّمه عند إقفال اليوم.", "Cash stays with the delivery person until they hand it over at day close.")}
                  </p>
                )}
              </div>
            )}

            {who === "trial" || who === "internal" ? (
              <div className="card text-muted">
                {who === "trial"
                  ? tr("تجربة مجانية — بدون دفع.", "Free trial — no payment.")
                  : tr("تذوّق / استهلاك داخلي — بدون دفع، والتكلفة بتنحسب.", "Tasting / internal use — no payment, the cost is recorded.")}
              </div>
            ) : (
              <div className="card">
                <h2 className="mb-2 font-semibold">{tr("طريقة الدفع", "How did they pay?")}</h2>
                <div className="flex flex-wrap gap-2">
                  {methods.map((m) => {
                    const ok = m.kind === "credit" ? !!clientId && who !== "staff" : m.kind === "salary" ? who === "staff" : true;
                    if (m.kind === "salary" && who !== "staff") return null;
                    return (
                      <Choice key={m.id} big={big} active={methodId === m.id} disabled={!ok} onClick={() => setMethodId(m.id)}>
                        {pick(m)}
                      </Choice>
                    );
                  })}
                </div>
                {!clientId && who !== "staff" && (
                  <p className="mt-2 text-xs text-faint">{tr("الدفع على الحساب فقط للزبائن المسجّلين.", "On account is only for account clients.")}</p>
                )}
                {creditWarn && <p className="mt-2 text-sm font-semibold text-bad">{creditWarn}</p>}
                {methodKind === "box" && quote && quote.total > 0 && (
                  <div className="mt-3 grid gap-1">
                    <Field label={tr("المقبوض الآن", "Paid now")} htmlFor="paidnow" hint={tr("اتركه فاضي إذا دفع كامل المبلغ", "Leave empty when they pay all of it")}>
                      <TextInput
                        id="paidnow"
                        inputMode="decimal"
                        dir="ltr"
                        className={`num max-w-[12rem] ${big ? "text-lg" : ""}`}
                        placeholder={String(quote.total)}
                        value={paidNow}
                        onChange={(e) => setPaidNow(e.target.value)}
                      />
                    </Field>
                    {paidValue !== null &&
                      paidValue < quote.total &&
                      (clientId && who === "client" ? (
                        <p className="text-sm font-semibold">
                          {tr("الباقي على الحساب", "Rest on account")}: <span className="num ltr">{money(quote.total - paidValue, cur, lang)}</span>
                        </p>
                      ) : (
                        <p className="text-sm font-semibold text-bad">
                          {tr("الدفع الجزئي بس للزبائن المسجّلين. اختار الزبون من الخطوة 1.", "Part payment is only for account clients. Choose the client in step 1.")}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            )}

            {(can("orders", "edit") || (quote?.loyalty?.enabled && (quote.loyalty.available > 0 || quote.loyaltyFree > 0))) && !noPay && (
              <div className="card grid gap-3">
                {quote?.loyalty?.enabled && (quote.loyalty.available > 0 || quote.loyaltyFree > 0) && (
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" className="h-5 w-5 accent-ink" checked={useLoyalty} onChange={(e) => setUseLoyalty(e.target.checked)} />
                    {tr("استعمل القطع المجانية من الولاء", "Use free items from loyalty")} (<span className="num">{quote.loyalty.available + quote.loyaltyFree}</span>)
                  </label>
                )}
                {can("orders", "edit") && (
                  <Field
                    label={tr("خصم يدوي %", "Manual discount %")}
                    htmlFor="mdisc"
                    hint={tr("يُستعمل أفضل خصم واحد إلا إذا سُمح بالجمع بالإعدادات", "The best single discount applies unless stacking is allowed in settings")}
                  >
                    <TextInput id="mdisc" inputMode="decimal" dir="ltr" className="num max-w-[8rem]" value={manualPct} onChange={(e) => setManualPct(e.target.value)} />
                  </Field>
                )}
              </div>
            )}

            <div className="card">
              <Field label={tr("ملاحظة (اختياري)", "Note (optional)")} htmlFor="note">
                <TextInput id="note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="min-w-0">
            <div className="lg:sticky lg:top-20">
              {clientId && who === "client" && <SnapshotCard clientId={clientId} />}
              {renderSummary(false)}
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-ink"
                  checked={autoPrint}
                  onChange={(e) => {
                    setAutoPrint(e.target.checked);
                    writeAutoPrint(e.target.checked);
                  }}
                />
                {tr("اطبع الفاتورة تلقائياً", "Print the receipt automatically")}
              </label>
              <button
                className={`btn btn-primary mt-3 w-full ${big ? "min-h-[64px] text-xl" : "py-3 text-lg"}`}
                disabled={
                  saving ||
                  !cart.length ||
                  (!methodId && !noPay && (quote?.total ?? 0) > 0) ||
                  !!quoteErr ||
                  (!!creditWarn && !!quote?.client?.creditBlock) ||
                  (paidValue !== null && !!quote && paidValue < quote.total && !(clientId && who === "client"))
                }
                onClick={confirm}
              >
                {saving ? tr("جارٍ الحفظ…", "Saving…") : who === "internal" ? tr("تسجيل الاستهلاك", "Record internal use") : tr("تأكيد الطلب", "Confirm order")}
              </button>
              <button className="btn btn-ghost mt-2 w-full" onClick={() => setStep(2)}>
                {tr("رجوع للأصناف", "Back to items")}
              </button>
            </div>
          </div>
        </div>
      )}

      {addonsFor && (
        <AddonsDialog
          product={addonsFor}
          groups={groupsFor(addonsFor)}
          onClose={() => setAddonsFor(null)}
          onAdd={(ids, q) => {
            addLine(addonsFor.id, ids, q);
            setAddonsFor(null);
          }}
        />
      )}
      {newClient && (
        <NewClientDialog
          onClose={() => setNewClient(false)}
          onCreated={async (c) => {
            setNewClient(false);
            await clientsQ.reload();
            setClientId(c.id);
            setStep(2);
            toast(tr("تمت إضافة الزبون", "Client added"));
          }}
        />
      )}
    </div>
  );
}
