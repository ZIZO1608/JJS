import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { SupportLink } from "../components/SupportLink";
import { Spinner } from "../components/ui";
import { get, post } from "../lib/api";
import { chime } from "../lib/chime";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { PortalAuthProvider, usePortalAuth } from "./auth";
import { AccountPage, ChangePasswordPage, LoginPage } from "./pages/Account";
import { HomePage } from "./pages/Home";
import { NotificationsPage } from "./pages/Notifications";
import { NewOrderPage } from "./pages/NewOrder";
import { RequestDetailPage, RequestsPage } from "./pages/Requests";
import { SubscriptionPage } from "./pages/Subscription";
import { REFRESH_EVENT, Sheet, type PortalNotification } from "./shared";

export function PortalApp() {
  return (
    <PortalAuthProvider>
      <PortalRoutes />
    </PortalAuthProvider>
  );
}

function PortalRoutes() {
  const { status, client } = usePortalAuth();
  if (status === "loading") return <Spinner />;
  if (status === "login") return <LoginPage />;
  if (client?.mustChangePassword) return <ChangePasswordPage first />;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="portal" element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="order" element={<NewOrderPage />} />
          <Route path="orders" element={<RequestsPage />} />
          <Route path="orders/:id" element={<RequestDetailPage />} />
          <Route path="subscription" element={<SubscriptionPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

const ICONS = {
  home: "M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  sub: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  plus: "M12 5v14M5 12h14",
};
export function PIcon({ d, className = "h-6 w-6" }: { d: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[d]} />
    </svg>
  );
}

/** Price notifications already shown as a pop-up in this visit, so "Later" really means later. */
const SHOWN_KEY = "jjs.portal.quotes-shown";
const shownQuotes = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(SHOWN_KEY) ?? "[]");
  } catch {
    return [];
  }
};
const rememberShown = (id: string) => {
  try {
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...shownQuotes(), id].slice(-50)));
  } catch {
    /* private mode: it may pop up once more */
  }
};

/**
 * Polls the unread count; a new notification rings, shows a toast and refreshes the page.
 * Prices from the shop get more than a toast: a pop-up the client can't miss, also when they open the app later.
 */
function useNotificationWatch() {
  const { pick } = useI18n();
  const toast = useToast();
  const [unread, setUnread] = useState(0);
  const [quote, setQuote] = useState<PortalNotification | null>(null);
  const last = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const { unread: n } = await get<{ unread: number }>("/portal/notifications/unread-count");
        if (!alive) return;
        const first = last.current === null;
        const grew = !first && n > last.current!;
        if ((first && n > 0) || grew) {
          const { rows } = await get<{ rows: PortalNotification[] }>("/portal/notifications");
          if (!alive) return;
          const seen = shownQuotes();
          const priced = rows.find((x) => x.kind === "order_quoted" && !x.readAt && !seen.includes(x.id));
          if (priced) {
            rememberShown(priced.id);
            setQuote(priced);
          } else if (grew && rows[0]) toast(pick({ ar: rows[0].titleAr, en: rows[0].titleEn }));
          if (grew) {
            chime();
            window.dispatchEvent(new Event(REFRESH_EVENT));
          }
        }
        last.current = n;
        setUnread(n);
      } catch {
        /* offline for a moment: try again next tick */
      }
    };
    void tick();
    // only while the app is on screen
    const id = setInterval(() => document.visibilityState === "visible" && void tick(), 20_000);
    const onFocus = () => void tick();
    const onShow = () => document.visibilityState === "visible" && void tick();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("portal:notifications-read", onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("portal:notifications-read", onFocus);
    };
  }, [pick, toast]);
  return { unread, quote, closeQuote: () => setQuote(null) };
}

/** "Your prices are ready": one tap takes the client to the prices to approve them. */
function QuoteReadySheet({ n, onClose }: { n: PortalNotification; onClose: () => void }) {
  const { tr, pick } = useI18n();
  const navigate = useNavigate();
  const open = () => {
    post("/portal/notifications/read", { ids: [n.id] })
      .then(() => window.dispatchEvent(new Event("portal:notifications-read")))
      .catch(() => undefined);
    onClose();
    if (n.link) navigate(n.link);
  };
  return (
    <Sheet
      title={tr("وصلتك الأسعار!", "Your prices are here!")}
      onClose={onClose}
      footer={
        <div className="grid gap-2">
          <button className="btn btn-primary w-full !py-3.5 text-base font-bold" onClick={open} autoFocus>
            💰 {tr("شوف الأسعار ووافق", "See the prices & approve")}
          </button>
          <button className="btn w-full !py-2.5 text-muted" onClick={onClose}>
            {tr("بعدين", "Later")}
          </button>
        </div>
      }
    >
      <div className="flex flex-col items-center py-3 text-center">
        <span className="portal-coin grid h-24 w-24 place-items-center rounded-full bg-brand/15 text-5xl" aria-hidden>
          💰
        </span>
        <div className="mt-4 text-lg font-bold">{pick({ ar: n.titleAr, en: n.titleEn })}</div>
        {(n.bodyAr || n.bodyEn) && <p className="mt-1 text-muted">{pick({ ar: n.bodyAr, en: n.bodyEn })}</p>}
      </div>
    </Sheet>
  );
}

function Shell() {
  const { tr, pick } = useI18n();
  const { business } = usePortalAuth();
  const navigate = useNavigate();
  const { unread, quote, closeQuote } = useNotificationWatch();
  const tab = ({ isActive }: { isActive: boolean }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11.5px] font-semibold ${isActive ? "text-brand" : "text-faint"}`;

  return (
    <div className="portal flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2.5">
          <img src={business?.logo || "/logo.png"} alt="" className="h-9 w-auto" />
          <div className="min-w-0 flex-1 truncate font-bold">{business ? pick(business) : "JJ's"}</div>
          <SupportLink variant="icon" className="h-10 w-10 rounded-full bg-sunken" />
          <button className="relative grid h-10 w-10 place-items-center rounded-full bg-sunken text-ink" onClick={() => navigate("/portal/notifications")} aria-label={tr("الإشعارات", "Notifications")}>
            <PIcon d="bell" className="h-5 w-5" />
            {unread > 0 && <span className="absolute -end-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1 text-[11px] font-bold text-white num">{unread > 9 ? "9+" : unread}</span>}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-28 pt-4">
        <Outlet />
      </main>
      {quote && <QuoteReadySheet n={quote} onClose={closeQuote} />}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label={tr("الأقسام", "Sections")}>
        <div className="mx-auto flex max-w-xl items-end px-2">
          <NavLink to="/portal" end className={tab}>
            <PIcon d="home" />
            {tr("الرئيسية", "Home")}
          </NavLink>
          <NavLink to="/portal/orders" className={tab}>
            <PIcon d="orders" />
            {tr("طلباتي", "My orders")}
          </NavLink>
          <NavLink to="/portal/order" className="flex flex-1 flex-col items-center gap-0.5 pb-2 text-[11.5px] font-bold text-brand">
            <span className="-mt-6 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 ring-4 ring-surface transition-transform active:scale-95">
              <PIcon d="plus" className="h-7 w-7" />
            </span>
            {tr("اطلب", "Order")}
          </NavLink>
          <NavLink to="/portal/subscription" className={tab}>
            <PIcon d="sub" />
            {tr("اشتراكي", "Plan")}
          </NavLink>
          <NavLink to="/portal/account" className={tab}>
            <PIcon d="account" />
            {tr("حسابي", "Account")}
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
