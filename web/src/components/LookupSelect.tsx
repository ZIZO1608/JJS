import { useCallback, useEffect, useState } from "react";
import { LOOKUP_LABEL, type LookupType } from "@shared/permissions";
import { ApiError, get, post } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { Field, Modal, TextInput } from "./ui";

export interface LookupItem {
  id: string;
  listType: LookupType;
  nameAr: string;
  nameEn: string;
  sort: number;
  active: boolean;
}

const ADD = "__add_new__";

/**
 * A dropdown backed by an editable list. Its last option, "+ Add new", opens a small
 * dialog and saves the new item straight into the list, then selects it.
 * Later stages use this everywhere (expense items, units, payment methods…).
 */
export function LookupSelect({
  listType,
  value,
  onChange,
  id,
  placeholder,
}: {
  listType: LookupType;
  value: string;
  onChange: (id: string) => void;
  id?: string;
  placeholder?: string;
}) {
  const { t, pick, fieldErrors } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<LookupItem[]>([]);
  const [canAdd, setCanAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ nameAr: "", nameEn: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await get<{ items: LookupItem[]; canAdd: boolean }>(`/lookups?type=${listType}`);
    setItems(r.items);
    setCanAdd(r.canAdd);
  }, [listType]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const r = await post<{ item: LookupItem }>("/lookups", { listType, ...form });
      await load();
      onChange(r.item.id);
      setAdding(false);
      setForm({ nameAr: "", nameEn: "" });
      toast(t("common.saved"));
    } catch (e) {
      if (e instanceof ApiError && e.code === "duplicate") setErrors({ nameEn: t("errors.duplicate") });
      else if (e instanceof ApiError) setErrors(fieldErrors(e));
      else toast(t("errors.generic"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => (e.target.value === ADD ? setAdding(true) : onChange(e.target.value))}
      >
        <option value="">{placeholder ?? "—"}</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {pick(i)}
          </option>
        ))}
        {canAdd && <option value={ADD}>{t("lists.addNew")}</option>}
      </select>
      {adding && (
        <Modal
          title={t("lists.addTitle", { list: pick(LOOKUP_LABEL[listType]) })}
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(false)}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" disabled={saving || !form.nameAr || !form.nameEn} onClick={save}>
                {saving ? t("common.saving") : t("common.add")}
              </button>
            </>
          }
        >
          <div className="grid gap-3">
            <Field label={t("common.nameAr")} htmlFor="lk-ar" error={errors.nameAr}>
              <TextInput id="lk-ar" dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
            </Field>
            <Field label={t("common.nameEn")} htmlFor="lk-en" error={errors.nameEn}>
              <TextInput id="lk-en" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
