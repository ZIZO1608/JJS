import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { MODULE_LABEL, type Module } from "@shared/permissions";
import { ApiError, get, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { Icon } from "./Icon";
import { InboxProvider, NotificationBell, useInbox } from "./Inbox";
import { InstallButton } from "./InstallButton";
import { MoneyCloud } from "./MoneyCloud";
import { SupportLink } from "./SupportLink";
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
    assets: "/fixed-assets",
    people: "/people",
    reports: "/reports",
    users: "/users",
    roles: "/roles",
    audit: "/audit",
    settings: "/settings",
  } as Record<Module, string>)[m];

/** Screens that are not a permission module of their own: they follow another module's permission. */
type Extra = "day" | "deliveries" | "distribution" | "production" | "requests";
type NavKey = Module | Extra;
const EXTRA: Record<Extra, { module: Module; action?: "edit"; to: string; ar: string; en: string }> = {
  day: { module: "dashboard", to: "/day", ar: "يومي", en: "My day" },
  deliveries: { module: "orders", action: "edit", to: "/deliveries", ar: "طلبات التسليم", en: "Deliveries" },
  distribution: { module: "orders", action: "edit", to: "/distribution", ar: "التوزيع", en: "Distribution" },
  production: { module: "warehouse", to: "/production", ar: "الإنتاج", en: "Production" },
  // answering client requests is for whoever may edit orders (admin, manager)
  requests: { module: "orders", action: "edit", to: "/requests", ar: "طلبات الزبائن", en: "Client requests" },
};
const isExtra = (k: NavKey): k is Extra => k in EXTRA;

const FULL_GROUPS: NavKey[][] = [
  ["home", "day"],
  ["orders", "deliveries", "requests", "distribution", "daily_close", "clients"],
  ["production", "menu", "warehouse", "purchasing", "costing"],
  ["expenses", "assets", "people", "reports"],
  ["users", "roles", "audit", "settings"],
];
const SIMPLE_ITEMS: NavKey[] = ["home", "day", "orders", "deliveries", "requests", "production", "warehouse", "distribution", "clients", "daily_close", "expenses", "reports"];

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

/** `firstTime`: the password was chosen by someone else (server variables, the admin), so we ask for their own. */
function PasswordDialog({ onClose, firstTime = false }: { onClose: () => void; firstTime?: boolean }) {
  const { t, tr, err } = useI18n();
  const { changePassword } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ current: "", next: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await changePassword(f.current, f.next);
      toast(t("auth.passwordChanged"));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "invalid_input" ? t("auth.passwordHint") : err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={firstTime ? tr("اختار كلمة مرور خاصة فيك", "Choose your own password") : t("auth.changePassword")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {firstTime ? tr("لاحقاً", "Later") : t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !f.current || f.next.length < 6}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </>
      }
    >
      {firstTime && (
        <p className="mb-3 rounded-lg bg-sunken p-3 text-sm text-muted">
          {tr(
            "كلمة المرور الحالية حدا تاني اختارها لك. اختار وحدة ما حدا بيعرفها غيرك، لحتى يضل حسابك إلك لحالك.",
            "Your current password was chosen by someone else. Pick one only you know, so your account stays yours.",
          )}
        </p>
      )}
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

/** A calm nudge instead of a pop-up: staff can still serve the customer in front of them first. */
function OwnPasswordBanner({ onChoose, onLater }: { onChoose: () => void; onLater: () => void }) {
  const { tr } = useI18n();
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
      <span className="text-lg" aria-hidden>
        🔑
      </span>
      <p className="min-w-0 flex-1 basis-56">{tr("كلمة مرورك حدا تاني اختارها. اختار وحدة ما بيعرفها غيرك.", "Your password was chosen by someone else. Pick one only you know.")}</p>
      <div className="flex w-full justify-end gap-2 sm:w-auto">
        <button className="btn btn-ghost px-3 py-1.5" onClick={onLater}>
          {tr("لاحقاً", "Later")}
        </button>
        <button className="btn btn-primary px-3 py-1.5" onClick={onChoose}>
          {tr("اختار كلمة مرور", "Choose my own")}
        </button>
      </div>
    </div>
  );
}

export function Layout() {
  return (
    <InboxProvider>
      <LayoutInner />
    </InboxProvider>
  );
}

/** Pending client requests next to the nav label. */
function NavBadge({ k }: { k: NavKey }) {
  const { pending } = useInbox();
  const n = k === "requests" ? pending.orders + pending.subscriptions + pending.reports : 0;
  if (!n) return null;
  return <span className="ms-auto grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1.5 text-[11px] font-bold text-white num">{n}</span>;
}

function LayoutInner() {
  const { t, pick, lang } = useI18n();
  const { me, business, can, simple, logout, setLanguage } = useAuth();
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  // phone: the menu bar scrolls sideways; bring the open page's link into view
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    nav.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
  // once per session ("Later" waits until next time), until they pick their own password
  const [askOwn, setAskOwn] = useState(() => {
    try {
      return sessionStorage.getItem("jjs.pwLater") !== "1";
    } catch {
      return true;
    }
  });
  const laterOwn = () => {
    setAskOwn(false);
    try {
      sessionStorage.setItem("jjs.pwLater", "1");
    } catch {
      /* storage blocked: it just asks again next load */
    }
  };
  if (!me) return null;

  const visible = (k: NavKey) => (isExtra(k) ? can(EXTRA[k].module, EXTRA[k].action ?? "view") : can(k, "view"));
  const to = (k: NavKey) => (isExtra(k) ? EXTRA[k].to : pathFor(k));
  const label = (k: NavKey) => (isExtra(k) ? pick(EXTRA[k]) : pick(MODULE_LABEL[k]));
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14.5px] ${isActive ? "bg-sunken font-semibold text-ink" : "text-muted hover:text-ink"}`;

  return (
    <div className="flex min-h-full flex-col">
      {/* one row on every screen, so the sticky menu bar below always sits right under it */}
      <header className="sticky top-0 z-30 flex h-[57px] flex-nowrap items-center gap-2 border-b border-line bg-surface px-3 sm:gap-3 sm:px-4">
        <img src={business?.logo || "/logo.png"} alt="" className="h-8 w-auto" />
        <div className="hidden min-w-0 leading-tight sm:block">
          <div className="truncate font-bold">{business ? pick(business) : t("app.name")}</div>
        </div>
        <div className="ms-auto flex flex-nowrap items-center justify-end gap-1 sm:gap-3">
          {!simple && <RateChip />}
          <InstallButton compact className="px-2.5 py-1.5 text-sm sm:px-3" />
          {me.role.systemKey === "admin" && <MoneyCloud />}
          <SupportLink variant="icon" className="h-9 w-9 rounded-lg hover:bg-sunken" />
          <NotificationBell />
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
                <SupportLink variant="row" />
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
          <nav ref={navRef} className="nav-scroll sticky top-[57px] z-20 flex gap-1.5 overflow-x-auto border-b border-line bg-surface px-4 py-2" aria-label="Sections">
            {SIMPLE_ITEMS.filter(visible).map((m) => (
              <NavLink key={m} to={to(m)} end={m === "home"} className={({ isActive }) => `${navClass({ isActive })} whitespace-nowrap px-4 py-2.5 text-[15.5px]`}>
                <Icon name={m} />
                {label(m)}
                <NavBadge k={m} />
              </NavLink>
            ))}
          </nav>
          <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
            {askOwn && me.tempPassword && <OwnPasswordBanner onChoose={() => setPw(true)} onLater={laterOwn} />}
            <Outlet />
          </main>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav ref={navRef} className="nav-scroll sticky top-[57px] z-20 flex gap-1 overflow-x-auto border-b border-line bg-surface p-2 md:static md:w-60 md:flex-col md:overflow-visible md:border-b-0 md:border-e md:p-3" aria-label="Sections">
            {FULL_GROUPS.map((g, i) => {
              const items = g.filter(visible);
              if (!items.length) return null;
              return (
                <div key={i} className="flex gap-1 md:flex-col md:border-b md:border-line md:pb-2 md:last:border-b-0 [&:not(:first-child)]:md:pt-2">
                  {items.map((m) => (
                    <NavLink key={m} to={to(m)} end={m === "home"} className={({ isActive }) => `${navClass({ isActive })} whitespace-nowrap`}>
                      <Icon name={m} />
                      <span>{label(m)}</span>
                      <NavBadge k={m} />
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-7">
            <div className="mx-auto max-w-6xl">
              {askOwn && me.tempPassword && <OwnPasswordBanner onChoose={() => setPw(true)} onLater={laterOwn} />}
              <Outlet />
            </div>
          </main>
        </div>
      )}
      {pw && <PasswordDialog firstTime={!!me.tempPassword} onClose={() => setPw(false)} />}
    </div>
  );
}
