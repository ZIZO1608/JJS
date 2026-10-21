import { useState } from "react";
import { Stat } from "../components/Tabs";
import { ConfirmDialog, Empty, Field, Modal, PageHeader, Select, Spinner, TextInput } from "../components/ui";
import { ApiError, del, post, put } from "../lib/api";
import { useAppSettings } from "../lib/appSettings";
import { useAuth } from "../lib/auth";
import { money, num, today, type Currency } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { useData } from "../lib/useData";

interface Asset {
  id: string;
  nameAr: string;
  nameEn: string;
  price: number;
  currency: Currency;
  priceUsd: number;
  purchaseDate: string;
  lifeMonths: number;
  salvageUsd: number;
  note: string;
  active: boolean;
  monthlyUsd: number;
  monthsUsed: number;
  accumulatedUsd: number;
  bookValueUsd: number;
}

function AssetDialog({ asset, onClose, onSaved }: { asset: Asset | null; onClose: () => void; onSaved: () => void }) {
  const { tr, err, fieldErrors } = useI18n();
  const toast = useToast();
  const { s } = useAppSettings();
  const [f, setF] = useState({
    nameAr: asset?.nameAr ?? "",
    nameEn: asset?.nameEn ?? "",
    price: String(asset?.price ?? ""),
    currency: asset?.currency ?? ((s?.defaultCurrency ?? "USD") as Currency),
    purchaseDate: asset?.purchaseDate ?? today(),
    lifeMonths: String(asset?.lifeMonths ?? 36),
    salvageUsd: String(asset?.salvageUsd ?? 0),
    note: asset?.note ?? "",
    active: asset?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const price = num(f.price);
  const life = num(f.lifeMonths);
  const salvage = Number.isNaN(num(f.salvageUsd)) ? 0 : num(f.salvageUsd);
  const previewUsd = f.currency === "USD" && price > 0 && life > 0 ? (price - salvage) / life : null;

  const save = async () => {
    setErrors({});
    const body = { ...f, price, lifeMonths: Math.round(life), salvageUsd: salvage };
    try {
      if (asset) await put(`/assets/${asset.id}`, body);
      else await post("/assets", body);
      toast(tr("تم الحفظ", "Saved"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      else toast(err(e), "error");
    }
  };

  return (
    <Modal
      wide
      title={asset ? tr("تعديل الأصل", "Edit asset") : tr("أصل جديد", "New asset")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {tr("إلغاء", "Cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!f.nameAr.trim() || !f.nameEn.trim() || !(price > 0) || !(life >= 1)}>
            {tr("حفظ", "Save")}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("الاسم بالعربي", "Name (Arabic)")} htmlFor="as-ar" error={errors.nameAr}>
          <TextInput id="as-ar" dir="rtl" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        </Field>
        <Field label={tr("الاسم بالإنكليزي", "Name (English)")} htmlFor="as-en" error={errors.nameEn}>
          <TextInput id="as-en" dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={tr("سعر الشراء", "Purchase price")} htmlFor="as-price" error={errors.price}>
            <TextInput id="as-price" dir="ltr" inputMode="decimal" className="num" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </Field>
          <Field label={tr("العملة", "Currency")} htmlFor="as-cur">
            <Select id="as-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
              <option value="USD">USD</option>
              <option value="SYP">SYP</option>
            </Select>
          </Field>
        </div>
        <Field label={tr("تاريخ الشراء", "Purchase date")} htmlFor="as-date" error={errors.purchaseDate}>
          <TextInput id="as-date" type="date" value={f.purchaseDate} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} />
        </Field>
        <Field label={tr("العمر المتوقع (أشهر)", "Useful life (months)")} htmlFor="as-life" error={errors.lifeMonths} hint={tr("مثلاً براد ٦٠ شهر، لابتوب ٣٦", "e.g. fridge 60, laptop 36")}>
          <TextInput id="as-life" dir="ltr" inputMode="numeric" className="num" value={f.lifeMonths} onChange={(e) => setF({ ...f, lifeMonths: e.target.value })} />
        </Field>
        <Field label={tr("قيمته بآخر عمره ($)", "Value at the end ($)")} htmlFor="as-salv" error={errors.salvageUsd} hint={tr("كم بينباع بعد ما يخلص عمره — غالباً ٠", "What it sells for at the end — usually 0")}>
          <TextInput id="as-salv" dir="ltr" inputMode="decimal" className="num" value={f.salvageUsd} onChange={(e) => setF({ ...f, salvageUsd: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={tr("ملاحظة", "Note")} htmlFor="as-note">
            <TextInput id="as-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-ink" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          {tr("مستخدم حالياً", "In use")}
        </label>
        {previewUsd !== null && (
          <p className="text-sm text-muted sm:col-span-2">
            {tr("الاستهلاك الشهري:", "Monthly depreciation:")} <b className="num ltr">{money(previewUsd)}</b>
          </p>
        )}
      </div>
    </Modal>
  );
}

export function AssetsPage() {
  const { tr, pick, err, fmtDate } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useData<{ rows: Asset[] }>("/assets");
  const [editing, setEditing] = useState<Asset | "new" | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);

  if (!data) return <Spinner />;
  const rows = data.rows;
  const sum = (k: keyof Asset) => rows.reduce((s, a) => s + (Number(a[k]) || 0), 0);
  const monthly = rows.filter((a) => a.active && a.monthsUsed < a.lifeMonths).reduce((s, a) => s + a.monthlyUsd, 0);

  return (
    <>
      <PageHeader
        title={tr("الأصول والاستهلاك", "Assets & depreciation")}
        subtitle={tr(
          "الاستهلاك = سعر الجهاز موزّع على أشهر عمره، فكل شهر ينحسب جزء منه كمصروف (مثلاً براد بـ ٦٠٠$ لـ ٦٠ شهر = ١٠$ بالشهر).",
          "Depreciation spreads a machine's price over its life, so each month carries part of it as a cost (e.g. a $600 fridge over 60 months = $10 a month).",
        )}
        actions={
          can("assets", "create") && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              {tr("+ أصل", "+ Asset")}
            </button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("قيمة الشراء", "Bought for")} value={money(sum("priceUsd"))} />
        <Stat label={tr("الاستهلاك الشهري", "Depreciation per month")} value={money(monthly)} />
        <Stat label={tr("المستهلك لحد اليوم", "Depreciated so far")} value={money(sum("accumulatedUsd"))} />
        <Stat label={tr("القيمة الدفترية", "Book value now")} value={money(sum("bookValueUsd"))} />
      </div>
      {rows.length === 0 ? (
        <Empty text={tr("ما في أصول. أضف البرادات والأفران والسكوتر…", "No assets yet. Add fridges, ovens, the scooter…")} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th">{tr("الأصل", "Asset")}</th>
                <th className="th text-end">{tr("السعر", "Price")}</th>
                <th className="th text-end">{tr("بالشهر", "Per month")}</th>
                <th className="th text-end">{tr("الأشهر", "Months")}</th>
                <th className="th text-end">{tr("المستهلك", "Depreciated")}</th>
                <th className="th text-end">{tr("القيمة الآن", "Book value")}</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const done = a.monthsUsed >= a.lifeMonths;
                return (
                  <tr key={a.id} className={a.active ? "" : "opacity-60"}>
                    <td className="td">
                      <div className="font-semibold">
                        {pick(a)} {!a.active && <span className="chip ms-1">{tr("غير مستخدم", "not in use")}</span>}
                        {done && <span className="chip ms-1">{tr("انتهى استهلاكه", "fully depreciated")}</span>}
                      </div>
                      <div className="text-xs text-faint">
                        {fmtDate(`${a.purchaseDate}T12:00:00`)} {a.note && `· ${a.note}`}
                      </div>
                    </td>
                    <td className="td text-end num ltr whitespace-nowrap">
                      {money(a.price, a.currency)}
                      {a.currency !== "USD" && <span className="block text-xs text-faint">{money(a.priceUsd)}</span>}
                    </td>
                    <td className="td text-end num ltr">{money(a.monthlyUsd)}</td>
                    <td className="td text-end num ltr">
                      {a.monthsUsed}/{a.lifeMonths}
                    </td>
                    <td className="td text-end num ltr">{money(a.accumulatedUsd)}</td>
                    <td className="td text-end num ltr font-semibold">{money(a.bookValueUsd)}</td>
                    <td className="td whitespace-nowrap text-end">
                      {can("assets", "edit") && (
                        <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(a)}>
                          {tr("تعديل", "Edit")}
                        </button>
                      )}
                      {can("assets", "delete") && (
                        <button className="btn btn-ghost btn-danger px-2 py-1 text-sm" onClick={() => setDeleting(a)}>
                          {tr("حذف", "Delete")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-sunken font-semibold">
                <td className="td">{tr("المجموع", "Total")}</td>
                <td className="td text-end num ltr">{money(sum("priceUsd"))}</td>
                <td className="td text-end num ltr">{money(monthly)}</td>
                <td className="td" />
                <td className="td text-end num ltr">{money(sum("accumulatedUsd"))}</td>
                <td className="td text-end num ltr">{money(sum("bookValueUsd"))}</td>
                <td className="td" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <AssetDialog
          asset={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          text={tr(`حذف ${deleting.nameAr}؟`, `Delete ${deleting.nameEn}?`)}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await del(`/assets/${deleting.id}`);
              setDeleting(null);
              void reload();
            } catch (e) {
              toast(err(e), "error");
            }
          }}
        />
      )}
    </>
  );
}
