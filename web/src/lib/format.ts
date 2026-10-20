export type Currency = "USD" | "SYP";

/** 1,234.50 $ / 120,000 ل.س — SYP has no decimals. */
export function money(v: number | null | undefined, currency: Currency = "USD", lang: "ar" | "en" = "en") {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const n = currency === "SYP" ? Math.round(v).toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === "SYP") return lang === "ar" ? `${n} ل.س` : `SYP ${n}`;
  return `$${n}`;
}
export const usd = (v: number | null | undefined) => money(v, "USD");

/** Quantities: up to 3 decimals, no trailing zeros. */
export const qty = (v: number | null | undefined) => (v === null || v === undefined ? "—" : (Math.round(v * 1000) / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 }));
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("en-US")}%`);

const p2 = (n: number) => String(n).padStart(2, "0");
/** Local calendar date (YYYY-MM-DD) — the shop's business day. */
export const today = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const thisMonth = () => today().slice(0, 7);
export const addDaysTo = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return today(d);
};
export const monthStartOf = (date: string) => `${date.slice(0, 7)}-01`;

export const UNIT_LABEL: Record<string, { ar: string; en: string }> = {
  kg: { ar: "كغ", en: "kg" },
  g: { ar: "غ", en: "g" },
  l: { ar: "ليتر", en: "L" },
  ml: { ar: "مل", en: "ml" },
  pc: { ar: "قطعة", en: "pc" },
};

/** Parse a number typed by a person (accepts Arabic digits and commas). */
export function num(v: string): number {
  const s = v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/,/g, "").trim();
  return s === "" ? NaN : Number(s);
}
