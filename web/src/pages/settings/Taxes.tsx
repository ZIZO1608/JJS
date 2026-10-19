import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog, Empty, Field, Modal, Select, Spinner, StatusDot, TextInput } from "../../components/ui";
import { ApiError, del, get, post, put } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";

interface Tax {
  id: string;
  nameAr: string;
  nameEn: string;
  kind: "percent" | "fixed";
  value: number;
  active: boolean;
}

function TaxDialog({ tax, onClose, onSaved }: { tax: Tax | null; onClose: () => void; onSaved: () => void }) {
  const { t, err, fieldErrors } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ nameAr: tax?.nameAr ?? "", nameEn: tax?.nameEn ?? "", kind: tax?.kind ?? ("percent" as Tax["kind"]), value: String(tax?.value ?? ""), active: tax?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    setErrors({});
    try {
      const body = { ...f, value: Number(f.value) };
      if (tax) await put(`/taxes/${tax.id}`, body);
      else await post("/taxes", body);
      toast(t("common.saved"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    }
  };
  return (
    <Modal
      title={tax ? t("common.edit") : t("taxes.new")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!f.nameAr || !f.nameEn || f.value === ""}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t("common.nameAr")} htmlFor="t-ar" error={errors.nameAr}>
          <TextInput id="t-ar" dir="rtl" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        </Field>
        <Field label={t("common.nameEn")} htmlFor="t-en" error={errors.nameEn}>
          <TextInput id="t-en" dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("taxes.kind")} htmlFor="t-kind">
            <Select id="t-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Tax["kind"] })}>
              <option value="percent">{t("taxes.percent")}</option>
              <option value="fixed">{t("taxes.fixed")}</option>
            </Select>
          </Field>
          <Field label={t("taxes.value")} htmlFor="t-val" error={errors.value}>
            <TextInput id="t-val" type="number" min={0} step="0.01" dir="ltr" className="num" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          </Field>
        </div>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          {t("common.active")}
        </label>
      </div>
    </Modal>
  );
}

export function TaxesTab() {
  const { t, pick, err, fieldErrors } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [taxes, setTaxes] = useState<Tax[] | null>(null);
  const [editing, setEditing] = useState<Tax | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Tax | null>(null);

  const load = useCallback(async () => setTaxes((await get<{ taxes: Tax[] }>("/taxes")).taxes), []);
  useEffect(() => {
    load().catch((e) => toast(err(e), "error"));
  }, [load, toast, err]);

  if (!taxes) return <Spinner />;
  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-muted">{t("taxes.subtitle")}</p>
        {can("settings", "create") && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            {t("taxes.new")}
          </button>
        )}
      </div>
      {taxes.length === 0 ? (
        <Empty text={t("taxes.noTaxes")} />
      ) : (
        <div className="card p-0">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {taxes.map((x) => (
                <tr key={x.id}>
                  <td className="td font-semibold">{pick(x)}</td>
                  <td className="td ltr num">{x.kind === "percent" ? `${x.value}%` : `$${x.value.toFixed(2)}`}</td>
                  <td className="td">
                    <span className="chip">
                      <StatusDot tone={x.active ? "good" : "mute"} />
                      {x.active ? t("common.active") : t("common.inactive")}
                    </span>
                  </td>
                  <td className="td whitespace-nowrap text-end">
                    {can("settings", "edit") && (
                      <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(x)}>
                        {t("common.edit")}
                      </button>
                    )}
                    {can("settings", "delete") && (
                      <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setToDelete(x)}>
                        {t("common.delete")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <TaxDialog
          tax={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {toDelete && (
        <ConfirmDialog
          text={t("common.confirmDelete", { name: pick(toDelete) })}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            try {
              await del(`/taxes/${toDelete.id}`);
              setToDelete(null);
              toast(t("common.deleted"));
              await load();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </div>
  );
}
