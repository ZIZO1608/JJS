import { useEffect, type ReactNode } from "react";
import type { Currency } from "../lib/format";
import { money } from "../lib/format";
import { useI18n } from "../lib/i18n";

/** Pages listen for this to reload when something new happened (an order was answered…). */
export const REFRESH_EVENT = "portal:refresh";
export const useRefreshOn = (reload: () => void) =>
  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, reload);
    return () => window.removeEventListener(REFRESH_EVENT, reload);
  }, [reload]);

export type RequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export interface PortalRequest {
  id: string;
  number: number;
  status: RequestStatus;
  fulfilment: "pickup" | "delivery";
  paymentChoice: "on_account" | "on_delivery";
  note: string;
  quotedTotal: number;
  currency: Currency;
  itemsCount: number;
  declineReason: string;
  decidedAt: string | null;
  createdAt: string;
  order: { id: string; number: number; status: "confirmed" | "delivered" | "cancelled"; total: number; currency: Currency; paymentStatus: string; updatedAt: string } | null;
}

export interface PortalNotification {
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

/** One status for the client: the request, then the order it became. */
export type Stage = "waiting" | "accepted" | "delivered" | "declined" | "cancelled";
export const stageOf = (r: PortalRequest): Stage => {
  if (r.status === "pending") return "waiting";
  if (r.status === "declined") return "declined";
  if (r.status === "cancelled" || r.order?.status === "cancelled") return "cancelled";
  if (r.order?.status === "delivered") return "delivered";
  return "accepted";
};

const STAGE: Record<Stage, { ar: string; en: string; cls: string; icon: string }> = {
  waiting: { ar: "بانتظار الموافقة", en: "Waiting", cls: "bg-warn/15 text-warn", icon: "⏳" },
  accepted: { ar: "تم القبول", en: "Accepted", cls: "bg-good/15 text-good", icon: "✓" },
  delivered: { ar: "تم التسليم", en: "Delivered", cls: "bg-good/15 text-good", icon: "🎉" },
  declined: { ar: "مرفوض", en: "Declined", cls: "bg-bad/15 text-bad", icon: "✕" },
  cancelled: { ar: "ملغى", en: "Cancelled", cls: "bg-sunken text-muted", icon: "–" },
};

export function StageChip({ stage }: { stage: Stage }) {
  const { pick } = useI18n();
  const s = STAGE[stage];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {pick(s)}
    </span>
  );
}

export function useMoney() {
  const { lang } = useI18n();
  return (v: number | null | undefined, c: Currency = "USD") => money(v, c, lang);
}

/** A panel that slides up from the bottom on phones and sits centred on wider screens. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="portal-sheet flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-3xl bg-surface shadow-2xl sm:rounded-3xl">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="grid h-9 w-9 place-items-center rounded-full bg-sunken text-muted" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

/** Relative time: "5 min ago" / "منذ 5 د". */
export function useAgo() {
  const { tr, fmtDate } = useI18n();
  return (iso: string) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return tr("الآن", "just now");
    if (s < 3600) return tr(`منذ ${Math.floor(s / 60)} د`, `${Math.floor(s / 60)} min ago`);
    if (s < 86400) return tr(`منذ ${Math.floor(s / 3600)} س`, `${Math.floor(s / 3600)} h ago`);
    return fmtDate(iso, true);
  };
}
