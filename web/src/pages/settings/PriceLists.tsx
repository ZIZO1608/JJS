import { useEffect, useState } from "react";
import { ConfirmDialog, Empty, Field, Modal, Select, Spinner, TextInput } from "../../components/ui";
import { del, get, post, put } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { money, num, type Currency } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import type { Catalog } from "../../lib/types";

interface PriceList {
  id: string;
  nameAr: string;
  nameEn: string;
  active: boolean;
  clients: number;
  items: number;
}
interface ListItem {
  productId: string;
  price: number;
  currency: Currency;
}

/** Distributor / big shop / small shop prices. A client on a list pays its price unless they have their own special price. */
export function PriceListsTab() {
  const { tr, pick, err, lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const lists = useData<{ rows: PriceList[] }>("/clients/price-lists");
  const catalog = useData<Catalog>("/menu/catalog");
  const [open, setOpen] = useState<PriceList | null>(null);
  const [rows, setRows] = useState<Record<string, { price: string; currency: Currency }>>({});
  const [editing, setEditing] = useState<PriceList | "new" | null>(null);
  const [names, setNames] = useState({ nameAr: "", nameEn: "" });
  const [toDelete, setToDelete] = useState<PriceList | null>(null);

  useEffect(() => {
    if (!open) return;
    get<{ rows: ListItem[] }>(`/clients/price-lists/${open.id}/items`)
      .then((r) => setRows(Object.fromEntries(r.rows.map((x) => [x.productId, { price: String(x.price), currency: x.currency }]))))
      .catch((e) => toast(err(e), "error"));
  }, [open, toast, err]);

  const saveItems = async () => {
    if (!open) return;
    try {
      const items = Object.entries(rows)
        .filter(([, v]) => v.price !== "" && Number.isFinite(num(v.price)))
        .map(([productId, v]) => ({ productId, price: num(v.price), currency: v.currency }));
      await put(`/clients/price-lists/${open.id}/items`, { items });
      toast(tr("تم حفظ الأسعار", "Prices saved"));
      void lists.reload();
    } catch (e) {
      toast(err(e), "error");
    }
  };
  const saveList = async () => {
    try {
      if (editing === "new") await post("/clients/price-lists", { ...names, active: true });
      else if (editing) await put(`/clients/price-lists/${editing.id}`, { ...names, active: editing.active });
      setEditing(null);
      void lists.reload();
    } catch (e) {
      toast(err(e), "error");
    }
  };
  if (!lists.data || !catalog.data) return <Spinner />;
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <div>
        <p className="mb-3 text-sm text-muted">{tr("قوائم أسعار حسب نوع الزبون. الزبون على قائمة بيدفع سعرها، إلا إذا إله سعر خاص فيه.", "Prices by client type. A client on a list pays its price, unless they have their own special price.")}</p>
        <div className="grid gap-2">
          {lists.data.rows.map((l) => (
            <button key={l.id} className={`rounded-xl border p-3 text-start ${open?.id === l.id ? "border-ink" : "border-line"} bg-surface`} onClick={() => setOpen(l)}>
              <div className="font-semibold">{pick(l)}</div>
              <div className="text-xs text-muted">
                {tr(`${l.items} صنف · ${l.clients} زبون`, `${l.items} products · ${l.clients} clients`)}
              </div>
            </button>
          ))}
          {lists.data.rows.length === 0 && <Empty text={tr("ما في قوائم أسعار بعد.", "No price lists yet.")} />}
          {can("clients", "create") && (
            <button
              className="btn"
              onClick={() => {
                setNames({ nameAr: "", nameEn: "" });
                setEditing("new");
              }}
            >
              {tr("+ قائمة أسعار", "+ Price list")}
            </button>
          )}
        </div>
      </div>
      <div>
        {!open ? (
          <Empty text={tr("اختر قائمة لتعديل أسعارها.", "Choose a list to edit its prices.")} />
        ) : (
          <div className="card p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <h3 className="font-bold">{pick(open)}</h3>
              <div className="flex gap-2">
                {can("clients", "edit") && (
                  <button
                    className="btn btn-ghost px-2 py-1 text-sm"
                    onClick={() => {
                      setNames({ nameAr: open.nameAr, nameEn: open.nameEn });
                      setEditing(open);
                    }}
                  >
                    {tr("تغيير الاسم", "Rename")}
                  </button>
                )}
                {can("clients", "delete") && (
                  <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setToDelete(open)}>
                    {tr("حذف", "Delete")}
                  </button>
                )}
                {can("clients", "edit") && (
                  <button className="btn btn-primary px-3 py-1 text-sm" onClick={saveItems}>
                    {tr("حفظ الأسعار", "Save prices")}
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">{tr("الصنف", "Product")}</th>
                    <th className="th text-end">{tr("سعر المنيو", "Menu price")}</th>
                    <th className="th">{tr("سعر هالقائمة", "This list's price")}</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.data.products.map((p) => {
                    const r = rows[p.id] ?? { price: "", currency: p.currency };
                    return (
                      <tr key={p.id}>
                        <td className="td font-semibold">{pick(p)}</td>
                        <td className="td text-end num ltr text-muted">{money(p.price, p.currency, lang)}</td>
                        <td className="td">
                          <div className="flex gap-2">
                            <TextInput className="max-w-[9rem] num" dir="ltr" inputMode="decimal" placeholder={tr("نفس المنيو", "same as menu")} value={r.price} onChange={(e) => setRows({ ...rows, [p.id]: { ...r, price: e.target.value } })} aria-label={pick(p)} disabled={!can("clients", "edit")} />
                            <Select className="max-w-[6rem]" value={r.currency} onChange={(e) => setRows({ ...rows, [p.id]: { ...r, currency: e.target.value as Currency } })} aria-label={tr("العملة", "Currency")} disabled={!can("clients", "edit")}>
                              <option value="SYP">SYP</option>
                              <option value="USD">USD</option>
                            </Select>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {editing && (
        <Modal
          title={editing === "new" ? tr("قائمة أسعار جديدة", "New price list") : tr("تغيير الاسم", "Rename")}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                {tr("إلغاء", "Cancel")}
              </button>
              <button className="btn btn-primary" disabled={!names.nameAr || !names.nameEn} onClick={saveList}>
                {tr("حفظ", "Save")}
              </button>
            </>
          }
        >
          <div className="grid gap-3">
            <Field label={tr("الاسم بالعربي", "Arabic name")} htmlFor="pl-ar">
              <TextInput id="pl-ar" dir="rtl" value={names.nameAr} onChange={(e) => setNames({ ...names, nameAr: e.target.value })} />
            </Field>
            <Field label={tr("الاسم بالإنكليزي", "English name")} htmlFor="pl-en">
              <TextInput id="pl-en" dir="ltr" value={names.nameEn} onChange={(e) => setNames({ ...names, nameEn: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
      {toDelete && (
        <ConfirmDialog
          text={tr(`حذف «${toDelete.nameAr}»؟`, `Delete “${toDelete.nameEn}”?`)}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            try {
              await del(`/clients/price-lists/${toDelete.id}`);
              setToDelete(null);
              setOpen(null);
              void lists.reload();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </div>
  );
}
