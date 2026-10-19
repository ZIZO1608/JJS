import { useCallback, useEffect, useState } from "react";
import { LOOKUP_LABEL, LOOKUP_TYPES, type LookupType } from "@shared/permissions";
import { LookupSelect, type LookupItem } from "../../components/LookupSelect";
import { ConfirmDialog, Field, Spinner, TextInput } from "../../components/ui";
import { ApiError, del, get, post, put } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";

function Row({ item, editable, onSaved, onDelete }: { item: LookupItem; editable: boolean; onSaved: () => void; onDelete: () => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const [f, setF] = useState(item);
  useEffect(() => setF(item), [item]);
  const dirty = f.nameAr !== item.nameAr || f.nameEn !== item.nameEn || f.active !== item.active || f.sort !== item.sort;
  const save = async () => {
    try {
      await put(`/lookups/${item.id}`, { nameAr: f.nameAr, nameEn: f.nameEn, active: f.active, sort: f.sort });
      toast(t("common.saved"));
      onSaved();
    } catch (e) {
      toast(err(e), "error");
    }
  };
  return (
    <tr className={f.active ? "" : "opacity-60"}>
      <td className="td w-20">
        <TextInput type="number" min={0} className="num !px-2 text-center" value={f.sort} disabled={!editable} onChange={(e) => setF({ ...f, sort: Number(e.target.value) })} aria-label={t("common.sort")} />
      </td>
      <td className="td">
        <TextInput dir="rtl" value={f.nameAr} disabled={!editable} onChange={(e) => setF({ ...f, nameAr: e.target.value })} aria-label={t("common.nameAr")} />
      </td>
      <td className="td">
        <TextInput dir="ltr" value={f.nameEn} disabled={!editable} onChange={(e) => setF({ ...f, nameEn: e.target.value })} aria-label={t("common.nameEn")} />
      </td>
      <td className="td whitespace-nowrap">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.active} disabled={!editable} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          {f.active ? t("common.active") : t("lists.hidden")}
        </label>
      </td>
      <td className="td whitespace-nowrap text-end">
        {editable && (
          <>
            <button className="btn btn-primary px-3 py-1 text-sm" disabled={!dirty || !f.nameAr || !f.nameEn} onClick={save}>
              {t("common.save")}
            </button>
            <button className="btn btn-ghost btn-danger ms-1 px-2 py-1 text-sm" onClick={onDelete}>
              {t("common.delete")}
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

export function ListsTab() {
  const { t, pick, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [type, setType] = useState<LookupType>("expense_item");
  const [items, setItems] = useState<LookupItem[] | null>(null);
  const [form, setForm] = useState({ nameAr: "", nameEn: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toDelete, setToDelete] = useState<LookupItem | null>(null);
  const [preview, setPreview] = useState("");
  const [previewKey, setPreviewKey] = useState(0);
  const editable = can("settings", "edit");

  const load = useCallback(async () => {
    const r = await get<{ items: LookupItem[] }>(`/lookups?type=${type}&includeInactive=1`);
    setItems(r.items);
    setPreviewKey((k) => k + 1);
  }, [type]);
  useEffect(() => {
    setItems(null);
    load().catch((e) => toast(err(e), "error"));
  }, [load, toast, err]);

  const add = async () => {
    setErrors({});
    try {
      await post("/lookups", { listType: type, ...form });
      setForm({ nameAr: "", nameEn: "" });
      toast(t("common.saved"));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "duplicate") setErrors({ nameEn: t("errors.duplicate") });
      else toast(err(e), "error");
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await del(`/lookups/${toDelete.id}`);
      toast(t("common.deleted"));
      setToDelete(null);
      await load();
    } catch (e) {
      toast(err(e), "error");
    }
  };

  return (
    <>
      <p className="mb-4 max-w-2xl text-muted">{t("lists.subtitle")}</p>
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="card flex flex-col gap-1 p-2">
          {LOOKUP_TYPES.map((lt) => (
            <button key={lt} onClick={() => setType(lt)} className={`rounded-lg px-3 py-2.5 text-start ${type === lt ? "bg-sunken font-semibold" : "hover:bg-sunken"}`}>
              {pick(LOOKUP_LABEL[lt])}
            </button>
          ))}
        </div>
        <div className="grid min-w-0 gap-4">
          {editable && (
            <div className="card grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={t("common.nameAr")} htmlFor="l-ar" error={errors.nameAr}>
                <TextInput id="l-ar" dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
              </Field>
              <Field label={t("common.nameEn")} htmlFor="l-en" error={errors.nameEn}>
                <TextInput id="l-en" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
              </Field>
              <button className="btn btn-primary" disabled={!form.nameAr || !form.nameEn} onClick={add}>
                {t("lists.addItem")}
              </button>
            </div>
          )}
          <div className="card p-0">
            {!items ? (
              <Spinner />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="th">{t("common.sort")}</th>
                      <th className="th">{t("common.nameAr")}</th>
                      <th className="th">{t("common.nameEn")}</th>
                      <th className="th">{t("common.status")}</th>
                      <th className="th" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <Row key={i.id} item={i} editable={editable} onSaved={() => void load()} onDelete={() => setToDelete(i)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card">
            <div className="mb-2 text-sm font-semibold">{t("lists.preview")}</div>
            <div className="max-w-sm">
              <LookupSelect key={`${type}-${previewKey}`} listType={type} value={preview} onChange={setPreview} placeholder={t("lists.previewLabel")} />
            </div>
          </div>
        </div>
      </div>
      {toDelete && <ConfirmDialog text={t("common.confirmDelete", { name: pick(toDelete) })} onConfirm={remove} onClose={() => setToDelete(null)} />}
    </>
  );
}
