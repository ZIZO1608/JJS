export type Currency = "USD" | "SYP";

/**
 * Convert between USD and SYP. `usdToSyp` is how many SYP one USD buys.
 * Every money row in the database stores its own currency and the rate it used,
 * so old records never change when today's rate moves.
 */
export function convert(amount: number, from: Currency, to: Currency, usdToSyp: number): number {
  if (from === to) return amount;
  if (!(usdToSyp > 0)) throw new Error("A positive exchange rate is required to convert currencies");
  return from === "USD" ? amount * usdToSyp : amount / usdToSyp;
}

export function formatMoney(amount: number, currency: Currency, lang: "ar" | "en" = "en"): string {
  if (currency === "SYP") {
    const v = Math.round(amount).toLocaleString("en-US");
    return lang === "ar" ? `${v} ل.س` : `${v} SYP`;
  }
  const v = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount < 0 ? "-" : ""}$${v}`;
}
