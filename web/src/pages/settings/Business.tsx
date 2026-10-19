import { useEffect, useRef, useState } from "react";
import { Field, Spinner, TextInput } from "../../components/ui";
import { ApiError, get, put } from "../../lib/api";
import { useAuth, type Business } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";

/** Shrink an uploaded image to max 400px and return a PNG data URL (keeps the database small). */
async function toLogoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 400 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BusinessTab() {
  const { t, err, fieldErrors } = useI18n();
  const { can, refreshBusiness } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<Required<Business> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editable = can("settings", "edit");

  useEffect(() => {
    get<{ business: Required<Business> }>("/settings/public")
      .then((r) => setF(r.business))
      .catch((e) => toast(err(e), "error"));
  }, [toast, err]);

  if (!f) return <Spinner />;

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await put("/settings/business", f);
      await refreshBusiness();
      toast(t("common.saved"));
    } catch (e) {
      if (e instanceof ApiError && e.issues) setErrors(fieldErrors(e));
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card grid max-w-3xl gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("auth.businessAr")} htmlFor="b-ar" error={errors.nameAr}>
          <TextInput id="b-ar" dir="rtl" value={f.nameAr} disabled={!editable} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        </Field>
        <Field label={t("auth.businessEn")} htmlFor="b-en" error={errors.nameEn}>
          <TextInput id="b-en" dir="ltr" value={f.nameEn} disabled={!editable} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
        </Field>
        <Field label={t("business.phone")} htmlFor="b-phone" error={errors.phone}>
          <TextInput id="b-phone" dir="ltr" value={f.phone} disabled={!editable} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label={t("business.address")} htmlFor="b-addr" error={errors.address}>
          <TextInput id="b-addr" value={f.address} disabled={!editable} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
      </div>
      <Field label={t("business.logo")} hint={t("business.logoHint")} error={errors.logo}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-20 w-20 place-items-center rounded-xl border border-line bg-sunken p-2">
            <img src={f.logo || "/logo.png"} alt="" className="max-h-full max-w-full" />
          </div>
          {editable && (
            <>
              <input
                ref={fileRef}
                id="b-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setF({ ...f, logo: await toLogoDataUrl(file) });
                  e.target.value = "";
                }}
              />
              <button className="btn" onClick={() => fileRef.current?.click()}>
                {t("business.upload")}
              </button>
              {f.logo && (
                <button className="btn btn-ghost" onClick={() => setF({ ...f, logo: "" })}>
                  {t("business.remove")}
                </button>
              )}
            </>
          )}
        </div>
      </Field>
      {editable && (
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
}
