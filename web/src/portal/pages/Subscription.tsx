import { useState } from "react";
import { Spinner } from "../../components/ui";
import { post } from "../../lib/api";
import type { Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import { Sheet, useMoney, useRefreshOn } from "../shared";
import { Ring, type PortalSubscription } from "./Home";

interface Plan {
  id: string;
  nameAr: string;
  nameEn: string;
  monthlyFee: number;
  currency: Currency;
  discountPct: number;
  includedItems: number;
}
interface SubData {
  current: PortalSubscription | null;
  plans: Plan[];
  requests: { id: string; planId: string; status: "pending" | "accepted" | "declined" | "cancelled"; declineReason: string; createdAt: string }[];
  history: { id: string; nameAr: string; nameEn: string; startDate: string; endDate: string; status: string }[];
}

export function SubscriptionPage() {
  const { tr, pick, fmtDate, err } = useI18n();
  const m = useMoney();
  const toast = useToast();
  const { data, reload } = useData<SubData>("/portal/subscription");
  useRefreshOn(reload);
  const [chosen, setChosen] = useState<Plan | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return <Spinner />;
  const pending = data.requests.find((r) => r.status === "pending");
  const lastDeclined = data.requests[0]?.status === "declined" ? data.requests[0] : null;
  const planName = (id: string) => {
    const p = data.plans.find((x) => x.id === id);
    return p ? pick(p) : "";
  };

  const send = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await post("/portal/subscription-requests", { planId: chosen.id, note });
      toast(tr("تم إرسال طلب الاشتراك", "Plan request sent"));
      setChosen(null);
      setNote("");
      await reload();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (id: string) => {
    try {
      await post(`/portal/subscription-requests/${id}/cancel`);
      await reload();
    } catch (e) {
      toast(err(e), "error");
    }
  };

  const c = data.current;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{tr("اشتراكي", "My plan")}</h1>

      {c ? (
        <section className="portal-hero rounded-3xl p-5 text-white shadow-lg shadow-brand/20">
          <div className="flex items-center gap-4">
            <Ring value={c.availableIncluded} max={c.includedItems} label={tr("متبقي", "left")} />
            <div className="min-w-0">
              <div className="text-xs text-white/80">{tr("اشتراكك الحالي", "Current plan")}</div>
              <div className="truncate text-2xl font-bold">{pick(c)}</div>
              <div className="text-sm text-white/85 num ltr text-start">
                {m(c.monthlyFee, c.currency)} / {tr("شهر", "month")}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl bg-white/15 p-2">
              <div className="text-lg font-bold num">{c.includedItems}</div>
              <div className="text-xs text-white/80">{tr("مجاناً شهرياً", "free / month")}</div>
            </div>
            <div className="rounded-xl bg-white/15 p-2">
              <div className="text-lg font-bold num">{c.usedIncluded}</div>
              <div className="text-xs text-white/80">{tr("استُخدمت", "used")}</div>
            </div>
            <div className="rounded-xl bg-white/15 p-2">
              <div className="text-lg font-bold num">{c.discountPct}%</div>
              <div className="text-xs text-white/80">{tr("خصم", "discount")}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-white/85">
            {fmtDate(c.startDate)} → {fmtDate(c.endDate)} · {c.autoRenew ? tr("يتجدد تلقائياً", "Renews automatically") : tr("لا يتجدد", "Does not renew")}
          </div>
        </section>
      ) : pending ? (
        <div className="card rounded-3xl p-5 text-center">
          <div className="text-4xl" aria-hidden>
            ⏳
          </div>
          <div className="mt-2 text-lg font-bold">{tr("طلبك قيد المراجعة", "Your request is under review")}</div>
          <div className="text-muted">{planName(pending.planId)}</div>
          <button className="btn mt-4 text-bad" onClick={() => void cancel(pending.id)}>
            {tr("إلغاء الطلب", "Cancel request")}
          </button>
        </div>
      ) : (
        <div className="rounded-3xl bg-sunken/70 p-5">
          <div className="text-lg font-bold">{tr("لا يوجد اشتراك بعد", "No plan yet")}</div>
          <div className="text-muted">{tr("اختر باقة ووفّر على كل طلب.", "Pick a plan and save on every order.")}</div>
          {lastDeclined && (
            <div className="mt-3 rounded-xl bg-bad/10 p-3 text-sm text-bad">
              {tr("رُفض طلبك السابق", "Your last request was declined")}
              {lastDeclined.declineReason ? `: ${lastDeclined.declineReason}` : ""}
            </div>
          )}
        </div>
      )}

      {!c && !pending && (
        <section>
          <h2 className="mb-2 text-lg font-bold">{tr("الباقات", "Plans")}</h2>
          {data.plans.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line px-4 py-8 text-center text-faint">{tr("لا باقات متاحة حالياً", "No plans available right now")}</div>
          ) : (
            <div className="grid gap-3">
              {data.plans.map((p, i) => (
                <button key={p.id} onClick={() => setChosen(p)} className={`card relative rounded-3xl p-5 text-start transition-transform active:scale-[0.99] ${i === Math.floor(data.plans.length / 2) && data.plans.length > 1 ? "border-2 border-brand" : ""}`}>
                  {i === Math.floor(data.plans.length / 2) && data.plans.length > 1 && <span className="absolute -top-2.5 end-4 rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold text-white">{tr("الأكثر طلباً", "Popular")}</span>}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-bold">{pick(p)}</span>
                    <span className="text-xl font-bold num ltr">{m(p.monthlyFee, p.currency)}</span>
                  </div>
                  <ul className="mt-2 grid gap-1 text-sm text-muted">
                    {p.includedItems > 0 && <li>✓ {tr(`${p.includedItems} قطعة مجانية كل شهر`, `${p.includedItems} free items every month`)}</li>}
                    {p.discountPct > 0 && <li>✓ {tr(`خصم ${p.discountPct}% على كل طلب`, `${p.discountPct}% off every order`)}</li>}
                    <li>✓ {tr("يتجدد شهرياً", "Renews monthly")}</li>
                  </ul>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {data.history.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-bold">{tr("السجل", "History")}</h2>
          <ul className="card divide-y divide-line rounded-3xl p-0">
            {data.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="font-semibold">{pick(h)}</span>
                <span className="text-faint">
                  {fmtDate(h.startDate)} → {fmtDate(h.endDate)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chosen && (
        <Sheet
          title={pick(chosen)}
          onClose={() => setChosen(null)}
          footer={
            <button className="btn btn-primary w-full !py-3" disabled={busy} onClick={send}>
              {tr("أرسل طلب الاشتراك", "Request this plan")}
            </button>
          }
        >
          <p className="text-muted">{tr(`سيُضاف ${m(chosen.monthlyFee, chosen.currency)} إلى حسابك كل شهر بعد موافقة المحل.`, `${m(chosen.monthlyFee, chosen.currency)} will be added to your account each month once the shop approves.`)}</p>
          <label className="label mt-4" htmlFor="sub-note">
            {tr("ملاحظة (اختياري)", "Note (optional)")}
          </label>
          <textarea id="sub-note" className="input min-h-[72px] !text-base" maxLength={250} value={note} onChange={(e) => setNote(e.target.value)} />
        </Sheet>
      )}
    </div>
  );
}
