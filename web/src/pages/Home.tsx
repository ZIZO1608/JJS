import { Link } from "react-router-dom";
import { MODULE_LABEL, type Module } from "@shared/permissions";
import { Icon } from "../components/Icon";
import { pathFor } from "../components/Layout";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { DashboardPage } from "./Dashboard";

/** What each big button on the simple home is for (manager & members). */
const SIMPLE_TILES: { m: Module; to?: string; ar: string; en: string; titleAr?: string; titleEn?: string }[] = [
  { m: "orders", to: "/orders/new", titleAr: "طلب جديد", titleEn: "New order", ar: "سجّل طلب زبون واطبع الفاتورة", en: "Take an order and print the receipt" },
  { m: "warehouse", ar: "حضّر، اطبع ملصقات الصلاحية، وسجّل الهدر", en: "Make, print expiry labels and log waste" },
  { m: "clients", ar: "سجّل دفعة من زبون وشوف رصيده", en: "Record a client's payment and see the balance" },
  { m: "orders", ar: "طلبات اليوم والتوصيل", en: "Today's orders and deliveries" },
  { m: "daily_close", ar: "عدّ الصندوق واقفل اليوم", en: "Count the cash and lock the day" },
];

function SimpleHome() {
  const { pick, tr } = useI18n();
  const { can } = useAuth();
  const tiles = SIMPLE_TILES.filter((x) => can(x.m, x.to ? "create" : "view"));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {tiles.map((x, i) => (
        <Link
          key={i}
          to={x.to ?? pathFor(x.m)}
          className={`flex min-h-[132px] flex-col gap-1.5 rounded-2xl border p-5 transition active:scale-[.98] ${
            i === 0 ? "border-ink bg-ink text-bg sm:col-span-2" : "border-line bg-surface hover:border-ink"
          }`}
        >
          <Icon name={x.m} className="mb-1 h-7 w-7" />
          <span className="text-xl font-bold">{x.titleAr ? tr(x.titleAr, x.titleEn!) : pick(MODULE_LABEL[x.m])}</span>
          <span className={`text-sm ${i === 0 ? "opacity-75" : "text-muted"}`}>{pick(x)}</span>
        </Link>
      ))}
    </div>
  );
}

export function HomePage() {
  const { t, fmtDate, tr } = useI18n();
  const { me, simple, can } = useAuth();
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t("home.hello", { name: me?.name ?? "" })}</h1>
          <p className="mt-1 text-muted">
            {fmtDate(new Date())} {simple && `· ${t("home.simpleHint")}`}
          </p>
        </div>
        {!simple && (
          <div className="flex flex-wrap gap-2">
            {can("orders", "create") && (
              <Link to="/orders/new" className="btn btn-primary">
                {tr("+ طلب جديد", "+ New order")}
              </Link>
            )}
            {can("warehouse", "create") && (
              <Link to="/warehouse/produce" className="btn">
                {tr("تحضير وملصقات", "Make & label")}
              </Link>
            )}
            {can("daily_close", "view") && (
              <Link to="/close" className="btn">
                {tr("إقفال اليوم", "Close the day")}
              </Link>
            )}
          </div>
        )}
      </div>
      {simple ? <SimpleHome /> : can("dashboard", "view") ? <DashboardPage embedded /> : null}
    </div>
  );
}
