import { useEffect, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { useI18n } from "../lib/i18n";
import { DateField } from "./DateField";
import { Dropdown } from "./Dropdown";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-sm text-bad">{error}</p> : hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  if (props.type === "date" || props.type === "month") return <DateField {...props} />;
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <Dropdown {...props} />;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("input,select,textarea,button");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-auto bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl bg-surface p-5 shadow-2xl`}>
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ text, onConfirm, onClose, danger = true }: { text: string; onConfirm: () => void; onClose: () => void; danger?: boolean }) {
  const { t } = useI18n();
  return (
    <Modal
      title={text}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className={`btn btn-primary ${danger ? "!border-bad !bg-bad !text-white" : ""}`} onClick={onConfirm}>
            {t("common.delete")}
          </button>
        </>
      }
    >
      <span />
    </Modal>
  );
}

export function StatusDot({ tone }: { tone: "good" | "warn" | "bad" | "mute" }) {
  const c = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", mute: "bg-faint" }[tone];
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} aria-hidden />;
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-faint">{text}</div>;
}

export function Spinner() {
  const { t } = useI18n();
  return <div className="py-10 text-center text-faint">{t("app.loading")}</div>;
}
