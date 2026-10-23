import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../lib/i18n";

/**
 * Branded dropdown with the same API as a native <select>: pass <option>/<optgroup> children,
 * read e.target.value in onChange. Native select lists can't be styled, so this draws its own.
 */
type Opt = { kind: "option"; value: string; label: ReactNode; text: string; disabled: boolean } | { kind: "group"; label: string };

const textOf = (n: ReactNode): string => {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(n)) return textOf(n.props.children);
  return "";
};

function readOptions(children: ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ children?: ReactNode; value?: string | number; disabled?: boolean; label?: string }>;
    if (el.type === Fragment) readOptions(el.props.children, out);
    else if (el.type === "optgroup") {
      out.push({ kind: "group", label: el.props.label ?? "" });
      readOptions(el.props.children, out);
    } else if (el.type === "option") {
      const text = textOf(el.props.children);
      out.push({ kind: "option", value: el.props.value === undefined ? text : String(el.props.value), label: el.props.children, text, disabled: !!el.props.disabled });
    }
  });
  return out;
}

/** Lists longer than this get a search box. */
const SEARCH_FROM = 9;

export function Dropdown({ children, value, onChange, id, className = "", disabled, dir, title, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const { t, lang, dir: pageDir } = useI18n();
  const listId = useId();
  const options = useMemo(() => readOptions(children), [children]);
  const items = options.filter((o): o is Extract<Opt, { kind: "option" }> => o.kind === "option");
  const current = items.find((o) => o.value === String(value ?? "")) ?? (value === undefined ? items[0] : undefined);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ s: "", at: 0 });

  const withSearch = items.length >= SEARCH_FROM;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.kind === "option" && o.text.toLowerCase().includes(q)) : options;
  const pickable = shown.filter((o): o is Extract<Opt, { kind: "option" }> => o.kind === "option" && !o.disabled);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 260 && r.top > below;
    const width = Math.max(r.width, 190);
    const style: CSSProperties = { position: "fixed", width, maxHeight: Math.min(320, (up ? r.top : below) - 12) };
    if (up) style.bottom = window.innerHeight - r.top + 6;
    else style.top = r.bottom + 6;
    style.left = Math.min(Math.max(8, (pageDir === "rtl" ? r.right - width : r.left)), window.innerWidth - width - 8);
    setPos(style);
  }, [pageDir]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) btn.current?.focus();
  }, []);

  const openList = () => {
    if (disabled) return;
    place();
    setOpen(true);
    setActive(Math.max(0, pickable.findIndex((o) => o.value === current?.value)));
  };

  const choose = (v: string) => {
    if (v !== String(value ?? "")) onChange?.({ target: { value: v }, currentTarget: { value: v } } as unknown as ChangeEvent<HTMLSelectElement>);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    if (withSearch) search.current?.focus();
    else pop.current?.focus();
  }, [open, withSearch]);

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

  useEffect(() => {
    pop.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onListKey = (e: KeyboardEvent) => {
    const move = (to: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(pickable.length - 1, to)));
    };
    if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(pickable.length - 1);
    else if (e.key === "Enter") {
      e.preventDefault();
      if (pickable[active]) choose(pickable[active].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't close the dialog this sits in
      close();
    } else if (e.key === "Tab") close(false);
    else if (!withSearch && e.key.length === 1) {
      const now = Date.now();
      typed.current = { s: (now - typed.current.at < 700 ? typed.current.s : "") + e.key.toLowerCase(), at: now };
      const hit = pickable.findIndex((o) => o.text.toLowerCase().startsWith(typed.current.s));
      if (hit >= 0) setActive(hit);
    }
  };

  const onButtonKey = (e: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openList();
    }
  };

  let n = -1;
  return (
    <>
      <button
        ref={btn}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={rest["aria-label"]}
        title={title}
        disabled={disabled}
        dir={dir}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKey}
        className={`input dd-trigger ${open ? "dd-open" : ""} ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate text-start ${current ? "" : "text-faint"}`}>{current ? current.label : "—"}</span>
        <svg className={`dd-chevron ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" aria-hidden>
          <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div ref={pop} dir={pageDir} tabIndex={-1} onKeyDown={onListKey} className="dd-pop" style={pos}>
            {withSearch && (
              <div className="sticky top-0 z-10 bg-surface p-1 pb-1.5">
                <input
                  ref={search}
                  className="dd-search"
                  placeholder={t("common.search")}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  aria-controls={listId}
                />
              </div>
            )}
            <ul id={listId} role="listbox" aria-label={rest["aria-label"]} className="grid gap-0.5">
              {shown.map((o, i) => {
                if (o.kind === "group")
                  return (
                    <li key={`g${i}`} role="presentation" className="dd-group">
                      {o.label}
                    </li>
                  );
                const idx = o.disabled ? -1 : ++n;
                const selected = o.value === current?.value;
                return (
                  <li
                    key={`${o.value}-${i}`}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={o.disabled || undefined}
                    data-i={idx}
                    className={`dd-option ${selected ? "dd-selected" : ""} ${idx === active ? "dd-active" : ""} ${o.disabled ? "opacity-40" : ""}`}
                    onMouseEnter={() => idx >= 0 && setActive(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => !o.disabled && choose(o.value)}
                  >
                    <span className="min-w-0 flex-1">{o.label}</span>
                    {selected && (
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" aria-hidden>
                        <path d="m4.5 10.5 3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </li>
                );
              })}
              {shown.length === 0 && <li className="px-3 py-2 text-sm text-faint">{lang === "ar" ? "لا نتائج" : "No results"}</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
