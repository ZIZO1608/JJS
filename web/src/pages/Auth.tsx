import { useState, type FormEvent, type ReactNode } from "react";
import { Field, TextInput } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n, type Lang } from "../lib/i18n";

function Shell({ children }: { children: ReactNode }) {
  const { lang, setLang, fieldErrors } = useI18n();
  const { business } = useAuth();
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <img src={business?.logo || "/logo.png"} alt="JJ's" className="h-12 w-auto" />
          <div className="inline-flex rounded-lg bg-sunken p-0.5">
            {(["ar", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={`rounded-md px-2.5 py-1 text-sm font-semibold ${lang === l ? "bg-surface shadow-sm" : "text-muted"}`}
              >
                {l === "ar" ? "عربي" : "EN"}
              </button>
            ))}
          </div>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </div>
  );
}

export function SetupPage() {
  const { t, lang, err, fieldErrors } = useI18n();
  const { setup } = useAuth();
  const [f, setF] = useState({ businessNameAr: "جي جيز ديلي شوب", businessNameEn: "JJ's deli shop", name: "", username: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError("");
    try {
      await setup({ ...f, language: lang });
    } catch (ex) {
      if (ex instanceof ApiError && ex.issues) setErrors(fieldErrors(ex));
      setFormError(err(ex));
    } finally {
      setBusy(false);
    }
  };
  const bind = (k: keyof typeof f) => ({ id: `setup-${k}`, value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });

  return (
    <Shell>
      <h1 className="text-xl font-bold">{t("auth.setupTitle")}</h1>
      <p className="mb-5 mt-1 text-muted">{t("auth.setupBody")}</p>
      <form className="grid gap-3" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("auth.businessAr")} htmlFor="setup-businessNameAr" error={errors.businessNameAr}>
            <TextInput {...bind("businessNameAr")} dir="rtl" required />
          </Field>
          <Field label={t("auth.businessEn")} htmlFor="setup-businessNameEn" error={errors.businessNameEn}>
            <TextInput {...bind("businessNameEn")} dir="ltr" required />
          </Field>
        </div>
        <Field label={t("auth.adminName")} htmlFor="setup-name" error={errors.name}>
          <TextInput {...bind("name")} required autoComplete="name" />
        </Field>
        <Field label={t("auth.username")} htmlFor="setup-username" error={errors.username} hint={t("auth.usernameHint")}>
          <TextInput {...bind("username")} dir="ltr" required autoComplete="username" />
        </Field>
        <Field label={t("auth.password")} htmlFor="setup-password" error={errors.password} hint={t("auth.passwordHint")}>
          <TextInput {...bind("password")} type="password" dir="ltr" required minLength={6} autoComplete="new-password" />
        </Field>
        {formError && <p className="text-sm text-bad">{formError}</p>}
        <button className="btn btn-primary mt-2 py-3" disabled={busy}>
          {busy ? t("common.saving") : t("auth.createAdmin")}
        </button>
      </form>
    </Shell>
  );
}

export function LoginPage() {
  const { t, err, fieldErrors } = useI18n();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
    } catch (ex) {
      setError(err(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <h1 className="mb-5 text-xl font-bold">{t("auth.loginTitle")}</h1>
      <form className="grid gap-3" onSubmit={submit}>
        <Field label={t("auth.username")} htmlFor="login-user">
          <TextInput id="login-user" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </Field>
        <Field label={t("auth.password")} htmlFor="login-pass">
          <TextInput id="login-pass" type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button className="btn btn-primary mt-2 py-3 text-base" disabled={busy}>
          {busy ? t("app.loading") : t("auth.login")}
        </button>
      </form>
    </Shell>
  );
}
