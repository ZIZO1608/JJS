import { useState } from "react";
import { LookupSelect } from "../../components/LookupSelect";
import { Field, Modal, Select, TextInput } from "../../components/ui";
import { ApiError, post, put } from "../../lib/api";
import { useAppSettings } from "../../lib/appSettings";
import { money, num, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import type { ClientSummary, Named, PaymentMethod } from "../../lib/types";
import { useData } from "../../lib/useData";

export interface Tier extends Named {
  discountPct: number;
  sort: number;
}

/** Create or edit a client (shop, café, study zone, freelancer…). */
export interface PriceListRow extends Named {
  active: boolean;
}

export function ClientDialog({ client, onClose, onSaved }: { client: ClientSummary | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { tr, pick, err, fieldErrors } = useI18n();
  const toast = useToast();
  const { s: app } = useAppSettings();
  const tiers = useData<{ rows: Tier[] }>("/clients/tiers");
  const lists = useData<{ rows: PriceListRow[] }>("/clients/price-lists");
  const reps = useData<{ rows: { id: string; name: string }[] }>("/money/reps");
  const [f, setF] = useState({
    type: client?.type ?? ("business" as ClientSummary["type"]),
    name: client?.name ?? "",
    contactPerson: client?.contactPerson ?? "",
    phone: client?.phone ?? "",
    address: client?.address ?? "",
    tierId: client?.tierId ?? "",
    tagId: client?.tagId ?? "",
    receiptLanguage: client?.receiptLanguage ?? ("ar" as "ar" | "en"),
    creditLimitUsd: String(client?.creditLimitUsd ?? 0),
    creditBlock: client?.creditBlock ?? false,
    note: client?.note ?? "",
    active: client?.active ?? true,
    areaId: client?.areaId ?? "",
    paymentTermsDays: String(client?.paymentTermsDays ?? (app?.orders as { defaultPaymentTermsDays?: number } | undefined)?.defaultPaymentTermsDays ?? 7),
    priceListId: client?.priceListId ?? "",
    consignment: client?.consignment ?? false,
    repId: client?.repId ?? "",
  });
  const [opening, setOpening] = useState({ amount: "", currency: (app?.defaultCurrency ?? "USD") as Currency });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const limit = num(f.creditLimitUsd);
      const terms = num(f.paymentTermsDays);
      const body: Record<string, unknown> = {
        ...f,
        tierId: f.tierId || null,
        tagId: f.tagId || null,
        areaId: f.areaId || null,
        priceListId: f.priceListId || null,
        repId: f.repId || null,
        paymentTermsDays: Number.isNaN(terms) ? 0 : Math.round(terms),
        creditLimitUsd: Number.isNaN(limit) ? 0 : limit,
      };
      if (!client) {
        const ob = num(opening.amount);
        if (!Number.isNaN(ob) && ob !== 0) {
          body.openingBalance = ob;
          body.openingCurrency = opening.currency;
        }
      }
      const r = client ? await put<{ row: ClientSummary }>(`/clients/${client.id}`, body) : await post<{ row: ClientSummary }>("/clients", body);
      toast(tr("تم الحفظ", "Saved"));
      onSaved(r.row.id);
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      wide
      title={client ? tr("تعديل الزبون", "Edit client") : tr("زبون جديد", "New client")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !f.name.trim()}>
            {saving ? tr("جارٍ الحفظ…", "Saving…") : tr("حفظ", "Save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("النوع", "Type")} htmlFor="c-type">
          <Select id="c-type" value={f.type} onChange={(e) => set("type", e.target.value as ClientSummary["type"])}>
            <option value="business">{tr("محل / مقهى / شركة", "Business (shop, café, study zone)")}</option>
            <option value="individual">{tr("فرد (فريلانسر…)", "Individual (freelancer…)")}</option>
          </Select>
        </Field>
        <Field label={tr("الاسم", "Name")} htmlFor="c-name" error={errors.name}>
          <TextInput id="c-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={tr("الشخص المسؤول", "Contact person")} htmlFor="c-contact" error={errors.contactPerson}>
          <TextInput id="c-contact" value={f.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />
        </Field>
        <Field label={tr("الهاتف", "Phone")} htmlFor="c-phone" error={errors.phone}>
          <TextInput id="c-phone" dir="ltr" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={tr("العنوان", "Address")} htmlFor="c-addr" error={errors.address}>
            <TextInput id="c-addr" value={f.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
        </div>
        <Field label={tr("الفئة (خصم)", "Tier (discount)")} htmlFor="c-tier" hint={tr("مثلاً: زبون مميّز يأخذ خصم ١٠٪", "e.g. Favourite gets 10% off")}>
          <Select id="c-tier" value={f.tierId} onChange={(e) => set("tierId", e.target.value)}>
            <option value="">—</option>
            {tiers.data?.rows.map((t) => (
              <option key={t.id} value={t.id}>
                {pick(t)} ({t.discountPct}%)
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("التصنيف", "Tag")} htmlFor="c-tag">
          <LookupSelect id="c-tag" listType="client_tag" value={f.tagId} onChange={(v) => set("tagId", v)} />
        </Field>
        <Field label={tr("المنطقة", "Area")} htmlFor="c-area">
          <LookupSelect id="c-area" listType="area" value={f.areaId} onChange={(v) => set("areaId", v)} />
        </Field>
        <Field label={tr("قائمة الأسعار", "Price list")} htmlFor="c-pl" hint={tr("فاضي = سعر المنيو", "Empty = menu price")}>
          <Select id="c-pl" value={f.priceListId} onChange={(e) => set("priceListId", e.target.value)}>
            <option value="">—</option>
            {lists.data?.rows
              .filter((l) => l.active || l.id === f.priceListId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {pick(l)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={tr("المندوب", "Delivery rep")} htmlFor="c-rep">
          <Select id="c-rep" value={f.repId} onChange={(e) => set("repId", e.target.value)}>
            <option value="">—</option>
            {reps.data?.rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("مدة السداد (أيام)", "Days to pay")} htmlFor="c-terms" error={errors.paymentTermsDays} hint={tr("٠ = الدفع فوراً", "0 = pay on the spot")}>
          <TextInput id="c-terms" type="number" min={0} step="1" dir="ltr" className="num" value={f.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} />
        </Field>
        <Field label={tr("لغة الفاتورة", "Receipt language")} htmlFor="c-lang">
          <Select id="c-lang" value={f.receiptLanguage} onChange={(e) => set("receiptLanguage", e.target.value as "ar" | "en")}>
            <option value="ar">عربي</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field label={tr("حد الدين ($)", "Credit limit ($)")} htmlFor="c-limit" error={errors.creditLimitUsd} hint={tr("٠ = بلا حد", "0 = no limit")}>
          <TextInput id="c-limit" type="number" min={0} step="1" dir="ltr" className="num" value={f.creditLimitUsd} onChange={(e) => set("creditLimitUsd", e.target.value)} />
        </Field>
        <label className="inline-flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.creditBlock} onChange={(e) => set("creditBlock", e.target.checked)} />
          {tr("امنع الطلب بالدين إذا تجاوز الحد", "Block credit orders above the limit")}
        </label>
        <label className="inline-flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.consignment} onChange={(e) => set("consignment", e.target.checked)} />
          {tr("محل بالأمانة (بيدفع بس على اللي باعه)", "Consignment shop (pays only for what it sold)")}
        </label>
        {!client && (
          <div className="grid grid-cols-[1fr_auto] gap-2 sm:col-span-2">
            <Field label={tr("رصيد سابق (اختياري)", "Opening balance (optional)")} htmlFor="c-open" hint={tr("موجب = عليه لنا، سالب = دافع سلف", "+ owes us · − prepaid")}>
              <TextInput
                id="c-open"
                inputMode="decimal"
                dir="ltr"
                className="num"
                placeholder="0"
                value={opening.amount}
                onChange={(e) => setOpening({ ...opening, amount: e.target.value })}
              />
            </Field>
            <Field label={tr("العملة", "Currency")} htmlFor="c-open-cur">
              <Select id="c-open-cur" value={opening.currency} onChange={(e) => setOpening({ ...opening, currency: e.target.value as Currency })}>
                <option value="USD">USD</option>
                <option value="SYP">SYP</option>
              </Select>
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label={tr("ملاحظة", "Note")} htmlFor="c-note" error={errors.note}>
            <TextInput id="c-note" value={f.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
        </div>
        {client && (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
            {tr("فعّال", "Active")}
          </label>
        )}
      </div>
    </Modal>
  );
}

/** Money from the client into a box (cash, Sham Cash…): pays debt or tops up the client's box. */
export function PaymentDialog({ client, onClose, onSaved }: { client: { id: string; name: string; balanceUsd: number }; onClose: () => void; onSaved: () => void }) {
  const { tr, pick, err, fieldErrors } = useI18n();
  const toast = useToast();
  const { s } = useAppSettings();
  const methods = useData<{ rows: PaymentMethod[] }>("/money/methods");
  const boxMethods = (methods.data?.rows ?? []).filter((m) => m.kind === "box" && m.active);
  const owes = client.balanceUsd < -0.009;
  const [f, setF] = useState({
    amount: owes ? String(Math.round(-client.balanceUsd * 100) / 100) : "",
    currency: (s?.defaultCurrency ?? "USD") as Currency,
    methodId: "",
    kind: (owes ? "client_payment" : "topup") as "client_payment" | "topup",
    note: "",
  });
  const methodId = f.methodId || boxMethods[0]?.id || "";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const amount = num(f.amount);

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      await post(`/clients/${client.id}/payments`, { ...f, methodId, amount });
      toast(tr("تم تسجيل الدفعة", "Payment recorded"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={tr(`دفعة من ${client.name}`, `Payment from ${client.name}`)}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !(amount > 0) || !methodId}>
            {saving ? tr("جارٍ الحفظ…", "Saving…") : tr("سجّل الدفعة", "Record payment")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm text-muted">
          {tr("الرصيد الحالي:", "Current balance:")} <BalanceText usd={client.balanceUsd} />
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={tr("المبلغ", "Amount")} htmlFor="p-amount" error={errors.amount}>
            <TextInput id="p-amount" inputMode="decimal" dir="ltr" className="num text-lg" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label={tr("العملة", "Currency")} htmlFor="p-cur">
            <Select id="p-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
              <option value="USD">USD $</option>
              <option value="SYP">SYP ل.س</option>
            </Select>
          </Field>
        </div>
        <Field label={tr("طريقة الدفع", "Paid by")} htmlFor="p-method">
          <div className="flex flex-wrap gap-2" id="p-method">
            {boxMethods.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={methodId === m.id}
                className={`btn ${methodId === m.id ? "btn-primary" : ""}`}
                onClick={() => setF({ ...f, methodId: m.id })}
              >
                {pick(m)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={tr("نوع الدفعة", "This money is")} htmlFor="p-kind">
          <Select id="p-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "client_payment" | "topup" })}>
            <option value="client_payment">{tr("سداد دين", "Paying their debt")}</option>
            <option value="topup">{tr("شحن رصيد مسبق", "Prepaid top-up")}</option>
          </Select>
        </Field>
        <Field label={tr("ملاحظة", "Note")} htmlFor="p-note" error={errors.note}>
          <TextInput id="p-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

/** Correction of a client box (admin only, needs a reason, always logged). */
export function AdjustDialog({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const { tr, err, fieldErrors } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ amount: "", currency: "USD" as Currency, note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const amount = num(f.amount);
  const save = async () => {
    setErrors({});
    try {
      await post(`/clients/${clientId}/adjust`, { ...f, amount });
      toast(tr("تم التعديل", "Balance adjusted"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    }
  };
  return (
    <Modal
      title={tr("تعديل الرصيد", "Adjust balance")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!amount || f.note.trim().length < 3}>
            {tr("حفظ", "Save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm text-muted">{tr("رقم موجب = لصالح الزبون، رقم سالب = دين عليه.", "Positive = in the client's favour, negative = the client owes more.")}</p>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={tr("المبلغ", "Amount")} htmlFor="a-amount" error={errors.amount}>
            <TextInput id="a-amount" dir="ltr" className="num" placeholder="-5 / 5" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label={tr("العملة", "Currency")} htmlFor="a-cur">
            <Select id="a-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
              <option value="USD">USD</option>
              <option value="SYP">SYP</option>
            </Select>
          </Field>
        </div>
        <Field label={tr("السبب", "Reason")} htmlFor="a-note" error={errors.note}>
          <TextInput id="a-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

/** "Owes $12.00" in red, "Prepaid $5.00", or "$0.00". */
export function BalanceText({ usd, big }: { usd: number; big?: boolean }) {
  const { tr } = useI18n();
  const size = big ? "text-3xl font-bold" : "font-semibold";
  if (usd < -0.009)
    return (
      <span className={`${size} text-bad`}>
        <span className="num ltr">{money(-usd)}</span> <span className={big ? "text-base font-semibold" : "text-xs"}>{tr("دين", "owes")}</span>
      </span>
    );
  if (usd > 0.009)
    return (
      <span className={size}>
        <span className="num ltr">{money(usd)}</span> <span className={`${big ? "text-base" : "text-xs"} font-normal text-muted`}>{tr("رصيد مسبق", "prepaid")}</span>
      </span>
    );
  return <span className={`${size} num ltr text-muted`}>{money(0)}</span>;
}
