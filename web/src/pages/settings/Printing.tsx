import { useEffect, useState } from "react";
import { Field, Select, Spinner, TextInput } from "../../components/ui";
import { put } from "../../lib/api";
import { useAppSettings } from "../../lib/appSettings";
import { useAuth } from "../../lib/auth";
import { num } from "../../lib/format";
import { desktop, getRoll, guessDevicePrinters, openPrint, readDevicePrinters, setRoll, writeDevicePrinters, type DesktopPrinter, type DevicePrinters, type PrintKind, type RollState } from "../../lib/print";
import { useI18n } from "../../lib/i18n";
import { Check, NumInput, useSaver } from "../kit";

const readAutoPrint = () => {
  try {
    return localStorage.getItem("jjs.autoPrint") === "1";
  } catch {
    return false;
  }
};

/** This PC's printers, the roll in the shared printer, and auto-print after a sale. Saved as soon as you change them. */
function ThisComputer() {
  const { tr } = useI18n();
  const api = desktop();
  const [list, setList] = useState<DesktopPrinter[] | null>(null);
  const [cfg, setCfg] = useState<DevicePrinters>(readDevicePrinters);
  const [roll, setRollState] = useState<RollState | null>(null);
  const [auto, setAuto] = useState(readAutoPrint);
  useEffect(() => {
    void getRoll()
      .then(setRollState)
      .catch(() => undefined);
    if (!api) return;
    void api.printers().then((ps) => {
      setList(ps);
      const guessed = guessDevicePrinters(ps, readDevicePrinters());
      setCfg(guessed);
      writeDevicePrinters(guessed);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = (v: Partial<DevicePrinters>) => {
    const next = { ...cfg, ...v };
    setCfg(next);
    writeDevicePrinters(next);
  };
  const pickRoll = async (r: PrintKind) => {
    try {
      setRollState(await setRoll(r));
    } catch {
      /* offline: leave as it was */
    }
  };
  const printerSelect = (kind: PrintKind, id: string, label: string) => (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={cfg[kind]} onChange={(e) => change({ [kind]: e.target.value })}>
        <option value="">{tr("— افتح نافذة الطباعة —", "— Open the print window —")}</option>
        {(list ?? []).map((p) => (
          <option key={p.name} value={p.name}>
            {p.displayName}
          </option>
        ))}
        {cfg[kind] && list && !list.some((p) => p.name === cfg[kind]) && <option value={cfg[kind]}>{tr(`${cfg[kind]} (مو موجودة)`, `${cfg[kind]} (not found)`)}</option>}
      </Select>
    </Field>
  );
  return (
    <section className="card grid gap-3 md:col-span-2">
      <h2 className="text-lg font-bold">{tr("هالكمبيوتر", "This computer")}</h2>
      {api ? (
        <>
          <p className="text-sm text-muted">
            {tr(
              "اختار طابعة لكل نوع. لما تضغط اطبع، بتروح الفاتورة أو الملصق دغري عالطابعة الصح بالحجم الصح، بلا نافذة.",
              "Pick a printer for each kind. When you press Print, the invoice or label goes straight to the right printer at the right size, no window.",
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {printerSelect("label", "dp-label", tr("طابعة الملصقات والباركود", "Labels & barcodes printer"))}
            {printerSelect("receipt", "dp-receipt", tr("طابعة الفواتير (حراري)", "Invoices printer (thermal)"))}
          </div>
          <Check checked={cfg.direct} onChange={(v) => change({ direct: v })}>
            {tr("اطبع دغري بلا نافذة الطباعة", "Print straight away, without the print window")}
          </Check>
          <Check checked={cfg.sharedRoll} onChange={(v) => change({ sharedRoll: v })}>
            {tr("الملصقات والفواتير على نفس الطابعة (ذكّرني بدّل الرول)", "Labels and invoices share one printer (remind me to swap the roll)")}
          </Check>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            {tr(
              "من المتصفح بتطلع نافذة الطباعة كل مرة، بس الحجم بيكون مضبوط لحاله، وفوق بيكتبلك أي طابعة تختار. اكتب أسماء الطابعات متل ما هي بويندوز.",
              "In a browser the print window opens every time, but the paper size is set for you and a note on top says which printer to pick. Type the printer names as they are in Windows.",
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr("طابعة الملصقات والباركود", "Labels & barcodes printer")} htmlFor="bp-label">
              <TextInput id="bp-label" dir="ltr" placeholder="XP-236B Labels" value={cfg.label} onChange={(e) => change({ label: e.target.value })} />
            </Field>
            <Field label={tr("طابعة الفواتير (حراري)", "Invoices printer (thermal)")} htmlFor="bp-receipt">
              <TextInput id="bp-receipt" dir="ltr" placeholder="XP-236B Invoices" value={cfg.receipt} onChange={(e) => change({ receipt: e.target.value })} />
            </Field>
          </div>
          <Check checked={cfg.sharedRoll} onChange={(v) => change({ sharedRoll: v })}>
            {tr("الملصقات والفواتير على نفس الطابعة (ذكّرني بدّل الرول)", "Labels and invoices share one printer (remind me to swap the roll)")}
          </Check>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{tr("الرول اللي بالطابعة هلق:", "Roll in the printer now:")}</span>
        {(["label", "receipt"] as const).map((r) => (
          <button key={r} className={`btn px-3 py-1 text-sm ${roll?.roll === r ? "btn-primary" : ""}`} onClick={() => void pickRoll(r)}>
            {r === "label" ? tr("🏷️ ملصقات", "🏷️ Labels") : tr("🧾 فواتير 80 ملم", "🧾 Receipts 80 mm")}
          </button>
        ))}
        {roll?.changedBy && <span className="text-xs text-faint">{tr(`آخر تبديل: ${roll.changedBy}`, `Last swapped by ${roll.changedBy}`)}</span>}
      </div>
      <Check
        checked={auto}
        onChange={(v) => {
          setAuto(v);
          try {
            localStorage.setItem("jjs.autoPrint", v ? "1" : "0");
          } catch {
            /* storage unavailable */
          }
        }}
      >
        {tr("اطبع الفاتورة لحالها بعد كل بيعة (على هالكمبيوتر)", "Print the invoice by itself after every sale (on this computer)")}
      </Check>
    </section>
  );
}

export function PrintingTab() {
  const { tr, t } = useI18n();
  const { can } = useAuth();
  const { s, reload } = useAppSettings();
  const { busy, run } = useSaver();
  const [f, setF] = useState({ receiptWidthMm: "80", invoiceSize: "thermal", labelWidthMm: "50", labelHeightMm: "30", receiptFooterAr: "", receiptFooterEn: "", ox: "0", oy: "0", pad: "1.2", rm: "4", rx: "0", wa: "", social: "", qr: true });
  useEffect(() => {
    if (!s) return;
    const p = s.printing as Partial<typeof s.printing> & typeof s.printing;
    setF({
      receiptWidthMm: String(p.receiptWidthMm),
      invoiceSize: p.invoiceSize ?? "thermal",
      labelWidthMm: String(p.labelWidthMm),
      labelHeightMm: String(p.labelHeightMm),
      receiptFooterAr: p.receiptFooterAr,
      receiptFooterEn: p.receiptFooterEn,
      ox: String(p.labelOffsetXMm ?? 0),
      oy: String(p.labelOffsetYMm ?? 0),
      pad: String(p.labelPaddingMm ?? 1.2),
      rm: String(p.receiptSideMm ?? 4),
      rx: String(p.receiptOffsetXMm ?? 0),
      wa: p.receiptWhatsapp ?? "",
      social: p.receiptSocial ?? "",
      qr: p.receiptQr ?? true,
    });
  }, [s]);
  if (!s) return <Spinner />;
  const w = Math.min(120, Math.max(20, num(f.labelWidthMm) || 50));
  const h = Math.min(120, Math.max(15, num(f.labelHeightMm) || 30));
  const clampMm = (v: string, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, num(v) || 0)) * 10) / 10;
  const ox = clampMm(f.ox, -15, 15);
  const oy = clampMm(f.oy, -15, 15);
  const pad = clampMm(f.pad, 0, 8);
  const rm = clampMm(f.rm, 0, 10);
  const rx = clampMm(f.rx, -15, 15);
  const save = async () => {
    const ok = await run(() =>
      put("/system/settings/printing", {
        receiptWidthMm: f.receiptWidthMm === "58" ? 58 : 80,
        invoiceSize: f.invoiceSize === "a4" ? "a4" : "thermal",
        labelWidthMm: w,
        labelHeightMm: h,
        receiptFooterAr: f.receiptFooterAr,
        receiptFooterEn: f.receiptFooterEn,
        labelOffsetXMm: ox,
        labelOffsetYMm: oy,
        labelPaddingMm: pad,
        receiptSideMm: rm,
        receiptOffsetXMm: rx,
        receiptWhatsapp: f.wa.trim(),
        receiptSocial: f.social.trim(),
        receiptQr: f.qr,
      }),
    );
    if (ok) await reload();
  };
  const nudge = (k: "ox" | "oy" | "pad" | "rm" | "rx", d: number, lo: number, hi: number) => setF({ ...f, [k]: String(clampMm(String(clampMm(f[k], lo, hi) + d), lo, hi)) });
  const stepper = (k: "ox" | "oy" | "pad" | "rm" | "rx", id: string, label: string, hint: string, lo: number, hi: number) => (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-1">
        <button type="button" className="btn min-w-[44px] px-2 py-1 text-lg" aria-label="−0.5" onClick={() => nudge(k, -0.5, lo, hi)}>
          −
        </button>
        <NumInput id={id} value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} />
        <button type="button" className="btn min-w-[44px] px-2 py-1 text-lg" aria-label="+0.5" onClick={() => nudge(k, 0.5, lo, hi)}>
          +
        </button>
      </div>
    </Field>
  );
  const PX = 4; // preview scale: px per mm
  /** This shop's printer takes 80 mm receipt paper; receipts use the full 72 mm the head can print (4 mm clear on each side). Labels up to 80 mm. */
  const applyXp236b = (lw = f.labelWidthMm, lh = f.labelHeightMm) =>
    setF({ ...f, receiptWidthMm: "80", invoiceSize: "thermal", rm: "4", rx: "0", labelWidthMm: String(Math.min(80, num(lw) || 50)), labelHeightMm: lh });
  const test = (kind: "receipt" | "label") =>
    openPrint(`/print/test?kind=${kind}&width=${f.receiptWidthMm}&w=${w}&h=${h}&ox=${ox}&oy=${oy}&pad=${pad}&rm=${rm}&rx=${rx}`);
  const tooWide = w > 80;
  return (
    <div className="grid max-w-4xl gap-5 md:grid-cols-2">
      <section className="card grid gap-3 md:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{tr("الطابعة: Xprinter XP-236B", "Printer: Xprinter XP-236B")}</h2>
          <button className="btn" onClick={() => applyXp236b()}>
            {tr("اضبط الإعدادات لهالطابعة", "Use settings for this printer")}
          </button>
        </div>
        <p className="text-sm text-muted">
          {tr(
            "نفس الطابعة للفواتير والباركود. ورق الفواتير 80 ملم، والطباعة 72 ملم (4 ملم فاضي من كل جنب). بعد ما تغيّر نوع الرول (ملصقات ↔ فواتير) اضغط زر FEED لحتى تصفّر، وبعدين اطبع تجربة.",
            "One printer for invoices and barcodes. Receipt paper is 80 mm; the print is 72 mm wide (4 mm clear on each side). After you swap the roll (labels ↔ receipts), hold FEED until it beeps, then print a test.",
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{tr("حجم الملصق:", "Label size:")}</span>
          {[
            [40, 30],
            [50, 30],
            [58, 40],
          ].map(([lw, lh]) => (
            <button
              key={`${lw}x${lh}`}
              className={`btn px-2.5 py-1 text-sm num ltr ${w === lw && h === lh ? "btn-primary" : ""}`}
              onClick={() => applyXp236b(String(lw), String(lh))}
            >
              {lw}×{lh}
            </button>
          ))}
        </div>
        {tooWide && (
          <p className="text-sm font-semibold text-bad">
            {tr("انتبه: هالطابعة ما بتطبع أعرض من 80 ملم.", "Careful: this printer can't print wider than 80 mm.")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => test("receipt")}>
            {tr("اطبع فاتورة تجربة", "Print test invoice")}
          </button>
          <button className="btn" onClick={() => test("label")}>
            {tr("اطبع ملصق تجربة", "Print test label")}
          </button>
        </div>
        <p className="text-xs text-faint">
          {tr(
            "بنافذة الطباعة: اختار XP-236B، الهوامش «بلا»، وشيل «الرأس والتذييل». التجربة بتطبع بالأحجام اللي هون حتى لو ما حفظت بعد.",
            "In the print window: pick XP-236B, Margins “None”, and untick “Headers and footers”. The test uses the sizes on this screen even before you save.",
          )}
        </p>
      </section>
      <section className="card grid gap-4 md:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{tr("الهوامش ومكان الطباعة", "Margins & position")}</h2>
          <button className="btn btn-ghost text-sm" onClick={() => setF({ ...f, ox: "0", oy: "0", pad: "1.2", rm: "4", rx: "0" })}>
            {tr("رجّع الافتراضي", "Reset")}
          </button>
        </div>
        <p className="text-sm text-muted">
          {tr(
            "إذا الطباعة نازلة شوي عن الملصق، حرّكها من هون. كل ضغطة = نص ملم. اطبع تجربة، شوف وين نزلت، عدّل، واطبع كمان مرة. بعدين اضغط «حفظ».",
            "If the print lands a little off the sticker, move it here. Each press = half a millimetre. Print a test, see where it landed, adjust, print again. Then press Save.",
          )}
        </p>
        <div className="grid gap-5 md:grid-cols-[1fr_auto]">
          <div className="grid gap-3 sm:grid-cols-2">
            {stepper("ox", "pm-ox", tr("الملصق: يمين / يسار (ملم)", "Label: right / left (mm)"), tr("+ يمين · − يسار", "+ right · − left"), -15, 15)}
            {stepper("oy", "pm-oy", tr("الملصق: تحت / فوق (ملم)", "Label: down / up (mm)"), tr("+ لتحت · − لفوق", "+ down · − up"), -15, 15)}
            {stepper("pad", "pm-pad", tr("هامش جوّا الملصق (ملم)", "Margin inside the label (mm)"), tr("فراغ حوالين الكتابة", "Space around the print"), 0, 8)}
            {stepper("rm", "pm-rm", tr("هامش الفاتورة من الجنبين (ملم)", "Invoice side margin (mm)"), tr("إذا الكتابة مقصوصة من الجنب، زيدها", "Raise it if text is cut at the sides"), 0, 10)}
            {stepper("rx", "pm-rx", tr("الفاتورة: يمين / يسار (ملم)", "Invoice: right / left (mm)"), tr("إذا الفاتورة مزاحة لجنب، حرّكها", "Move it if the invoice sits off to one side"), -15, 15)}
          </div>
          <div className="grid content-start justify-items-center gap-2 rounded-xl bg-sunken p-4">
            <div className="relative overflow-hidden rounded-[6px] border-2 border-dashed border-faint bg-white" style={{ width: `${w * PX}px`, height: `${h * PX}px` }} aria-label={tr("معاينة مكان الطباعة", "Print position preview")}>
              <div
                className="absolute flex flex-col justify-between border border-black text-center text-[9px] leading-tight text-black"
                style={{ left: `${(ox + pad) * PX}px`, top: `${(oy + pad) * PX}px`, width: `${Math.max(4, w - 2 * pad) * PX}px`, height: `${Math.max(4, h - 2 * pad) * PX}px` }}
              >
                <b className="pt-0.5">كرواسان زعتر</b>
                <span>$1.50</span>
                <span className="mx-auto mb-1 h-4 w-3/4 bg-[repeating-linear-gradient(90deg,#000_0_1px,transparent_1px_3px)]" />
              </div>
            </div>
            <span className="text-xs text-faint num ltr">
              {w}×{h} mm · {ox >= 0 ? "+" : ""}
              {ox} / {oy >= 0 ? "+" : ""}
              {oy} mm
            </span>
            <div className="flex flex-wrap justify-center gap-2">
              <button className="btn px-3 py-1 text-sm" onClick={() => test("label")}>
                {tr("جرّب ملصق", "Test label")}
              </button>
              <button className="btn px-3 py-1 text-sm" onClick={() => test("receipt")}>
                {tr("جرّب فاتورة", "Test invoice")}
              </button>
            </div>
          </div>
        </div>
      </section>
      <ThisComputer />
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
        <Field label={tr("رقم الواتساب على الفاتورة", "WhatsApp number on receipts")} htmlFor="pr-wa" hint={tr(`فاضي = رقم المحل${s.business.phone ? ` (${s.business.phone})` : ""}`, `Empty = shop phone${s.business.phone ? ` (${s.business.phone})` : ""}`)}>
          <TextInput id="pr-wa" dir="ltr" inputMode="tel" placeholder="+963 9xx xxx xxx" value={f.wa} onChange={(e) => setF({ ...f, wa: e.target.value })} />
        </Field>
        <Field label={tr("سطر تحت اسم المحل", "Line under the shop name")} htmlFor="pr-so" hint={tr("مثلاً: انستغرام @jjsdeli", "e.g. Instagram @jjsdeli")}>
          <TextInput id="pr-so" dir="auto" value={f.social} onChange={(e) => setF({ ...f, social: e.target.value })} />
        </Field>
        <Check checked={f.qr} onChange={(v) => setF({ ...f, qr: v })}>
          {tr("اطبع كود QR للواتساب آخر الفاتورة", "Print a WhatsApp QR code at the bottom")}
        </Check>
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
