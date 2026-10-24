import { Link } from "react-router-dom";
import { InstallHelp, useInstall } from "../../components/InstallButton";
import { Spinner } from "../../components/ui";
import type { Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useData } from "../../lib/useData";
import type { PortalClient } from "../auth";
import { stageOf, StageChip, useAgo, useMoney, useRefreshOn, type PortalRequest } from "../shared";

export interface PortalSubscription {
  planId: string;
  nameAr: string;
  nameEn: string;
  monthlyFee: number;
  currency: Currency;
  discountPct: number;
  includedItems: number;
  usedIncluded: number;
  availableIncluded: number;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
}

interface HomeData {
  client: PortalClient;
  balanceUsd: number;
  subscription: PortalSubscription | null;
  pendingSubscriptionRequest: boolean;
  loyalty: { enabled: boolean; buyQty: number; freeQty: number; progress: number; available: number };
  month: { orders: number; items: number };
  requests: PortalRequest[];
}

/** A ring that fills as the included items are used. */
export function Ring({ value, max, label }: { value: number; max: number; label: string }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const part = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="7" />
        <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - part)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
        <span className="text-2xl font-bold num">{value}</span>
        <span className="text-[10.5px] opacity-80">{label}</span>
      </div>
    </div>
  );
}

/** Invites the client to put the app on their home screen / desktop until it is installed. */
function InstallCard() {
  const { tr } = useI18n();
  const { installed, install, help, closeHelp } = useInstall();
  if (installed) return null;
  return (
    <>
      <button onClick={() => void install()} className="flex items-center gap-4 rounded-3xl bg-ink p-4 text-start text-bg transition-transform active:scale-[0.98]">
        <img src="/icon-192.png" alt="" className="h-14 w-14 shrink-0 rounded-2xl bg-white p-1" />
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{tr("ثبّت تطبيق JJ's 📲", "Install the JJ's app 📲")}</span>
          <span className="block text-sm opacity-75">{tr("أيقونة على هاتفك أو الكمبيوتر، واطلب بضغطة واحدة", "An icon on your phone or computer — order in one tap")}</span>
        </span>
        <span className="rounded-full bg-brand px-3.5 py-2 text-sm font-bold text-white">{tr("تثبيت", "Install")}</span>
      </button>
      {help && <InstallHelp onClose={closeHelp} />}
    </>
  );
}

export function HomePage() {
  const { tr, pick, fmtDate } = useI18n();
  const m = useMoney();
  const ago = useAgo();
  const { data, reload } = useData<HomeData>("/portal/home");
  useRefreshOn(reload);
  if (!data) return <Spinner />;
  const owes = data.balanceUsd < -0.004;
  const credit = data.balanceUsd > 0.004;
  const hour = new Date().getHours();
  const greet = hour < 12 ? tr("صباح الخير", "Good morning") : hour < 18 ? tr("نهارك سعيد", "Good afternoon") : tr("مساء الخير", "Good evening");
  const sub = data.subscription;
  const loy = data.loyalty;

  return (
    <div className="grid gap-4">
      {/* greeting + balance */}
      <section className="portal-hero relative overflow-hidden rounded-3xl p-5 text-white shadow-lg shadow-brand/20">
        <div className="text-sm text-white/80">{greet} 👋</div>
        <div className="mt-0.5 truncate text-2xl font-bold">{data.client.name}</div>
        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-white/75">{owes ? tr("المبلغ المستحق عليك", "You owe") : credit ? tr("رصيدك لدينا", "Your credit") : tr("حسابك", "Your account")}</div>
            <div className="text-3xl font-bold num ltr text-start">{owes || credit ? m(Math.abs(data.balanceUsd)) : tr("لا ديون ✓", "All clear ✓")}</div>
          </div>
          <div className="text-end text-xs text-white/80">
            <div className="num">
              {data.month.orders} {tr("طلب هذا الشهر", "orders this month")}
            </div>
            <div className="num">
              {data.month.items} {tr("قطعة", "items")}
            </div>
          </div>
        </div>
      </section>

      <Link to="/portal/order" className="flex items-center justify-between gap-3 rounded-3xl border-2 border-brand bg-brand/10 px-5 py-4 transition-transform active:scale-[0.98]">
        <div>
          <div className="text-lg font-bold text-brand">{tr("اطلب الآن", "Order now")}</div>
          <div className="text-sm text-muted">{tr("اختر من القائمة بأسعارك الخاصة", "Pick from the menu at your prices")}</div>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brand text-2xl text-white" aria-hidden>
          +
        </span>
      </Link>

      <InstallCard />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* subscription */}
        {sub ? (
          <Link to="/portal/subscription" className="flex items-center gap-4 rounded-3xl bg-ink p-5 text-bg">
            <Ring value={sub.availableIncluded} max={sub.includedItems} label={tr("متبقي", "left")} />
            <div className="min-w-0">
              <div className="text-xs opacity-70">{tr("اشتراكك", "Your plan")}</div>
              <div className="truncate text-lg font-bold">{pick(sub)}</div>
              <div className="text-xs opacity-70">{tr(`حتى ${fmtDate(sub.endDate)}`, `Until ${fmtDate(sub.endDate)}`)}</div>
              {sub.discountPct > 0 && <div className="mt-1 inline-block rounded-full bg-bg/15 px-2 py-0.5 text-xs font-bold">−{sub.discountPct}%</div>}
            </div>
          </Link>
        ) : (
          <Link to="/portal/subscription" className="card flex items-center gap-4 rounded-3xl p-5">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-sunken text-2xl" aria-hidden>
              ⭐
            </span>
            <div className="min-w-0">
              <div className="font-bold">{data.pendingSubscriptionRequest ? tr("طلب الاشتراك قيد المراجعة", "Plan request under review") : tr("وفّر مع اشتراك شهري", "Save with a monthly plan")}</div>
              <div className="text-sm text-muted">{data.pendingSubscriptionRequest ? tr("سنخبرك فور الموافقة", "We'll let you know") : tr("قطع مجانية وخصم على كل طلب", "Free items and a discount on every order")}</div>
            </div>
          </Link>
        )}

        {/* loyalty stamps */}
        {loy.enabled && loy.buyQty > 0 && (
          <div className="card rounded-3xl p-5">
            <div className="flex items-center justify-between">
              <div className="font-bold">{tr("بطاقة الولاء", "Loyalty card")}</div>
              {loy.available > 0 && <span className="rounded-full bg-good/15 px-2.5 py-0.5 text-xs font-bold text-good">🎁 {tr(`${loy.available} مجاناً`, `${loy.available} free`)}</span>}
            </div>
            {loy.buyQty <= 12 ? (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${loy.progress}/${loy.buyQty}`}>
                {Array.from({ length: loy.buyQty }, (_, i) => (
                  <span key={i} className={`grid h-7 w-7 place-items-center rounded-full text-xs ${i < loy.progress ? "bg-brand text-white" : "border-2 border-dashed border-line text-faint"}`} aria-hidden>
                    {i < loy.progress ? "✓" : ""}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-3">
                <div className="h-3 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={loy.progress} aria-valuemax={loy.buyQty}>
                  <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${(loy.progress / loy.buyQty) * 100}%` }} />
                </div>
                <div className="mt-1 text-xs text-faint num">
                  {loy.progress} / {loy.buyQty}
                </div>
              </div>
            )}
            <div className="mt-2 text-sm text-muted">{tr(`${loy.buyQty - loy.progress} قطع أخرى وتحصل على ${loy.freeQty} مجاناً`, `${loy.buyQty - loy.progress} more and you get ${loy.freeQty} free`)}</div>
          </div>
        )}
      </div>

      {/* latest orders */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">{tr("آخر طلباتك", "Latest orders")}</h2>
          {data.requests.length > 0 && (
            <Link to="/portal/orders" className="text-sm font-semibold text-brand">
              {tr("الكل", "See all")}
            </Link>
          )}
        </div>
        {data.requests.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line px-4 py-8 text-center text-faint">{tr("لا طلبات بعد. ابدأ بأول طلب!", "No orders yet. Place your first one!")}</div>
        ) : (
          <div className="grid gap-2">
            {data.requests.map((r) => (
              <RequestRow key={r.id} r={r} ago={ago(r.createdAt)} money={m(r.order?.total ?? r.quotedTotal, r.order?.currency ?? r.currency)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function RequestRow({ r, ago, money }: { r: PortalRequest; ago: string; money: string }) {
  const { tr } = useI18n();
  return (
    <Link to={`/portal/orders/${r.id}`} className="card flex items-center gap-3 rounded-2xl p-3.5 transition-colors hover:border-brand/40">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sunken text-lg" aria-hidden>
        {r.fulfilment === "delivery" ? "🛵" : "🛍️"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-bold num">#{r.number}</span>
          <StageChip stage={stageOf(r)} />
        </div>
        <div className="truncate text-sm text-faint">
          {r.itemsCount} {tr("قطعة", "items")} · {ago}
        </div>
      </div>
      <div className="font-bold num ltr">{money}</div>
    </Link>
  );
}
