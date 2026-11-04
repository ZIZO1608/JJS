import { money, num, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";

/** A discount is either a percentage or a fixed amount in one currency. */
export type DiscountMode = "pct" | Currency;

/** What a typed discount is worth against `base`, or why it cannot be used. */
export function readDiscount(mode: DiscountMode, value: string, baseCurrency?: Currency, base?: number) {
  const n = num(value);
  if (value.trim() === "") return { amount: 0, pct: 0, problem: null };
  if (Number.isNaN(n) || n < 0) return { amount: 0, pct: 0, problem: "invalid" as const };
  if (mode === "pct") {
    if (n > 100) return { amount: 0, pct: 0, problem: "over_100" as const };
    return { amount: 0, pct: n, problem: null };
  }
  if (base !== undefined && baseCurrency === mode && n > base + 0.001) return { amount: 0, pct: 0, problem: "over_base" as const };
  return { amount: n, pct: 0, problem: null };
}

/** The stored discount as a label: "10%", "$5.00" or nothing. */
export function discountLabel(pct: number, amount: number | undefined, currency: Currency, lang: "ar" | "en") {
  if (amount && amount > 0) return money(amount, currency, lang);
  return pct > 0 ? `${pct}%` : "";
}

/**
 * One input for every discount in the system: pick % or a currency, type the number,
 * and see what it comes to. Pass `base` and `baseCurrency` when the price is known.
 */
export function DiscountInput({
  id,
  mode,
  value,
  currencies,
  onChange,
  base,
  baseCurrency,
  disabled,
}: {
  id?: string;
  mode: DiscountMode;
  value: string;
  currencies: Currency[];
  onChange: (mode: DiscountMode, value: string) => void;
  base?: number;
  baseCurrency?: Currency;
  disabled?: boolean;
}) {
  const { tr, lang } = useI18n();
  const read = readDiscount(mode, value, baseCurrency, base);
  const modes: DiscountMode[] = ["pct", ...currencies];
  const label = (m: DiscountMode) => (m === "pct" ? "%" : m === "USD" ? "$" : lang === "ar" ? "ل.س" : "SYP");
  const off = base === undefined || read.problem ? null : read.pct > 0 ? (base * read.pct) / 100 : baseCurrency === mode ? read.amount : null;
  const problem =
    read.problem === "over_100"
      ? tr("النسبة لازم تكون من 0 لـ 100", "The percentage must be from 0 to 100")
      : read.problem === "over_base"
        ? tr("الخصم أكبر من المبلغ", "The discount is more than the amount")
        : read.problem === "invalid"
          ? tr("اكتب رقم صحيح", "Type a valid number")
          : null;
  return (
    <div>
      <div className="flex items-stretch gap-2">
        <div className="inline-flex shrink-0 rounded-lg bg-sunken p-0.5" role="radiogroup" aria-label={tr("نوع الخصم", "Discount type")}>
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={disabled}
              onClick={() => onChange(m, value)}
              className={`min-w-[2.5rem] rounded-md px-2.5 py-1.5 text-sm font-bold transition-colors ${mode === m ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {label(m)}
            </button>
          ))}
        </div>
        <input
          id={id}
          className="input num ltr min-w-0 flex-1"
          dir="ltr"
          inputMode="decimal"
          placeholder="0"
          value={value}
          disabled={disabled}
          aria-invalid={!!problem}
          onChange={(e) => onChange(mode, e.target.value)}
        />
      </div>
      {problem ? (
        <p className="mt-1 text-xs font-semibold text-bad">{problem}</p>
      ) : off !== null && off > 0 && baseCurrency ? (
        <p className="mt-1 text-xs font-semibold text-good">
          −<span className="num ltr">{money(off, baseCurrency, lang)}</span>
        </p>
      ) : null}
    </div>
  );
}
