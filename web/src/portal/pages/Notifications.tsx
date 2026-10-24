import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "../../components/ui";
import { post } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useData } from "../../lib/useData";
import { useAgo, useRefreshOn, type PortalNotification } from "../shared";

const ICON: Record<string, string> = {
  order_accepted: "✅",
  order_declined: "❌",
  order_delivered: "🎉",
  order_cancelled: "⚠️",
  sub_accepted: "⭐",
  sub_declined: "❌",
};

export function NotificationsPage() {
  const { tr, pick } = useI18n();
  const ago = useAgo();
  const navigate = useNavigate();
  const { data, reload } = useData<{ rows: PortalNotification[]; unread: number }>("/portal/notifications");
  useRefreshOn(reload);

  // Opening the list counts as reading it (the dots stay until the next visit).
  useEffect(() => {
    if (!data?.unread) return;
    post("/portal/notifications/read", {})
      .then(() => window.dispatchEvent(new Event("portal:notifications-read")))
      .catch(() => undefined);
  }, [data?.unread]);

  if (!data) return <Spinner />;
  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">{tr("الإشعارات", "Notifications")}</h1>
      {data.rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line px-4 py-10 text-center text-faint">
          <div className="text-3xl" aria-hidden>
            🔔
          </div>
          {tr("لا إشعارات بعد", "No notifications yet")}
        </div>
      ) : (
        <ul className="grid gap-2">
          {data.rows.map((n) => (
            <li key={n.id}>
              <button onClick={() => n.link && navigate(n.link)} className={`card flex w-full items-start gap-3 rounded-2xl p-3.5 text-start ${n.readAt ? "" : "border-brand/40 bg-brand/5"}`}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sunken text-lg" aria-hidden>
                  {ICON[n.kind] ?? "🔔"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{pick({ ar: n.titleAr, en: n.titleEn })}</span>
                  {(n.bodyAr || n.bodyEn) && <span className="block text-sm text-muted">{pick({ ar: n.bodyAr, en: n.bodyEn })}</span>}
                  <span className="block text-xs text-faint">{ago(n.createdAt)}</span>
                </span>
                {!n.readAt && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-label={tr("جديد", "New")} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
