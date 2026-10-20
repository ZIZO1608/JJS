import { and, eq, max, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Currency } from "../../shared/money.js";
import { db, type DB, type Tx } from "../db/client.js";
import { businessDays } from "../db/schema.js";
import { getCurrentRate } from "../services/fx.js";
import { HttpError, newId } from "./util.js";

export type Q = DB | Tx;

/** Today's date on this laptop (the shop's local time), as YYYY-MM-DD. */
export const localDate = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const monthOf = (date: string) => date.slice(0, 7);
/** Add months (clamped to the month's last day), then days. "2026-10-20" +1 month −1 day → "2026-11-19". */
export const addMonths = (date: string, months: number, days = 0) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last) + days);
  return localDate(target);
};
export const addDays = (date: string, days: number) => addMonths(date, 0, days);
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
export const monthEnd = (date: string) => {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return localDate(new Date(y, m, 0));
};

/** The business day row for a date; created (open) on first use. */
export function getDay(tx: Q, date: string) {
  let d = tx.select().from(businessDays).where(eq(businessDays.date, date)).get();
  if (!d) {
    tx.insert(businessDays).values({ id: newId(), date }).onConflictDoNothing().run();
    d = tx.select().from(businessDays).where(eq(businessDays.date, date)).get()!;
  }
  return d;
}

/** Money and stock can only be written on an open day. */
export function assertDayOpen(tx: Q, date: string) {
  const d = getDay(tx, date);
  if (d.status === "closed") throw new HttpError(409, "day_closed", `The day ${date} is closed. Ask the admin to reopen it.`);
  return d;
}

/** 1 USD = rate SYP right now, or null when no rate has been set. */
export const currentRate = () => getCurrentRate().rate;

/** A rate is only required when SYP is involved. */
export function rateFor(...currencies: Currency[]): number | null {
  const r = currentRate();
  if (currencies.includes("SYP") && !(r && r > 0)) {
    throw new HttpError(409, "no_rate", "Set the USD → SYP exchange rate first (Settings → Currency & rate).");
  }
  return r && r > 0 ? r : null;
}

export function toUsd(amount: number, currency: Currency, rate: number | null): number {
  if (currency === "USD") return amount;
  if (!rate) throw new HttpError(409, "no_rate", "Set the USD → SYP exchange rate first.");
  return amount / rate;
}
export function fromUsd(usd: number, currency: Currency, rate: number | null): number {
  if (currency === "USD") return usd;
  if (!rate) throw new HttpError(409, "no_rate", "Set the USD → SYP exchange rate first.");
  return usd * rate;
}
export const convert = (amount: number, from: Currency, to: Currency, rate: number | null) => (from === to ? amount : fromUsd(toUsd(amount, from, rate), to, rate));

/** Round money: SYP to whole pounds, USD to cents. */
/** Round half-up without float noise (2.275 → 2.28, not 2.27). */
const roundTo = (v: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(Number((v * f).toPrecision(12))) / f;
};
export const roundMoney = (v: number, c: Currency) => (c === "SYP" ? roundTo(v, 0) : roundTo(v, 2));
export const round4 = (v: number) => roundTo(v, 4);

/** Next running number for orders, purchases… (inside the caller's transaction). */
export function nextNumber(tx: Q, table: SQLiteTable, col: SQLiteColumn) {
  const r = tx.select({ m: max(col) }).from(table).get() as { m: number | null } | undefined;
  return (r?.m ?? 0) + 1;
}

export const notDeleted = (col: SQLiteColumn) => sql`${col} IS NULL`;
export const all = (...conds: (SQL | undefined)[]) => and(...conds.filter(Boolean));

export { db };
