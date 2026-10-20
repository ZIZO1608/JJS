import { NavLink } from "react-router-dom";

/** Underlined tab bar. Pass `to` links (routed tabs) or `value/onChange` (local tabs). */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  base,
}: {
  tabs: { key: K; label: string }[];
  value?: K;
  onChange?: (k: K) => void;
  /** When set, tabs are links to `${base}/${key}`. */
  base?: string;
}) {
  const cls = (active: boolean) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 font-semibold ${active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`;
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) =>
        base ? (
          <NavLink key={t.key} to={`${base}/${t.key}`} className={({ isActive }) => cls(isActive)}>
            {t.label}
          </NavLink>
        ) : (
          <button key={t.key} role="tab" aria-selected={value === t.key} className={cls(value === t.key)} onClick={() => onChange?.(t.key)}>
            {t.label}
          </button>
        ),
      )}
    </nav>
  );
}

/** A number box on a dashboard or report. */
export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const c = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "";
  return (
    <div className="card min-w-0">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 truncate text-2xl font-bold num ltr text-start ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  );
}
