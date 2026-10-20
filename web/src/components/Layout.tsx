import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { MODULE_LABEL, type Module } from "@shared/permissions";
import { ApiError, get, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { Icon } from "./Icon";
import { Field, Modal, TextInput } from "./ui";

export const pathFor = (m: Module) =>
  ({
    home: "/",
    dashboard: "/dashboard",
    orders: "/orders",
    daily_close: "/close",
    clients: "/clients",
    menu: "/menu",
    warehouse: "/warehouse",
    purchasing: "/purchasing",
    costing: "/costing",
    expenses: "/expenses",
    assets: "/assets",
    people: "/people",
    reports: "/reports",
    users: "/users",
    roles: "/roles",
    audit: "/audit",
    settings: "/settings",
  } as Record<Module, string>)[m];

const FULL_GROUPS: Module[][] = [
  ["home", "dashboard"],
  ["orders", "daily_close", "clients"],
  ["menu", "warehouse", "purchasing", "costing"],
  ["expenses", "assets", "people", "reports"],
  ["users", "roles", "audit", "settings"],
];
const SIMPLE_ITEMS: Module[] = ["home", "orders", "warehouse", "clients", "daily_close", "expenses", "reports"];

function RateChip() {
  const { t } = useI18n();
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    get<{ rate: number | null }>("/fx/current")
      .then((r) => setRate(r.rate))
      .catch(() => undefined);
  }, []);
  if (!rate) return null;
  return (
    <span className="hidden whitespace-nowrap text-xs text-faint md:inline">
      <span className="num">{t("currency.perUsd", { rate: rate.toLocaleString("en-US") })}</span>
    </span>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ current: "", next: "" });
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await put("/auth/me/password", f);
      toast(t("auth.passwordChanged"));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "invalid_input" ? t("auth.passwordHint") : err(e));
    }
  };
  return (
    <Modal
      title={t("auth.changePassword")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!f.current || f.next.length < 6}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t("auth.currentPassword")} htmlFor="pw-cur">
          <TextInput id="pw-cur" type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </Field>
        <Field label={t("auth.newPassword")} htmlFor="pw-new" hint={t("auth.passwordHint")} error={error}>
          <TextInput id="pw-new" type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function Layout() {
  const { t, pick, lang } = useI18n();
  const { me, business, can, simple, logout, setLanguage } = useAuth();
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  if (!me) return null;

  const visible = (m: Module) => can(m, "view");
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14.5px] ${isActive ? "bg-sunken font-semibold text-ink" : "text-muted hover:text-ink"}`;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <img src={business?.logo || "/logo.png"} alt="" className="h-8 w-auto" />
        <div className="min-w-0 leading-tight">
          <div className="truncate font-bold">{business ? pick(business) : t("app.name")}</div>
          <div className="text-xs text-faint">{t("app.offline")}</div>
        </div>
        <div className="ms-auto flex items-center gap-3">
          {!simple && <RateChip />}
          <div className="inline-flex rounded-lg bg-sunken p-0.5" role="group" aria-label={t("auth.language")}>
            {(["ar", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => void setLanguage(l)}
                aria-pressed={lang === l}
                className={`rounded-md px-2.5 py-1 text-sm font-semibold ${lang === l ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
              >
                {l === "ar" ? "عربي" : "EN"}
              </button>
            ))}
          </div>
          <div className="relative">
            <button className="btn btn-ghost px-2.5 py-1.5" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-sm font-bold text-bg">{me.name.slice(0, 1).toUpperCase()}</span>
              <span className="hidden text-start leading-tight sm:block">
                <span className="block text-sm">{me.name}</span>
                <span className="block text-xs font-normal text-faint">{pick(me.role)}</span>
              </span>
            </button>
            {menu && (
              <div className="absolute end-0 z-40 mt-1 w-52 rounded-xl border border-line bg-surface p-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
                <button className="w-full rounded-lg px-3 py-2 text-start hover:bg-sunken" onClick={() => (setMenu(false), setPw(true))}>
                  {t("auth.changePassword")}
                </button>
                <button className="w-full rounded-lg px-3 py-2 text-start text-bad hover:bg-sunken" onClick={() => void logout()}>
                  {t("auth.logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {simple ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <nav className="sticky top-[57px] z-20 flex gap-1.5 overflow-x-auto border-b border-line bg-surface px-4 py-2" aria-label="Sections">
            {SIMPLE_ITEMS.filter(visible).map((m) => (
              <NavLink key={m} to={pathFor(m)} end={m === "home"} className={({ isActive }) => `${navClass({ isActive })} whitespace-nowrap px-4 py-2.5 text-[15.5px]`}>
                <Icon name={m} />
                {pick(MODULE_LABEL[m])}
              </NavLink>
            ))}
          </nav>
          <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
            <Outlet />
          </main>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface p-2 md:w-60 md:flex-col md:overflow-visible md:border-b-0 md:border-e md:p-3" aria-label="Sections">
            {FULL_GROUPS.map((g, i) => {
              const items = g.filter(visible);
              if (!items.length) return null;
              return (
                <div key={i} className="flex gap-1 md:flex-col md:border-b md:border-line md:pb-2 md:last:border-b-0 [&:not(:first-child)]:md:pt-2">
                  {items.map((m) => (
                    <NavLink key={m} to={pathFor(m)} end={m === "home"} className={({ isActive }) => `${navClass({ isActive })} whitespace-nowrap`}>
                      <Icon name={m} />
                      <span>{pick(MODULE_LABEL[m])}</span>
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-7">
            <div className="mx-auto max-w-6xl">
              <Outlet />
            </div>
          </main>
        </div>
      )}
      {pw && <PasswordDialog onClose={() => setPw(false)} />}
    </div>
  );
}
