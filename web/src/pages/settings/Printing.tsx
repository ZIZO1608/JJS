import { useEffect, useState } from "react";
import { Field, Select, Spinner, TextInput } from "../../components/ui";
import { put } from "../../lib/api";
import { useAppSettings } from "../../lib/appSettings";
import { useAuth } from "../../lib/auth";
import { num } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { NumInput, useSaver } from "../kit";

export function PrintingTab() {
  const { tr, t } = useI18n();
  const { can } = useAuth();
  const { s, reload } = useAppSettings();
  const { busy, run } = useSaver();
  const [f, setF] = useState({ receiptWidthMm: "80", invoiceSize: "thermal", labelWidthMm: "50", labelHeightMm: "30", receiptFooterAr: "", receiptFooterEn: "" });
  useEffect(() => {
    if (!s) return;
    const p = s.printing as typeof s.printing & { invoiceSize?: string };
    setF({ receiptWidthMm: String(p.receiptWidthMm), invoiceSize: p.invoiceSize ?? "thermal", labelWidthMm: String(p.labelWidthMm), labelHeightMm: String(p.labelHeightMm), receiptFooterAr: p.receiptFooterAr, receiptFooterEn: p.receiptFooterEn });
  }, [s]);
  if (!s) return <Spinner />;
  const w = Math.min(120, Math.max(20, num(f.labelWidthMm) || 50));
  const h = Math.min(120, Math.max(15, num(f.labelHeightMm) || 30));
  const save = async () => {
    const ok = await run(() =>
      put("/system/settings/printing", {
        receiptWidthMm: f.receiptWidthMm === "58" ? 58 : 80,
        invoiceSize: f.invoiceSize === "a4" ? "a4" : "thermal",
        labelWidthMm: w,
        labelHeightMm: h,
        receiptFooterAr: f.receiptFooterAr,
        receiptFooterEn: f.receiptFooterEn,
      }),
    );
    if (ok) await reload();
  };
  return (
    <div className="grid max-w-4xl gap-5 md:grid-cols-2">
      <section className="card grid gap-3">
        <h2 className="text-lg font-bold">{tr("الفواتير", "Invoices")}</h2>
        <Field label={tr("الحجم الافتراضي", "Default size")} htmlFor="pr-s" hint={tr("فيك تغيّر وقت الطباعة", "You can switch when printing")}>
          <Select id="pr-s" value={f.invoiceSize} onChange={(e) => setF({ ...f, invoiceSize: e.target.value })}>
            <option value="thermal">{tr("طابعة حرارية (إيصال)", "Thermal receipt printer")}</option>
            <option value="a4">A4</option>
          </Select>
        </Field>
        <Field label={tr("عرض ورق الطابعة الحرارية", "Thermal paper width")} htmlFor="pr-w">
          <Select id="pr-w" value={f.receiptWidthMm} onChange={(e) => setF({ ...f, receiptWidthMm: e.target.value })}>
            <option value="80">80 mm</option>
            <option value="58">58 mm</option>
          </Select>
        </Field>
        <Field label={tr("سطر آخر الفاتورة (عربي)", "Footer line (Arabic)")} htmlFor="pr-fa">
          <TextInput id="pr-fa" dir="rtl" value={f.receiptFooterAr} onChange={(e) => setF({ ...f, receiptFooterAr: e.target.value })} />
        </Field>
        <Field label={tr("سطر آخر الفاتورة (إنكليزي)", "Footer line (English)")} htmlFor="pr-fe">
          <TextInput id="pr-fe" dir="ltr" value={f.receiptFooterEn} onChange={(e) => setF({ ...f, receiptFooterEn: e.target.value })} />
        </Field>
      </section>
      <section className="card grid gap-3">
        <h2 className="text-lg font-bold">{tr("ملصقات الصلاحية", "Expiry labels")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr("العرض (مم)", "Width (mm)")} htmlFor="pr-lw">
            <NumInput id="pr-lw" value={f.labelWidthMm} onChange={(v) => setF({ ...f, labelWidthMm: v })} />
          </Field>
          <Field label={tr("الارتفاع (مم)", "Height (mm)")} htmlFor="pr-lh">
            <NumInput id="pr-lh" value={f.labelHeightMm} onChange={(v) => setF({ ...f, labelHeightMm: v })} />
          </Field>
        </div>
        <div className="grid place-items-center rounded-xl bg-sunken p-4">
          <div className="grid content-center gap-0.5 border border-ink bg-white p-1.5 text-[9px] leading-tight text-black" style={{ width: `${w * 3}px`, height: `${h * 3}px` }} aria-label={tr("معاينة الحجم", "Size preview")}>
            <b>Turkey & Cheddar</b>
            <span>Made 21/10 07:30</span>
            <b>Use by 22/10 07:30</b>
            <span className="mt-0.5 h-3 w-3/4 bg-[repeating-linear-gradient(90deg,#000_0_1px,transparent_1px_3px)]" />
          </div>
          <span className="mt-2 text-xs text-faint num ltr">
            {w} × {h} mm
          </span>
        </div>
      </section>
      {can("settings", "edit") && (
        <div className="md:col-span-2">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
}
