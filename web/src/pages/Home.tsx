import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MODULE_LABEL, MODULE_STAGE, type Module } from "@shared/permissions";
import { Icon } from "../components/Icon";
import { CURRENT_STAGE, pathFor } from "../components/Layout";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";

/** What each big button on the simple home is for (manager & members). */
const SIMPLE_TILES: { m: Module; ar: string; en: string }[] = [
  { m: "orders", ar: "سجّل طلب زبون واطبع الفاتورة", en: "Take an order and print the receipt" },
  { m: "warehouse", ar: "اطبع ملصقات الصلاحية وسجّل الهدر", en: "Print expiry labels and log waste" },
  { m: "clients", ar: "سجّل دفعة من زبون", en: "Record a client's payment" },
  { m: "daily_close", ar: "عدّ الصندوق واقفل اليوم", en: "Count the cash and lock the day" },
];

const ADMIN_TILES: Module[] = ["users", "roles", "settings", "audit"];

function SimpleHome() {
  const { t, pick } = useI18n();
  const { can } = useAuth();
  const tiles = SIMPLE_TILES.filter((x) => can(x.m, "view"));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {tiles.map((x, i) => {
        const later = MODULE_STAGE[x.m] > CURRENT_STAGE;
        return (
          <Link
            key={x.m}
            to={pathFor(x.m)}
            className={`flex min-h-[140px] flex-col gap-1.5 rounded-2xl border p-5 transition active:scale-[.98] ${
              i === 0 ? "border-ink bg-ink text-bg" : "border-line bg-surface hover:border-ink"
            }`}
          >
            <Icon name={x.m} className="mb-1 h-7 w-7" />
            <span className="text-xl font-bold">{pick(MODULE_LABEL[x.m])}</span>
            <span className={`text-sm ${i === 0 ? "opacity-75" : "text-muted"}`}>{pick(x)}</span>
            {later && <span className={`mt-auto w-fit rounded-full px-2 text-xs ${i === 0 ? "bg-bg/15" : "bg-sunken text-faint"}`}>{t("app.comingStage", { n: MODULE_STAGE[x.m] })}</span>}
          </Link>
        );
      })}
    </div>
  );
}

function AdminHome() {
  const { t, pick, fmtDate } = useI18n();
  const { can } = useAuth();
  const [rate, setRate] = useState<{ rate: number | null; source: string | null } | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null | undefined>(undefined);
  const [userCount, setUserCount] = useState<number | null>(null);
  useEffect(() => {
    get<{ rate: number | null; source: string | null }>("/fx/current").then(setRate).catch(() => undefined);
    if (can("settings", "view")) get<{ backups: { createdAt: string }[] }>("/backups").then((r) => setLastBackup(r.backups[0]?.createdAt ?? null)).catch(() => undefined);
    if (can("users", "view")) get<{ users: unknown[] }>("/users").then((r) => setUserCount(r.users.length)).catch(() => undefined);
  }, [can]);

  return (
    <>
      <p className="mb-5 max-w-2xl text-muted">{t("home.adminHint")}</p>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="text-sm text-muted">{t("home.rate")}</div>
          <div className="mt-1 text-xl font-bold num">{rate?.rate ? t("currency.perUsd", { rate: rate.rate.toLocaleString("en-US") }) : t("home.noRate")}</div>
        </div>
        <div className="card">
          <div className="text-sm text-muted">{t("home.backups")}</div>
          <div className="mt-1 text-xl font-bold">{lastBackup ? fmtDate(lastBackup, true) : lastBackup === null ? t("home.noBackup") : "…"}</div>
        </div>
        <div className="card">
          <div className="text-sm text-muted">{t("home.users")}</div>
          <div className="mt-1 text-xl font-bold num">{userCount ?? "…"}</div>
        </div>
      </div>
      <h2 className="mb-3 font-semibold">{t("home.quick")}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {ADMIN_TILES.filter((m) => can(m, "view")).map((m) => (
          <Link key={m} to={pathFor(m)} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 hover:border-ink">
            <Icon name={m} className="h-6 w-6" />
            <span className="font-semibold">{pick(MODULE_LABEL[m])}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

export function HomePage() {
  const { t, fmtDate } = useI18n();
  const { me, simple } = useAuth();
  return (
    <div>
      <h1 className="text-3xl font-bold">{t("home.hello", { name: me?.name ?? "" })}</h1>
      <p className="mb-6 mt-1 text-muted">
        {fmtDate(new Date())} {simple && `· ${t("home.simpleHint")}`}
      </p>
      {simple ? <SimpleHome /> : <AdminHome />}
    </div>
  );
}

export function ComingLater({ module }: { module: Module }) {
  const { t, pick } = useI18n();
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <Icon name={module} className="mx-auto mb-4 h-10 w-10 text-faint" />
      <h1 className="text-2xl font-bold">{pick(MODULE_LABEL[module])}</h1>
      <p className="mt-1 font-semibold text-muted">{t("app.comingTitle", { n: MODULE_STAGE[module] })}</p>
      <p className="mt-3 text-muted">{t("app.comingBody")}</p>
      <Link to="/" className="btn mt-6">
        {t("app.back")}
      </Link>
    </div>
  );
}
