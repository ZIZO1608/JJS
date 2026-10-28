import { Link } from "react-router-dom";
import { MODULE_LABEL, type Module } from "@shared/permissions";
import { Icon } from "../components/Icon";
import { pathFor } from "../components/Layout";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { DashboardPage } from "./Dashboard";
import { FiveAnswersCard } from "./five/FiveAnswers";

/** What each big button on the simple home is for (manager & members). */
const SIMPLE_TILES: { m: Module; icon?: "production" | "distribution"; to?: string; ar: string; en: string; titleAr?: string; titleEn?: string }[] = [
  { m: "orders", to: "/orders/new", titleAr: "فاتورة جديدة", titleEn: "New invoice", ar: "فاتورة لمحل أو زبون، دفع كامل أو جزئي، واطبعها", en: "Invoice a shop or client, full or part payment, and print it" },
  { m: "warehouse", icon: "production", to: "/production/new", titleAr: "إنتاج الصبح", titleEn: "Morning production", ar: "اعمل دفعة بكل الأصناف واطبع الملصقات", en: "Make the batch for every product and print labels" },
  { m: "orders", icon: "distribution", to: "/distribution/route", titleAr: "خط التوزيع", titleEn: "Route sheet", ar: "المحلات اليوم، بالأمانة، والمرتجعات", en: "Today's shops, consignment and returns" },
  { m: "warehouse", ar: "البرّاد، الهدر والجرد", en: "Fridge, waste and counts" },
  { m: "clients", ar: "سجّل دفعة من زبون وشوف رصيده", en: "Record a client's payment and see the balance" },
  { m: "orders", ar: "طلبات اليوم والتوصيل", en: "Today's orders and deliveries" },
  { m: "daily_close", ar: "عدّ الصندوق واقفل اليوم", en: "Count the cash and lock the day" },
];

function SimpleHome() {
  const { pick, tr } = useI18n();
  const { can } = useAuth();
  const tiles = SIMPLE_TILES.filter((x) => can(x.m, x.icon === "distribution" ? "edit" : x.to && !x.icon ? "create" : "view"));
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
          <Icon name={x.icon ?? x.m} className="mb-1 h-7 w-7" />
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
              <Link to="/production/new" className="btn">
                {tr("إنتاج وملصقات", "Make & label")}
              </Link>
            )}
            {can("orders", "view") && (
              <Link to="/distribution/route" className="btn">
                {tr("خط التوزيع", "Route sheet")}
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
      {simple ? (
        <SimpleHome />
      ) : can("dashboard", "view") ? (
        <div className="grid gap-5">
          <FiveAnswersCard />
          <DashboardPage embedded />
        </div>
      ) : null}
    </div>
  );
}
