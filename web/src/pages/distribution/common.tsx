import { useMemo, useState } from "react";
import { Field, Modal, Select, TextInput } from "../../components/ui";
import { ApiError, post } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import { money, num, type Currency } from "../../lib/format";
import type { CashBox, Catalog, ClientSummary, PaymentMethod } from "../../lib/types";

/* Small shared pieces for the wholesale screens. */

export interface Rep {
  id: string;
  name: string;
  boxId: string | null;
}

export function useLists() {
  const catalog = useData<Catalog>("/menu/catalog");
  const clients = useData<{ rows: ClientSummary[] }>("/clients");
  const reps = useData<{ rows: Rep[] }>("/money/reps");
  const methods = useData<{ rows: PaymentMethod[] }>("/money/methods");
  const boxes = useData<{ rows: CashBox[] }>("/money/boxes");
  return {
    products: catalog.data?.products.filter((p) => p.active) ?? [],
    clients: clients.data?.rows.filter((c) => c.active) ?? [],
    reps: reps.data?.rows ?? [],
    methods: methods.data?.rows.filter((m) => m.active) ?? [],
    boxes: boxes.data?.rows.filter((b) => b.active) ?? [],
  };
}

/** Big +/− quantity box that also accepts typing. */
export function QtyInput({ value, onChange, max, label }: { value: number; onChange: (n: number) => void; max?: number; label?: string }) {
  const clamp = (n: number) => Math.max(0, Math.min(max ?? 5000, Number.isFinite(n) ? Math.round(n) : 0));
  return (
    <div className="inline-flex items-center rounded-lg border border-line bg-surface" role="group" aria-label={label}>
      <button type="button" className="h-10 w-10 text-lg font-bold hover:bg-sunken" onClick={() => onChange(clamp(value - 1))} aria-label="−">
        −
      </button>
      <input className="h-10 w-14 border-x border-line bg-transparent text-center num ltr focus:outline-none" inputMode="numeric" value={value} onChange={(e) => onChange(clamp(num(e.target.value)))} aria-label={label} />
      <button type="button" className="h-10 w-10 text-lg font-bold hover:bg-sunken" onClick={() => onChange(clamp(value + 1))} aria-label="+">
        +
      </button>
    </div>
  );
}

export const STATUS_LABEL: Record<string, { ar: string; en: string }> = {
  open: { ar: "عند المحل", en: "At the shop" },
  settled: { ar: "تمت التسوية", en: "Settled" },
  cancelled: { ar: "ملغاة", en: "Cancelled" },
  paid: { ar: "مدفوعة", en: "Paid" },
  partial: { ar: "مدفوعة جزئياً", en: "Part paid" },
  credit: { ar: "على الحساب", en: "On account" },
  free: { ar: "مجانية", en: "Free" },
  salary: { ar: "من الراتب", en: "From salary" },
  credit_s: { ar: "رصيد للزبون", en: "Credit to client" },
  refund: { ar: "استرداد نقدي", en: "Cash refund" },
  none: { ar: "بدون مبلغ", en: "No money" },
  restock: { ar: "رجع للبرّاد", en: "Back to fridge" },
  waste: { ar: "تالف", en: "Waste" },
};

/** Leave goods with a shop on consignment. */
export function ConsignmentDialog({ clientId, onClose, onDone }: { clientId?: string; onClose: () => void; onDone: () => void }) {
  const { tr, pick, err } = useI18n();
  const toast = useToast();
  const { products, clients, reps } = useLists();
  const [client, setClient] = useState(clientId ?? "");
  const [rep, setRep] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const shopClients = clients.filter((c) => c.consignment || c.id === clientId);
  const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([productId, q]) => ({ productId, qty: q }));
  const save = async () => {
    setSaving(true);
    try {
      const r = await post<{ number: number; value: number; currency: Currency }>("/consignments", { clientId: client, repId: rep || null, lines });
      toast(tr(`تم تسليم البضاعة بالأمانة (C${r.number})`, `Goods left on consignment (C${r.number})`));
      onDone();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      wide
      title={tr("تسليم بضاعة بالأمانة", "Leave goods on consignment")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" disabled={!client || !lines.length || saving} onClick={save}>
            {tr("تسليم", "Leave goods")} ({lines.reduce((s, l) => s + l.qty, 0)})
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">{tr("البضاعة تطلع من البرّاد هلّق. المحل بيدفع بس على اللي باعه، والباقي برجع بالتسوية.", "The goods leave the fridge now. The shop pays only for what it sells; the rest comes back at settlement.")}</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label={tr("المحل", "Shop")} htmlFor="cs-client">
          <Select id="cs-client" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">—</option>
            {(shopClients.length ? shopClients : clients).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("المندوب", "Rep")} htmlFor="cs-rep">
          <Select id="cs-rep" value={rep} onChange={(e) => setRep(e.target.value)}>
            <option value="">—</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid max-h-[50vh] gap-2 overflow-auto">
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
            <span className="min-w-0 truncate font-semibold">{pick(p)}</span>
            <QtyInput value={qty[p.id] ?? 0} onChange={(n) => setQty({ ...qty, [p.id]: n })} label={pick(p)} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

interface ConsLine {
  productId: string;
  nameAr: string;
  nameEn: string;
  qty: number;
  unitPrice: number;
}
export interface Consignment {
  id: string;
  number: number;
  businessDate: string;
  clientId: string;
  clientName: string;
  repName: string | null;
  status: "open" | "settled" | "cancelled";
  currency: Currency;
  value: number;
  qty: number;
  lines: (ConsLine & { returnedQty: number })[];
  orderNumber: number | null;
}

/** Count what is left at the shop: returns come back, the sold part becomes an invoice. */
export function SettleDialog({ c, onClose, onDone }: { c: Consignment; onClose: () => void; onDone: () => void }) {
  const { tr, pick, err, lang } = useI18n();
  const toast = useToast();
  const { methods } = useLists();
  const [back, setBack] = useState<Record<string, number>>({});
  const [action, setAction] = useState<Record<string, "restock" | "waste">>({});
  const [method, setMethod] = useState("");
  const [paid, setPaid] = useState("");
  const [saving, setSaving] = useState(false);
  const soldTotal = useMemo(() => c.lines.reduce((s, l) => s + (l.qty - (back[l.productId] ?? 0)) * l.unitPrice, 0), [c, back]);
  const m = methods.find((x) => x.id === method);
  const save = async () => {
    setSaving(true);
    try {
      const r = await post<{ orderNumber: number | null; soldQty: number; returnedQty: number }>(`/consignments/${c.id}/settle`, {
        lines: c.lines.map((l) => ({ productId: l.productId, returnedQty: back[l.productId] ?? 0, action: action[l.productId] ?? "waste" })),
        methodId: method || null,
        paidAmount: m?.kind === "box" && paid !== "" ? num(paid) : null,
      });
      toast(r.orderNumber ? tr(`تمت التسوية: فاتورة #${r.orderNumber}`, `Settled: invoice #${r.orderNumber}`) : tr("تمت التسوية، ما في مبيع", "Settled, nothing sold"));
      onDone();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      wide
      title={tr(`تسوية بضاعة الأمانة C${c.number} · ${c.clientName}`, `Settle consignment C${c.number} · ${c.clientName}`)}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {tr("تسوية وإصدار الفاتورة", "Settle and invoice")}
          </button>
        </>
      }
    >
      <div className="grid gap-2">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-1 text-xs text-faint">
          <span>{tr("الصنف · المسلَّم", "Item · left")}</span>
          <span>{tr("رجع", "Came back")}</span>
          <span>{tr("المرتجع", "Returned goes")}</span>
        </div>
        {c.lines.map((l) => (
          <div key={l.productId} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-line px-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{pick(l)}</div>
              <div className="text-xs text-muted">
                {tr("مسلَّم", "Left")} <span className="num ltr">{l.qty}</span> · {tr("مباع", "Sold")} <span className="num ltr">{l.qty - (back[l.productId] ?? 0)}</span> × <span className="num ltr">{money(l.unitPrice, c.currency, lang)}</span>
              </div>
            </div>
            <QtyInput value={back[l.productId] ?? 0} max={l.qty} onChange={(n) => setBack({ ...back, [l.productId]: n })} label={tr("رجع", "Came back")} />
            <Select value={action[l.productId] ?? "waste"} onChange={(e) => setAction({ ...action, [l.productId]: e.target.value as "restock" | "waste" })} aria-label={tr("المرتجع", "Returned goes")}>
              <option value="waste">{pick(STATUS_LABEL.waste!)}</option>
              <option value="restock">{pick(STATUS_LABEL.restock!)}</option>
            </Select>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="card bg-sunken sm:col-span-1">
          <div className="text-sm text-muted">{tr("قيمة المباع", "Sold value")}</div>
          <div className="text-2xl font-bold num ltr text-start">{money(soldTotal, c.currency, lang)}</div>
        </div>
        <Field label={tr("طريقة الدفع", "Payment")} htmlFor="st-m" hint={tr("فاضي = على الحساب", "Empty = on account")}>
          <Select id="st-m" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">{tr("على الحساب", "On account")}</option>
            {methods
              .filter((x) => x.kind === "box")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {pick(x)}
                </option>
              ))}
          </Select>
        </Field>
        {m?.kind === "box" && (
          <Field label={tr("المقبوض الآن", "Paid now")} htmlFor="st-p" hint={tr("فاضي = كامل المبلغ", "Empty = all of it")}>
            <TextInput id="st-p" inputMode="decimal" dir="ltr" className="num" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

interface OrderRow {
  id: string;
  number: number;
  businessDate: string;
  total: number;
  currency: Currency;
  status: string;
}
interface OrderDetail {
  lines: { productId: string; nameAr: string; nameEn: string; qty: number }[];
}

/** Goods come back from a client: from an invoice or without one. */
export function ReturnDialog({ clientId, orderId, onClose, onDone }: { clientId?: string; orderId?: string; onClose: () => void; onDone: () => void }) {
  const { tr, pick, err, fmtDate, lang } = useI18n();
  const toast = useToast();
  const { products, clients, boxes, reps } = useLists();
  const [client, setClient] = useState(clientId ?? "");
  const [order, setOrder] = useState(orderId ?? "");
  const [settlement, setSettlement] = useState<"credit" | "refund" | "none">(clientId ? "credit" : "refund");
  const [box, setBox] = useState("");
  const [rep, setRep] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [action, setAction] = useState<Record<string, "restock" | "waste">>({});
  const [saving, setSaving] = useState(false);
  const orders = useData<{ rows: OrderRow[] }>(client ? `/orders?clientId=${client}` : null);
  const detail = useData<{ order: OrderDetail }>(order ? `/orders/${order}` : null);
  const choices = order && detail.data ? detail.data.order.lines.map((l) => ({ id: l.productId, nameAr: l.nameAr, nameEn: l.nameEn, max: l.qty })) : products.map((p) => ({ id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, max: 5000 }));
  const lines = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([productId, q]) => ({ productId, qty: q, action: action[productId] ?? "waste" }));
  const save = async () => {
    setSaving(true);
    try {
      const r = await post<{ number: number; total: number; currency: Currency }>("/returns", { clientId: client || null, orderId: order || null, repId: rep || null, settlement, boxId: settlement === "refund" ? box : null, note, lines });
      toast(tr(`تم تسجيل المرتجع R${r.number} · ${money(r.total, r.currency, "ar")}`, `Return R${r.number} saved · ${money(r.total, r.currency, "en")}`));
      onDone();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      wide
      title={tr("مرتجع من زبون", "Goods returned by a client")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" disabled={!lines.length || saving || (settlement === "refund" && !box) || (settlement === "credit" && !client)} onClick={save}>
            {tr("تسجيل المرتجع", "Save return")}
          </button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label={tr("الزبون", "Client")} htmlFor="rt-c">
          <Select
            id="rt-c"
            value={client}
            onChange={(e) => {
              setClient(e.target.value);
              setOrder("");
              setQty({});
              if (!e.target.value && settlement === "credit") setSettlement("refund");
            }}
          >
            <option value="">{tr("زبون عابر", "Walk-in")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("من فاتورة", "From invoice")} htmlFor="rt-o" hint={tr("اختياري: بيحسب السعر من الفاتورة", "Optional: prices come from the invoice")}>
          <Select
            id="rt-o"
            value={order}
            onChange={(e) => {
              setOrder(e.target.value);
              setQty({});
            }}
            disabled={!client}
          >
            <option value="">—</option>
            {orders.data?.rows
              .filter((o) => o.status !== "cancelled")
              .slice(0, 40)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  #{o.number} · {fmtDate(o.businessDate)} · {money(o.total, o.currency, lang)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={tr("المبلغ", "Money")} htmlFor="rt-s">
          <Select id="rt-s" value={settlement} onChange={(e) => setSettlement(e.target.value as typeof settlement)}>
            {client && <option value="credit">{pick(STATUS_LABEL.credit_s!)}</option>}
            <option value="refund">{pick(STATUS_LABEL.refund!)}</option>
            <option value="none">{pick(STATUS_LABEL.none!)}</option>
          </Select>
        </Field>
        {settlement === "refund" ? (
          <Field label={tr("من صندوق", "From box")} htmlFor="rt-b">
            <Select id="rt-b" value={box} onChange={(e) => setBox(e.target.value)}>
              <option value="">—</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {pick(b)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={tr("المندوب", "Rep")} htmlFor="rt-r">
            <Select id="rt-r" value={rep} onChange={(e) => setRep(e.target.value)}>
              <option value="">—</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div className="grid max-h-[40vh] gap-2 overflow-auto">
        {choices.map((p) => (
          <div key={p.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-line px-3 py-2">
            <span className="min-w-0 truncate font-semibold">{pick(p)}</span>
            <QtyInput value={qty[p.id] ?? 0} max={p.max} onChange={(n) => setQty({ ...qty, [p.id]: n })} label={pick(p)} />
            <Select value={action[p.id] ?? "waste"} onChange={(e) => setAction({ ...action, [p.id]: e.target.value as "restock" | "waste" })} aria-label={tr("المرتجع", "Returned goes")}>
              <option value="waste">{pick(STATUS_LABEL.waste!)}</option>
              <option value="restock">{pick(STATUS_LABEL.restock!)}</option>
            </Select>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Field label={tr("ملاحظة", "Note")} htmlFor="rt-n">
          <TextInput id="rt-n" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Message the client on WhatsApp (opens WhatsApp with the text ready). */
export function waLink(phone: string, text: string) {
  const digits = phone.replace(/[^\d]/g, "").replace(/^0+/, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function apiErrorCode(e: unknown) {
  return e instanceof ApiError ? e.code : "";
}
