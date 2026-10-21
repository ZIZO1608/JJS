import { useEffect, useState } from "react";
import { Field, Select, Spinner } from "../../components/ui";
import { post, put } from "../../lib/api";
import { useAppSettings } from "../../lib/appSettings";
import { useAuth } from "../../lib/auth";
import { money, num, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useData } from "../../lib/useData";
import { ActionDialog, Check, CurrencySelect, DeleteConfirm, NameFields, NumInput, RowActions, useSaver } from "../kit";

interface Tier {
  id: string;
  nameAr: string;
  nameEn: string;
  discountPct: number;
  sort: number;
}
interface Plan {
  id: string;
  nameAr: string;
  nameEn: string;
  monthlyFee: number;
  currency: Currency;
  discountPct: number;
  includedItems: number;
  active: boolean;
}
interface Full {
  loyalty: { enabled: boolean; buyQty: number; freeQty: number };
  orders: { defaultDeliveryFee: number; allowStacking: boolean; defaultPaymentTermsDays?: number; defaultReturnAction?: "restock" | "waste" };
  costing?: { targetMarginPct: number; priceAlertPct: number };
}

function Section({ title, hint, children, onSave, busy, can }: { title: string; hint?: string; children: React.ReactNode; onSave: () => void; busy: boolean; can: boolean }) {
  const { t } = useI18n();
  return (
    <section className="card">
      <h2 className="text-lg font-bold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-muted">{hint}</p>}
      <div className="grid gap-3">{children}</div>
      {can && (
        <button className="btn btn-primary mt-4" onClick={onSave} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
      )}
    </section>
  );
}

function TierDialog({ tier, onClose, onSaved }: { tier: Tier | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useI18n();
  const { errors, busy, run } = useSaver();
  const [f, setF] = useState({ nameAr: tier?.nameAr ?? "", nameEn: tier?.nameEn ?? "", discountPct: String(tier?.discountPct ?? 0), sort: String(tier?.sort ?? 0) });
  const save = async () => {
    const body = { nameAr: f.nameAr, nameEn: f.nameEn, discountPct: num(f.discountPct) || 0, sort: Math.round(num(f.sort) || 0) };
    if (await run(() => (tier ? put(`/clients/tiers/${tier.id}`, body) : post("/clients/tiers", body)))) onSaved();
  };
  return (
    <ActionDialog title={tier ? tr("تعديل فئة", "Edit tier") : tr("فئة زبائن جديدة", "New client tier")} onClose={onClose} onSave={save} busy={busy} disabled={!f.nameAr || !f.nameEn}>
      <NameFields f={f} set={setF} errors={errors} idp="tr" />
      <Field label={tr("الخصم %", "Discount %")} htmlFor="tr-d" error={errors.discountPct}>
        <NumInput id="tr-d" value={f.discountPct} onChange={(v) => setF({ ...f, discountPct: v })} />
      </Field>
    </ActionDialog>
  );
}

function PlanDialog({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useI18n();
  const { s } = useAppSettings();
  const { errors, busy, run } = useSaver();
  const [f, setF] = useState({
    nameAr: plan?.nameAr ?? "",
    nameEn: plan?.nameEn ?? "",
    monthlyFee: plan ? String(plan.monthlyFee) : "",
    currency: plan?.currency ?? s?.defaultCurrency ?? "USD",
    discountPct: String(plan?.discountPct ?? 0),
    includedItems: String(plan?.includedItems ?? 0),
    active: plan?.active ?? true,
  });
  const save = async () => {
    const body = { nameAr: f.nameAr, nameEn: f.nameEn, monthlyFee: num(f.monthlyFee) || 0, currency: f.currency, discountPct: num(f.discountPct) || 0, includedItems: Math.round(num(f.includedItems) || 0), active: f.active };
    if (await run(() => (plan ? put(`/clients/plans/${plan.id}`, body) : post("/clients/plans", body)))) onSaved();
  };
  return (
    <ActionDialog title={plan ? tr("تعديل اشتراك", "Edit plan") : tr("اشتراك جديد", "New plan")} onClose={onClose} onSave={save} busy={busy} disabled={!f.nameAr || !f.nameEn || f.monthlyFee === ""}>
      <NameFields f={f} set={setF} errors={errors} idp="pl" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("الرسم الشهري", "Monthly fee")} htmlFor="pl-f">
          <NumInput id="pl-f" value={f.monthlyFee} onChange={(v) => setF({ ...f, monthlyFee: v })} />
        </Field>
        <Field label={tr("العملة", "Currency")} htmlFor="pl-c">
          <CurrencySelect id="pl-c" value={f.currency} onChange={(c) => setF({ ...f, currency: c })} />
        </Field>
        <Field label={tr("قطع مجانية بالشهر", "Free items a month")} htmlFor="pl-i">
          <NumInput id="pl-i" step="1" value={f.includedItems} onChange={(v) => setF({ ...f, includedItems: v })} />
        </Field>
        <Field label={tr("خصم على الباقي %", "Discount on the rest %")} htmlFor="pl-d">
          <NumInput id="pl-d" value={f.discountPct} onChange={(v) => setF({ ...f, discountPct: v })} />
        </Field>
      </div>
      <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>
        {tr("متاح للزبائن", "Available")}
      </Check>
    </ActionDialog>
  );
}

export function SalesTab() {
  const { tr, pick, lang } = useI18n();
  const { can } = useAuth();
  const { reload } = useAppSettings();
  const full = useData<Full>("/system/app-settings");
  const tiers = useData<{ rows: Tier[] }>("/clients/tiers");
  const plans = useData<{ rows: Plan[] }>("/clients/plans");
  const edit = can("settings", "edit");
  const loy = useSaver();
  const ord = useSaver();
  const cost = useSaver();
  const [l, setL] = useState({ enabled: true, buyQty: "100", freeQty: "5" });
  const [o, setO] = useState({ defaultDeliveryFee: "0", allowStacking: false, defaultPaymentTermsDays: "7", defaultReturnAction: "waste" as "restock" | "waste" });
  const [c, setC] = useState({ targetMarginPct: "40", priceAlertPct: "5" });
  const [tierDlg, setTierDlg] = useState<Tier | "new" | null>(null);
  const [planDlg, setPlanDlg] = useState<Plan | "new" | null>(null);
  const [delTier, setDelTier] = useState<Tier | null>(null);
  const [delPlan, setDelPlan] = useState<Plan | null>(null);
  useEffect(() => {
    const d = full.data;
    if (!d) return;
    setL({ enabled: d.loyalty.enabled, buyQty: String(d.loyalty.buyQty), freeQty: String(d.loyalty.freeQty) });
    setO({ defaultDeliveryFee: String(d.orders.defaultDeliveryFee), allowStacking: d.orders.allowStacking, defaultPaymentTermsDays: String(d.orders.defaultPaymentTermsDays ?? 7), defaultReturnAction: d.orders.defaultReturnAction ?? "waste" });
    if (d.costing) setC({ targetMarginPct: String(d.costing.targetMarginPct), priceAlertPct: String(d.costing.priceAlertPct) });
  }, [full.data]);
  if (!full.data || !tiers.data || !plans.data) return <Spinner />;
  const after = async (ok: boolean) => {
    if (ok) {
      await reload();
      void full.reload();
    }
  };

  return (
    <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
      <Section
        title={tr("الطلبات والحسابات", "Orders and accounts")}
        can={edit}
        busy={ord.busy}
        onSave={async () =>
          after(await ord.run(() => put("/system/settings/orders", { defaultDeliveryFee: num(o.defaultDeliveryFee) || 0, allowStacking: o.allowStacking, defaultPaymentTermsDays: Math.round(num(o.defaultPaymentTermsDays) || 0), defaultReturnAction: o.defaultReturnAction })))
        }
      >
        <Field label={tr("رسم التوصيل الافتراضي", "Default delivery fee")} htmlFor="o-fee">
          <NumInput id="o-fee" value={o.defaultDeliveryFee} onChange={(v) => setO({ ...o, defaultDeliveryFee: v })} />
        </Field>
        <Field label={tr("مدة السداد للزبون الجديد (أيام)", "Payment terms for new clients (days)")} htmlFor="o-t" hint={tr("0 = دفع فوري", "0 = pay on the spot")}>
          <NumInput id="o-t" step="1" value={o.defaultPaymentTermsDays} onChange={(v) => setO({ ...o, defaultPaymentTermsDays: v })} />
        </Field>
        <Field label={tr("المرتجع افتراضياً", "Returned goods by default")} htmlFor="o-r" hint={tr("الموظف فيه يغيّر كل مرة", "Staff can change it each time")}>
          <Select id="o-r" value={o.defaultReturnAction} onChange={(e) => setO({ ...o, defaultReturnAction: e.target.value as "restock" | "waste" })}>
            <option value="waste">{tr("تالف", "Waste")}</option>
            <option value="restock">{tr("رجع للبرّاد", "Back to the fridge")}</option>
          </Select>
        </Field>
        <Check checked={o.allowStacking} onChange={(v) => setO({ ...o, allowStacking: v })}>
          {tr("اجمع الخصومات (وإلا بينطبق الأفضل بس)", "Add discounts together (otherwise only the best one)")}
        </Check>
      </Section>

      <Section
        title={tr("هامش الربح", "Profit margin")}
        hint={tr("الأصناف تحت الهامش بتتعلّم، والبرنامج بيقترح سعر.", "Products under the target are flagged and a price is suggested.")}
        can={edit}
        busy={cost.busy}
        onSave={async () => after(await cost.run(() => put("/system/settings/costing", { targetMarginPct: num(c.targetMarginPct) || 0, priceAlertPct: num(c.priceAlertPct) || 0 })))}
      >
        <Field label={tr("الهامش المستهدف %", "Target margin %")} htmlFor="c-t">
          <NumInput id="c-t" value={c.targetMarginPct} onChange={(v) => setC({ ...c, targetMarginPct: v })} />
        </Field>
        <Field label={tr("نبّهني إذا تغيّر سعر مادة أكتر من %", "Alert me when an ingredient price moves more than %")} htmlFor="c-a">
          <NumInput id="c-a" value={c.priceAlertPct} onChange={(v) => setC({ ...c, priceAlertPct: v })} />
        </Field>
      </Section>

      <Section
        title={tr("برنامج الولاء", "Loyalty")}
        hint={tr("مثلاً: كل 100 قطعة بالشهر → 5 مجاناً.", "e.g. every 100 items in a month → 5 free.")}
        can={edit}
        busy={loy.busy}
        onSave={async () => after(await loy.run(() => put("/system/settings/loyalty", { enabled: l.enabled, buyQty: Math.max(1, Math.round(num(l.buyQty) || 1)), freeQty: Math.max(1, Math.round(num(l.freeQty) || 1)) })))}
      >
        <Check checked={l.enabled} onChange={(v) => setL({ ...l, enabled: v })}>
          {tr("مفعّل", "On")}
        </Check>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr("كل كم قطعة", "Every … items")} htmlFor="l-b">
            <NumInput id="l-b" step="1" value={l.buyQty} onChange={(v) => setL({ ...l, buyQty: v })} />
          </Field>
          <Field label={tr("كم مجاناً", "… free")} htmlFor="l-f">
            <NumInput id="l-f" step="1" value={l.freeQty} onChange={(v) => setL({ ...l, freeQty: v })} />
          </Field>
        </div>
      </Section>

      <section className="card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{tr("فئات الزبائن", "Client tiers")}</h2>
          {can("clients", "create") && (
            <button className="btn px-3 py-1 text-sm" onClick={() => setTierDlg("new")}>
              {tr("+ فئة", "+ Tier")}
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <tbody>
            {tiers.data.rows.map((t) => (
              <tr key={t.id}>
                <td className="td font-semibold">{pick(t)}</td>
                <td className="td num ltr">{t.discountPct}%</td>
                <td className="td">
                  <RowActions canEdit={can("clients", "edit")} canDelete={can("clients", "delete")} onEdit={() => setTierDlg(t)} onDelete={() => setDelTier(t)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card lg:col-span-2">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{tr("الاشتراكات الشهرية", "Monthly subscriptions")}</h2>
          {can("clients", "create") && (
            <button className="btn px-3 py-1 text-sm" onClick={() => setPlanDlg("new")}>
              {tr("+ اشتراك", "+ Plan")}
            </button>
          )}
        </div>
        {plans.data.rows.length === 0 ? (
          <p className="text-sm text-faint">{tr("ما في اشتراكات.", "No plans.")}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {plans.data.rows.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                  <td className="td font-semibold">{pick(p)}</td>
                  <td className="td num ltr">{money(p.monthlyFee, p.currency, lang)}</td>
                  <td className="td text-muted">
                    {tr(`${p.includedItems} قطعة مجانية`, `${p.includedItems} free items`)}
                    {p.discountPct > 0 && ` · ${p.discountPct}%`}
                  </td>
                  <td className="td">
                    <RowActions canEdit={can("clients", "edit")} canDelete={can("clients", "delete")} onEdit={() => setPlanDlg(p)} onDelete={() => setDelPlan(p)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {tierDlg && <TierDialog tier={tierDlg === "new" ? null : tierDlg} onClose={() => setTierDlg(null)} onSaved={() => (setTierDlg(null), void tiers.reload())} />}
      {planDlg && <PlanDialog plan={planDlg === "new" ? null : planDlg} onClose={() => setPlanDlg(null)} onSaved={() => (setPlanDlg(null), void plans.reload())} />}
      {delTier && <DeleteConfirm name={pick(delTier)} path={`/clients/tiers/${delTier.id}`} onClose={() => setDelTier(null)} onDone={() => void tiers.reload()} />}
      {delPlan && <DeleteConfirm name={pick(delPlan)} path={`/clients/plans/${delPlan.id}`} onClose={() => setDelPlan(null)} onDone={() => void plans.reload()} />}
    </div>
  );
}
