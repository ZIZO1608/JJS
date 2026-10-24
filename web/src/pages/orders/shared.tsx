import type { ReactNode } from "react";
import { Modal } from "../../components/ui";
import type { Currency } from "../../lib/format";

/** An order as the list/detail endpoints return it. */
export interface OrderRow {
  id: string;
  number: number;
  businessDate: string;
  createdAt?: string;
  clientId: string | null;
  type: "normal" | "trial" | "staff" | "internal";
  employeeId: string | null;
  fulfilment: "pickup" | "delivery";
  assignedTo: string | null;
  status: "confirmed" | "delivered" | "cancelled";
  paymentStatus: "paid" | "partial" | "credit" | "free" | "salary";
  methodId: string | null;
  currency: Currency;
  fxRate: number;
  subtotal: number;
  discount: number;
  discountReason: string;
  taxTotal: number;
  deliveryFee: number;
  total: number;
  totalUsd: number;
  costUsd: number;
  itemsCount: number;
  freeItems: number;
  loyaltyFree: number;
  subFree: number;
  note: string;
  cancelledAt: string | null;
  cancelReason?: string;
  paidAmount?: number;
  consignmentId?: string | null;
  source?: "staff" | "portal";
  clientName: string | null;
  method: { nameAr: string; nameEn: string } | null;
  userName: string | null;
  assignedName: string | null;
}
export interface LineOption {
  id: string;
  nameAr: string;
  nameEn: string;
  priceDelta: number;
}
export interface OrderLine {
  id: string;
  productId: string;
  nameAr: string;
  nameEn: string;
  qty: number;
  freeQty: number;
  unitPrice: number;
  lineTotal: number;
  unitCostUsd: number;
  options: LineOption[];
}
export interface AppliedTax {
  id: string;
  nameAr: string;
  nameEn: string;
  kind: string;
  value: number;
  amount: number;
}
export interface OrderDetail extends OrderRow {
  lines: OrderLine[];
  payments: { id: string; amount: number; currency: Currency; amountUsd: number; methodId: string; boxId: string }[];
  taxes: AppliedTax[];
}

type Tr = (ar: string, en: string) => string;

/** "tier:10%,subscription:5%" → "Favourite client 10% · Subscription 5%" */
/** Marks an order a client sent from the portal. */
export const PortalBadge = ({ label }: { label: string }) => <span className="ms-1.5 inline-block rounded-full bg-brand/15 px-2 py-0.5 align-middle text-[11px] font-bold text-brand no-underline">📱 {label}</span>;

export function discountWords(reason: string, tr: Tr) {
  if (!reason) return "";
  const names: Record<string, [string, string]> = {
    tier: ["خصم زبون مميّز", "Client tier discount"],
    subscription: ["خصم الاشتراك", "Subscription discount"],
    staff: ["خصم موظف", "Staff discount"],
    trial: ["تجربة مجانية", "Free trial"],
    internal: ["استهلاك داخلي", "Internal use"],
    manual: ["خصم يدوي", "Manual discount"],
    loyalty: ["قطع مجانية (ولاء)", "Free items (loyalty)"],
    sub_free: ["قطع ضمن الاشتراك", "Included in subscription"],
  };
  return reason
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [k, v] = part.split(":");
      // "subscription:2" / "loyalty:1" = free items; "subscription:5%" = a discount
      if (v && !v.endsWith("%")) {
        if (k === "subscription") return `${tr("ضمن الاشتراك", "Included in subscription")} ×${v}`;
        if (k === "loyalty") return `${tr("مجاني (ولاء)", "Free (loyalty)")} ×${v}`;
      }
      const n = names[k ?? ""];
      return n ? `${tr(n[0], n[1])}${v ? ` ${v}` : ""}` : part;
    })
    .join(" · ");
}

export function payStatusLabel(s: OrderRow["paymentStatus"], tr: Tr) {
  return { paid: tr("مدفوع", "Paid"), partial: tr("مدفوع جزئياً", "Part paid"), credit: tr("على الحساب", "On account"), free: tr("مجاني", "Free"), salary: tr("من الراتب", "From salary") }[s];
}
export function statusLabel(s: OrderRow["status"], tr: Tr) {
  return { confirmed: tr("مؤكد", "Confirmed"), delivered: tr("تم التسليم", "Delivered"), cancelled: tr("ملغى", "Cancelled") }[s];
}
export function typeLabel(t: OrderRow["type"], tr: Tr) {
  return { normal: "", trial: tr("تجربة مجانية", "Free trial"), staff: tr("موظف", "Staff"), internal: tr("تذوّق / داخلي", "Tasting / internal") }[t];
}
export const timeOf = (iso: string | undefined, lang: "ar" | "en") =>
  iso ? new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-SY-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : "";

/** Confirm dialog with our own button words (ui.ConfirmDialog always says "Delete"). */
export function Confirm({ title, body, yes, no, onYes, onClose, danger }: { title: string; body?: ReactNode; yes: string; no: string; onYes: () => void; onClose: () => void; danger?: boolean }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {no}
          </button>
          <button className={`btn btn-primary ${danger ? "!border-bad !bg-bad !text-white" : ""}`} onClick={onYes}>
            {yes}
          </button>
        </>
      }
    >
      {body ?? <span />}
    </Modal>
  );
}
