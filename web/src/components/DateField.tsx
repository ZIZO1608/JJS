import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../lib/i18n";

/**
 * Branded calendar for type="date" (YYYY-MM-DD) and type="month" (YYYY-MM) fields.
 * Same API as the native input: value, min, max, onChange reading e.target.value.
 */
const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${p2(m + 1)}-${p2(d)}`;
const parse = (s?: string) => {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s ?? "");
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: m[3] ? Number(m[3]) : 1 } : null;
};
const todayIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};
// Syria uses the Levantine month names and Latin digits elsewhere in the app; the week starts on Saturday.
const locale = (lang: string) => (lang === "ar" ? "ar-SY-u-nu-latn" : "en-GB");
const WEEK_START = 6;
const AR_WEEKDAYS = ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"];

export function DateField({ type, value, onChange, min, max, id, className = "", disabled, required, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const { lang, dir } = useI18n();
  const monthOnly = type === "month";
  const val = String(value ?? "");
  const sel = parse(val);
  const lo = String(min ?? "");
  const hi = String(max ?? "");
  const tr = (ar: string, en: string) => (lang === "ar" ? ar : en);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months">(monthOnly ? "months" : "days");
  const [cursor, setCursor] = useState(() => sel ?? parse(todayIso())!);
  const [pos, setPos] = useState<CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const fmtMonth = (y: number, m: number) => new Intl.DateTimeFormat(locale(lang), { month: "long", year: "numeric" }).format(new Date(y, m, 1));
  const shown = sel
    ? monthOnly
      ? fmtMonth(sel.y, sel.m)
      : new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "long", year: "numeric" }).format(new Date(sel.y, sel.m, sel.d))
    : "";
  const allowed = (s: string) => (!lo || s >= lo.slice(0, s.length)) && (!hi || s <= hi.slice(0, s.length));

  const emit = (v: string) => onChange?.({ target: { value: v }, currentTarget: { value: v } } as unknown as ChangeEvent<HTMLInputElement>);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const W = 300;
    const H = 360;
    const up = window.innerHeight - r.bottom < H && r.top > H;
    const style: CSSProperties = { position: "fixed", width: W };
    if (up) style.bottom = window.innerHeight - r.top + 6;
    else style.top = r.bottom + 6;
    style.left = Math.min(Math.max(8, dir === "rtl" ? r.right - W : r.left), window.innerWidth - W - 8);
    setPos(style);
  }, [dir]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);

  const openCal = () => {
    if (disabled) return;
    setCursor(sel ?? parse(todayIso())!);
    setView(monthOnly ? "months" : "days");
    place();
    setOpen(true);
  };

  const choose = (v: string) => {
    if (!allowed(v)) return;
    if (v !== val) emit(v);
    close();
  };

  useLayoutEffect(() => {
    if (open) pop.current?.querySelector<HTMLElement>("[data-focus='1']")?.focus();
  }, [open, cursor, view]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (!pop.current?.contains(tgt) && !btn.current?.contains(tgt)) close(false);
    };
    const onScroll = (e: Event) => !pop.current?.contains(e.target as Node) && place(); // follow the field when the page scrolls
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, close, place]);

  const shiftDays = (n: number) => {
    const d = new Date(cursor.y, cursor.m, cursor.d + n);
    setCursor({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() });
  };
  const shiftMonths = (n: number) => {
    const d = new Date(cursor.y, cursor.m + n, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    setCursor({ y: d.getFullYear(), m: d.getMonth(), d: Math.min(cursor.d, last) });
  };

  const onKey = (e: KeyboardEvent) => {
    const fwd = dir === "rtl" ? -1 : 1; // ArrowRight goes back in time in Arabic
    const keys: Record<string, () => void> =
      view === "days"
        ? {
            ArrowLeft: () => shiftDays(-fwd),
            ArrowRight: () => shiftDays(fwd),
            ArrowUp: () => shiftDays(-7),
            ArrowDown: () => shiftDays(7),
            PageUp: () => shiftMonths(-1),
            PageDown: () => shiftMonths(1),
            Enter: () => choose(iso(cursor.y, cursor.m, cursor.d)),
          }
        : {
            ArrowLeft: () => shiftMonths(-fwd),
            ArrowRight: () => shiftMonths(fwd),
            ArrowUp: () => shiftMonths(-3),
            ArrowDown: () => shiftMonths(3),
            PageUp: () => shiftMonths(-12),
            PageDown: () => shiftMonths(12),
            Enter: () => (monthOnly ? choose(`${cursor.y}-${p2(cursor.m + 1)}`) : setView("days")),
          };
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't close the dialog this sits in
      close();
    } else if (e.key === "Tab") close(false);
    else {
      const run = keys[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    }
  };

  // Day grid: 6 weeks starting on Saturday.
  const first = new Date(cursor.y, cursor.m, 1);
  const lead = (first.getDay() - WEEK_START + 7) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => new Date(cursor.y, cursor.m, 1 - lead + i));
  const weekdays = lang === "ar" ? AR_WEEKDAYS : Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(new Date(2024, 0, 6 + i)).slice(0, 2));
  const monthNames = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(locale(lang), { month: "long" }).format(new Date(2024, i, 1)));
  const today = todayIso();
  const prevLabel = view === "days" ? tr("الشهر السابق", "Previous month") : tr("السنة السابقة", "Previous year");
  const nextLabel = view === "days" ? tr("الشهر التالي", "Next month") : tr("السنة التالية", "Next year");

  const Arrow = ({ back }: { back: boolean }) => (
    <svg viewBox="0 0 20 20" className={`h-4 w-4 ${(back ? dir !== "rtl" : dir === "rtl") ? "rotate-180" : ""}`} aria-hidden>
      <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <>
      <button
        ref={btn}
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={rest["aria-label"]}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openCal())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openCal();
          }
        }}
        className={`input dd-trigger ${open ? "dd-open" : ""} ${className}`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-brand" aria-hidden>
          <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className={`min-w-0 flex-1 truncate text-start num ${shown ? "" : "text-faint"}`}>{shown || (monthOnly ? tr("اختر الشهر", "Pick a month") : tr("اختر التاريخ", "Pick a date"))}</span>
      </button>
      {open &&
        createPortal(
          <div ref={pop} dir={dir} role="dialog" aria-label={rest["aria-label"] ?? (monthOnly ? tr("اختر الشهر", "Pick a month") : tr("اختر التاريخ", "Pick a date"))} onKeyDown={onKey} className="cal-pop" style={pos}>
            <div className="cal-head">
              <button type="button" className="cal-nav" aria-label={prevLabel} onClick={() => shiftMonths(view === "days" ? -1 : -12)}>
                <Arrow back />
              </button>
              <button
                type="button"
                className="cal-title"
                onClick={() => !monthOnly && setView(view === "days" ? "months" : "days")}
                aria-label={view === "days" ? tr("اختر شهراً آخر", "Choose another month") : undefined}
              >
                {view === "days" ? fmtMonth(cursor.y, cursor.m) : <span className="num">{cursor.y}</span>}
              </button>
              <button type="button" className="cal-nav" aria-label={nextLabel} onClick={() => shiftMonths(view === "days" ? 1 : 12)}>
                <Arrow back={false} />
              </button>
            </div>

            {view === "days" ? (
              <div role="grid" className="grid grid-cols-7 gap-0.5">
                {weekdays.map((w) => (
                  <div key={w} role="columnheader" className="cal-weekday">
                    {w}
                  </div>
                ))}
                {cells.map((d) => {
                  const s = iso(d.getFullYear(), d.getMonth(), d.getDate());
                  const inMonth = d.getMonth() === cursor.m;
                  const isSel = s === val;
                  const isFocus = d.getDate() === cursor.d && inMonth;
                  const ok = allowed(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      role="gridcell"
                      tabIndex={isFocus ? 0 : -1}
                      data-focus={isFocus ? "1" : undefined}
                      aria-selected={isSel}
                      aria-current={s === today ? "date" : undefined}
                      disabled={!ok}
                      onClick={() => choose(s)}
                      className={`cal-day num ${inMonth ? "" : "cal-out"} ${s === today ? "cal-today" : ""} ${isSel ? "cal-sel" : ""}`}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 py-1">
                {monthNames.map((name, m) => {
                  const s = `${cursor.y}-${p2(m + 1)}`;
                  const isSel = sel ? sel.y === cursor.y && sel.m === m : false;
                  const isFocus = m === cursor.m;
                  return (
                    <button
                      key={m}
                      type="button"
                      tabIndex={isFocus ? 0 : -1}
                      data-focus={isFocus ? "1" : undefined}
                      disabled={!allowed(s)}
                      onClick={() => (monthOnly ? choose(s) : (setCursor({ y: cursor.y, m, d: 1 }), setView("days")))}
                      className={`cal-month ${isSel ? "cal-sel" : ""} ${today.startsWith(s) ? "cal-today" : ""}`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
              {!required && val ? (
                <button type="button" className="cal-link text-muted" onClick={() => choose("")}>
                  {tr("مسح", "Clear")}
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="cal-link text-brand" disabled={!allowed(monthOnly ? today.slice(0, 7) : today)} onClick={() => choose(monthOnly ? today.slice(0, 7) : today)}>
                {monthOnly ? tr("هذا الشهر", "This month") : tr("اليوم", "Today")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
