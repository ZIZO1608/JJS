/* Small building blocks shared by the menu, warehouse, purchasing, costing and settings screens. */
import { useState, type ReactNode } from "react";
import { ConfirmDialog, Field, Modal, Select, TextInput } from "../components/ui";
import { ApiError, del } from "../lib/api";
import { UNIT_LABEL, num, qty as fmtQty, usd, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import type { StockItem } from "../lib/types";

/** Run a save; field errors go to `setErrors`, other errors to a toast. Returns true when it worked. */
export function useSaver() {
  const { t, err, fieldErrors } = useI18n();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, okText?: string) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      toast(okText ?? t("common.saved"));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.issues?.length) setErrors(fieldErrors(e));
      else toast(err(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { errors, busy, run, setErrors };
}

/** Arabic + English name inputs side by side. */
export function NameFields<T extends { nameAr: string; nameEn: string }>({ f, set, errors, idp }: { f: T; set: (v: T) => void; errors?: Record<string, string>; idp: string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("common.nameAr")} htmlFor={`${idp}-ar`} error={errors?.nameAr}>
        <TextInput id={`${idp}-ar`} dir="rtl" value={f.nameAr} onChange={(e) => set({ ...f, nameAr: e.target.value })} />
      </Field>
      <Field label={t("common.nameEn")} htmlFor={`${idp}-en`} error={errors?.nameEn}>
        <TextInput id={`${idp}-en`} dir="ltr" value={f.nameEn} onChange={(e) => set({ ...f, nameEn: e.target.value })} />
      </Field>
    </div>
  );
}

export function CurrencySelect({ value, onChange, id }: { value: Currency; onChange: (c: Currency) => void; id?: string }) {
  const { tr } = useI18n();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as Currency)}>
      <option value="USD">{tr("دولار $", "USD $")}</option>
      <option value="SYP">{tr("ليرة سورية", "Syrian pound")}</option>
    </Select>
  );
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? "opacity-60" : ""}`}>
      <input type="checkbox" className="h-4 w-4 accent-ink" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** A number typed as text so people can clear it; empty → "". */
export function NumInput({ value, onChange, id, step = "any", min = 0, className = "", placeholder }: { value: string; onChange: (v: string) => void; id?: string; step?: string; min?: number; className?: string; placeholder?: string }) {
  return <TextInput id={id} inputMode="decimal" type="number" step={step} min={min} dir="ltr" className={`num ${className}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export const unitOf = (code: string, lang: "ar" | "en") => UNIT_LABEL[code]?.[lang] ?? code;

/** Save / cancel footer for dialogs. */
export function DialogFooter({ onCancel, onSave, disabled, busy, saveLabel }: { onCancel: () => void; onSave: () => void; disabled?: boolean; busy?: boolean; saveLabel?: string }) {
  const { t } = useI18n();
  return (
    <>
      <button className="btn" onClick={onCancel}>
        {t("common.cancel")}
      </button>
      <button className="btn btn-primary" onClick={onSave} disabled={disabled || busy}>
        {busy ? t("common.saving") : (saveLabel ?? t("common.save"))}
      </button>
    </>
  );
}

export interface RecipeLine {
  itemId: string;
  qty: string;
}

/** Ingredients + packaging used for one unit (a product or an add-on). */
export function RecipeEditor({ lines, setLines, items, seeCost }: { lines: RecipeLine[]; setLines: (l: RecipeLine[]) => void; items: StockItem[]; seeCost: boolean }) {
  const { tr, pick, lang } = useI18n();
  const usable = items.filter((i) => i.kind !== "product" && i.active);
  const byId = new Map(items.map((i) => [i.id, i]));
  const total = lines.reduce((s, l) => s + (byId.get(l.itemId)?.avgCostUsd ?? 0) * (num(l.qty) || 0), 0);
  const set = (i: number, patch: Partial<RecipeLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-sm font-semibold">{tr("الوصفة (لقطعة واحدة)", "Recipe (for one piece)")}</span>
        {seeCost && (
          <span className="text-sm text-muted">
            {tr("الكلفة", "Cost")}: <span className="num ltr font-semibold text-ink">{usd(total)}</span>
          </span>
        )}
      </div>
      <div className="grid gap-2 p-3">
        {lines.length === 0 && <p className="text-sm text-faint">{tr("ما في مكوّنات بعد.", "No ingredients yet.")}</p>}
        {lines.map((l, i) => {
          const it = byId.get(l.itemId);
          return (
            <div key={i} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
              <Select aria-label={tr("المادة", "Item")} value={l.itemId} onChange={(e) => set(i, { itemId: e.target.value })}>
                <option value="">{tr("اختر مادة…", "Choose an item…")}</option>
                <optgroup label={tr("مكوّنات", "Ingredients")}>
                  {usable
                    .filter((x) => x.kind === "ingredient")
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {pick(x)}
                      </option>
                    ))}
                </optgroup>
                <optgroup label={tr("تغليف", "Packaging")}>
                  {usable
                    .filter((x) => x.kind === "packaging")
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {pick(x)}
                      </option>
                    ))}
                </optgroup>
              </Select>
              <div className="relative">
                <NumInput value={l.qty} onChange={(v) => set(i, { qty: v })} className="pe-11" />
                <span className="pointer-events-none absolute inset-y-0 end-2 grid place-items-center text-xs text-faint">{it ? unitOf(it.unitCode, lang) : ""}</span>
              </div>
              <button className="btn btn-ghost btn-danger px-2 py-1" aria-label={tr("حذف السطر", "Remove line")} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                ✕
              </button>
              {seeCost && it && num(l.qty) > 0 && (
                <span className="col-span-3 -mt-1 text-xs text-faint">
                  {fmtQty(num(l.qty))} × <span className="num ltr">{usd(it.avgCostUsd)}</span> = <span className="num ltr">{usd(it.avgCostUsd * num(l.qty))}</span>
                </span>
              )}
            </div>
          );
        })}
        <button className="btn btn-ghost w-fit px-2 py-1 text-sm" onClick={() => setLines([...lines, { itemId: "", qty: "" }])}>
          {tr("+ مكوّن", "+ Ingredient")}
        </button>
      </div>
    </div>
  );
}

export const recipeBody = (lines: RecipeLine[]) => lines.filter((l) => l.itemId && num(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: num(l.qty) }));

/** A simple confirm-like dialog with any body and a primary action. */
export function ActionDialog({ title, children, onClose, onSave, disabled, busy, saveLabel, wide }: { title: string; children: ReactNode; onClose: () => void; onSave: () => void; disabled?: boolean; busy?: boolean; saveLabel?: string; wide?: boolean }) {
  return (
    <Modal title={title} onClose={onClose} wide={wide} footer={<DialogFooter onCancel={onClose} onSave={onSave} disabled={disabled} busy={busy} saveLabel={saveLabel} />}>
      <div className="grid gap-3">{children}</div>
    </Modal>
  );
}

/** Edit/Delete buttons for a table row. */
export function RowActions({ onEdit, onDelete, canEdit, canDelete, extra }: { onEdit?: () => void; onDelete?: () => void; canEdit: boolean; canDelete: boolean; extra?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end gap-1 whitespace-nowrap">
      {extra}
      {canEdit && onEdit && (
        <button className="btn btn-ghost px-2 py-1 text-sm" onClick={(e) => (e.stopPropagation(), onEdit())}>
          {t("common.edit")}
        </button>
      )}
      {canDelete && onDelete && (
        <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={(e) => (e.stopPropagation(), onDelete())}>
          {t("common.delete")}
        </button>
      )}
    </div>
  );
}

/** "Delete X?" → DELETE path → toast → onDone. */
export function DeleteConfirm({ name, path, onClose, onDone }: { name: string; path: string; onClose: () => void; onDone: () => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  return (
    <ConfirmDialog
      text={t("common.confirmDelete", { name })}
      onClose={onClose}
      onConfirm={async () => {
        try {
          await del(path);
          toast(t("common.deleted"));
          onClose();
          onDone();
        } catch (e) {
          toast(err(e), "error");
          onClose();
        }
      }}
    />
  );
}
