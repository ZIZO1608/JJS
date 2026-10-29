import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { get, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { chime } from "../lib/chime";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";

export interface StaffNotification {
  id: string;
  kind: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

/** Pages showing requests reload on this (a client sent something new). */
export const INBOX_EVENT = "jjs:inbox";

interface InboxCtx {
  unread: number;
  pending: { orders: number; subscriptions: number };
  refresh: () => Promise<void>;
}
const Ctx = createContext<InboxCtx>({ unread: 0, pending: { orders: 0, subscriptions: 0 }, refresh: async () => undefined });

/** Polls the bell and the pending client requests every 15 seconds. A new one rings. */
export function InboxProvider({ children }: { children: ReactNode }) {
  const { pick } = useI18n();
  const toast = useToast();
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState({ orders: 0, subscriptions: 0 });
  const last = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [{ unread: n }, counts] = await Promise.all([get<{ unread: number }>("/notifications/unread-count"), get<{ orders: number; subscriptions: number }>("/requests/counts")]);
      if (last.current !== null && n > last.current) {
        const { rows } = await get<{ rows: StaffNotification[] }>("/notifications");
        const newest = rows[0];
        if (newest) toast(`🔔 ${pick({ ar: newest.titleAr, en: newest.titleEn })}`);
        chime();
        window.dispatchEvent(new Event(INBOX_EVENT));
      }
      last.current = n;
      setUnread(n);
      setPending(counts);
    } catch {
      /* the server is unreachable for a moment: next tick */
    }
  }, [pick, toast]);

  useEffect(() => {
    // Only while the app is on screen: a hidden tab or a phone in a pocket costs the server nothing.
    void refresh();
    const id = setInterval(() => document.visibilityState === "visible" && void refresh(), 30_000);
    const onShow = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refresh]);

  return <Ctx.Provider value={{ unread, pending, refresh }}>{children}</Ctx.Provider>;
}

export const useInbox = () => useContext(Ctx);

function useAgo() {
  const { tr, fmtDate } = useI18n();
  return (iso: string) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return tr("الآن", "just now");
    if (s < 3600) return tr(`منذ ${Math.floor(s / 60)} د`, `${Math.floor(s / 60)} min ago`);
    if (s < 86400) return tr(`منذ ${Math.floor(s / 3600)} س`, `${Math.floor(s / 3600)} h ago`);
    return fmtDate(iso, true);
  };
}

export function NotificationBell() {
  const { tr, pick } = useI18n();
  const { me } = useAuth();
  const { unread, refresh } = useInbox();
  const navigate = useNavigate();
  const ago = useAgo();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<StaffNotification[] | null>(null);
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    setRows((await get<{ rows: StaffNotification[] }>("/notifications").catch(() => ({ rows: [] }))).rows);
    if (unread) {
      await post("/notifications/read", {}).catch(() => undefined);
      void refresh();
    }
  };
  if (!me) return null;
  return (
    <div className="relative">
      <button className="relative grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink" onClick={() => void toggle()} aria-expanded={open} aria-label={tr("الإشعارات", "Notifications")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="absolute -end-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-bad px-1 text-[10.5px] font-bold text-white num">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute end-0 z-40 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="font-bold">{tr("الإشعارات", "Notifications")}</span>
              <button
                className="text-sm font-semibold text-brand"
                onClick={() => {
                  setOpen(false);
                  navigate("/requests");
                }}
              >
                {tr("طلبات الزبائن", "Client requests")}
              </button>
            </div>
            <ul className="max-h-[60vh] overflow-y-auto p-1">
              {rows === null && <li className="px-3 py-6 text-center text-faint">…</li>}
              {rows?.length === 0 && <li className="px-3 py-6 text-center text-faint">{tr("لا إشعارات", "No notifications")}</li>}
              {rows?.map((n) => (
                <li key={n.id}>
                  <button
                    className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-start hover:bg-sunken ${n.readAt ? "" : "bg-brand/5"}`}
                    onClick={() => {
                      setOpen(false);
                      if (n.link) navigate(n.link);
                    }}
                  >
                    {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{pick({ ar: n.titleAr, en: n.titleEn })}</span>
                      {(n.bodyAr || n.bodyEn) && <span className="block truncate text-xs text-muted">{pick({ ar: n.bodyAr, en: n.bodyEn })}</span>}
                      <span className="block text-xs text-faint">{ago(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
