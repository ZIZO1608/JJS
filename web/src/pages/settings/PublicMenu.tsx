import { useEffect, useState } from "react";
import { Field, Spinner, TextInput } from "../../components/ui";
import { put } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { useData } from "../../lib/useData";
import { Check, useSaver } from "../kit";

export interface PublicMenuSettings {
  enabled: boolean;
  showPrices: boolean;
  whatsapp: string;
  heroTitleAr: string;
  heroTitleEn: string;
  heroSubtitleAr: string;
  heroSubtitleEn: string;
  aboutAr: string;
  aboutEn: string;
  hoursAr: string;
  hoursEn: string;
  instagram: string;
  facebook: string;
  mapUrl: string;
}

type TextKey = Exclude<keyof PublicMenuSettings, "enabled" | "showPrices">;

/** The public menu page (/menu): on/off, prices, the WhatsApp number orders go to, and the page texts. */
export function PublicMenuTab() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const cur = useData<PublicMenuSettings>("/system/public-menu");
  const { errors, busy, run } = useSaver();
  const [f, setF] = useState<PublicMenuSettings | null>(null);
  useEffect(() => {
    if (cur.data) setF(cur.data);
  }, [cur.data]);
  if (!f) return <Spinner />;
  const editable = can("settings", "edit");
  const link = `${window.location.origin}/menu`;
  const text = (k: TextKey, label: string, opts: { dir?: "rtl" | "ltr"; area?: boolean; placeholder?: string; hint?: string } = {}) => (
    <Field label={label} htmlFor={`pm-${k}`} error={errors[k]} hint={opts.hint}>
      {opts.area ? (
        <textarea id={`pm-${k}`} rows={3} className="input" dir={opts.dir} disabled={!editable} placeholder={opts.placeholder} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      ) : (
        <TextInput id={`pm-${k}`} dir={opts.dir} disabled={!editable} placeholder={opts.placeholder} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      )}
    </Field>
  );
  const save = async () => {
    if (await run(() => put<PublicMenuSettings>("/system/public-menu", f))) await cur.reload();
  };
  return (
    <div className="grid max-w-4xl gap-5">
      <section className="card grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{tr("المنيو العام", "Public menu")}</h2>
            <p className="text-sm text-muted">
              {tr("صفحة صغيرة لكل الناس: شو عنا، الأسعار، وزر يبعت الطلب على واتساب. بتختار المنتجات من المنيو بزر «ظاهر» جنب كل منتج.", "A small page for everyone: what we sell, prices, and a button that sends the order on WhatsApp. Pick the products in the Menu with the “On menu” button next to each one.")}
            </p>
          </div>
          {cur.data?.enabled && (
            <a className="btn" href="/menu" target="_blank" rel="noreferrer">
              {tr("افتح الصفحة ↗", "Open the page ↗")}
            </a>
          )}
        </div>
        <div className="rounded-lg bg-sunken px-3 py-2 text-sm">
          {tr("الرابط:", "Link:")} <span className="num ltr select-all font-semibold">{link}</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Check checked={f.enabled} disabled={!editable} onChange={(v) => setF({ ...f, enabled: v })}>
            {tr("الصفحة شغّالة (الناس بتقدر تفتحها)", "The page is on (people can open it)")}
          </Check>
          <Check checked={f.showPrices} disabled={!editable} onChange={(v) => setF({ ...f, showPrices: v })}>
            {tr("اعرض الأسعار", "Show prices")}
          </Check>
        </div>
        {text("whatsapp", tr("رقم واتساب للطلبات", "WhatsApp number for orders"), { dir: "ltr", placeholder: "963 9xx xxx xxx", hint: tr("مع رمز البلد، بدون +", "With the country code, no +") })}
      </section>

      <section className="card grid gap-3 md:grid-cols-2">
        <h2 className="text-lg font-bold md:col-span-2">{tr("أعلى الصفحة", "Top of the page")}</h2>
        {text("heroTitleAr", tr("العنوان (عربي)", "Title (Arabic)"), { dir: "rtl" })}
        {text("heroTitleEn", tr("العنوان (إنكليزي)", "Title (English)"), { dir: "ltr" })}
        {text("heroSubtitleAr", tr("السطر تحت العنوان (عربي)", "Line under the title (Arabic)"), { dir: "rtl", area: true })}
        {text("heroSubtitleEn", tr("السطر تحت العنوان (إنكليزي)", "Line under the title (English)"), { dir: "ltr", area: true })}
      </section>

      <section className="card grid gap-3 md:grid-cols-2">
        <h2 className="text-lg font-bold md:col-span-2">{tr("أسفل الصفحة", "Bottom of the page")}</h2>
        {text("aboutAr", tr("نبذة عنا (عربي)", "About us (Arabic)"), { dir: "rtl", area: true })}
        {text("aboutEn", tr("نبذة عنا (إنكليزي)", "About us (English)"), { dir: "ltr", area: true })}
        {text("hoursAr", tr("أوقات الدوام (عربي)", "Opening hours (Arabic)"), { dir: "rtl", placeholder: "كل يوم ٨ الصبح – ٤ العصر" })}
        {text("hoursEn", tr("أوقات الدوام (إنكليزي)", "Opening hours (English)"), { dir: "ltr", placeholder: "Every day 8am – 4pm" })}
        {text("instagram", "Instagram", { dir: "ltr", placeholder: "https://instagram.com/…" })}
        {text("facebook", "Facebook", { dir: "ltr", placeholder: "https://facebook.com/…" })}
        <div className="md:col-span-2">{text("mapUrl", tr("رابط الموقع على Google Maps", "Google Maps link"), { dir: "ltr", placeholder: "https://maps.app.goo.gl/…" })}</div>
        <p className="text-sm text-muted md:col-span-2">{tr("الاسم والشعار والهاتف والعنوان بيجوا من «النشاط».", "The name, logo, phone and address come from the Business tab.")}</p>
      </section>

      {editable && (
        <div>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? tr("جارٍ الحفظ…", "Saving…") : tr("حفظ", "Save")}
          </button>
        </div>
      )}
    </div>
  );
}
