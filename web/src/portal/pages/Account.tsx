import { useState, type FormEvent } from "react";
import { Field, TextInput } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { usePortalAuth } from "../auth";

function LangToggle() {
  const { lang } = useI18n();
  const { setLanguage } = usePortalAuth();
  return (
    <div className="inline-flex rounded-full bg-sunken p-1" role="group">
      {(["ar", "en"] as const).map((l) => (
        <button key={l} onClick={() => void setLanguage(l)} aria-pressed={lang === l} className={`rounded-full px-3.5 py-1 text-sm font-semibold ${lang === l ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
          {l === "ar" ? "عربي" : "EN"}
        </button>
      ))}
    </div>
  );
}

export function LoginPage() {
  const { tr, pick, err } = useI18n();
  const { login, business } = usePortalAuth();
  const [f, setF] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(f.username.trim(), f.password);
    } catch (x) {
      setError(x instanceof ApiError && x.code === "wrong_credentials" ? tr("اسم المستخدم أو كلمة المرور غير صحيحة.", "The username or password is wrong.") : err(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="portal flex min-h-full flex-col">
      <div className="portal-hero relative overflow-hidden px-6 pb-16 pt-6 text-white">
        <div className="mx-auto flex max-w-sm justify-end">
          <LangToggle />
        </div>
        <div className="mx-auto mt-6 max-w-sm text-center">
          <img src={business?.logo || "/logo.png"} alt="" className="mx-auto h-20 w-auto rounded-2xl bg-white/95 p-2 shadow-lg" />
          <h1 className="mt-4 text-2xl font-bold">{business ? pick(business) : "JJ's"}</h1>
          <p className="mt-1 text-white/85">{tr("اطلب بسهولة وتابع طلباتك", "Order easily and follow your orders")}</p>
        </div>
      </div>
      <form onSubmit={submit} className="relative z-10 mx-auto -mt-10 w-[calc(100%-2rem)] max-w-sm rounded-3xl bg-surface p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold">{tr("تسجيل الدخول", "Sign in")}</h2>
        <div className="grid gap-3">
          <Field label={tr("اسم المستخدم", "Username")} htmlFor="p-user">
            <TextInput id="p-user" autoComplete="username" autoCapitalize="none" dir="ltr" className="!text-base" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          </Field>
          <Field label={tr("كلمة المرور", "Password")} htmlFor="p-pass" error={error}>
            <TextInput id="p-pass" type="password" autoComplete="current-password" dir="ltr" className="!text-base" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <button className="btn btn-primary mt-2 w-full !py-3 text-base" disabled={busy || !f.username || !f.password}>
            {busy ? "…" : tr("دخول", "Sign in")}
          </button>
        </div>
        <p className="mt-4 text-center text-sm text-faint">{tr("نسيت كلمة المرور؟ تواصل مع المحل.", "Forgot your password? Contact the shop.")}</p>
      </form>
    </div>
  );
}

function PasswordForm({ onDone }: { onDone?: () => void }) {
  const { tr, err } = useI18n();
  const { changePassword } = usePortalAuth();
  const toast = useToast();
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [error, setError] = useState("");
  const mismatch = f.again.length > 0 && f.again !== f.next;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await changePassword(f.current, f.next);
      toast(tr("تم تغيير كلمة المرور", "Password changed"));
      setF({ current: "", next: "", again: "" });
      onDone?.();
    } catch (x) {
      setError(x instanceof ApiError && x.code === "wrong_password" ? tr("كلمة المرور الحالية غير صحيحة.", "The current password is wrong.") : err(x));
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label={tr("كلمة المرور الحالية", "Current password")} htmlFor="cp-cur">
        <TextInput id="cp-cur" type="password" autoComplete="current-password" dir="ltr" className="!text-base" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
      </Field>
      <Field label={tr("كلمة المرور الجديدة", "New password")} htmlFor="cp-new" hint={tr("6 أحرف على الأقل", "At least 6 characters")}>
        <TextInput id="cp-new" type="password" autoComplete="new-password" dir="ltr" className="!text-base" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
      </Field>
      <Field label={tr("أعد كتابتها", "Type it again")} htmlFor="cp-again" error={mismatch ? tr("غير متطابقة", "Does not match") : error}>
        <TextInput id="cp-again" type="password" autoComplete="new-password" dir="ltr" className="!text-base" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
      </Field>
      <button className="btn btn-primary w-full !py-3" disabled={!f.current || f.next.length < 6 || f.next !== f.again}>
        {tr("حفظ", "Save")}
      </button>
    </form>
  );
}

/** On the first login the client picks their own password before anything else. */
export function ChangePasswordPage({ first }: { first?: boolean }) {
  const { tr } = useI18n();
  const { client, logout } = usePortalAuth();
  return (
    <div className="portal mx-auto flex min-h-full max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-5 text-center">
        <div className="text-4xl" aria-hidden>
          🔐
        </div>
        <h1 className="mt-2 text-xl font-bold">{first ? tr(`أهلاً ${client?.name ?? ""}!`, `Welcome ${client?.name ?? ""}!`) : tr("تغيير كلمة المرور", "Change password")}</h1>
        {first && <p className="mt-1 text-muted">{tr("اختر كلمة مرور خاصة بك لتبدأ.", "Choose your own password to get started.")}</p>}
      </div>
      <div className="card rounded-3xl p-5">
        <PasswordForm />
      </div>
      <button className="btn btn-ghost mx-auto mt-4" onClick={() => void logout()}>
        {tr("خروج", "Sign out")}
      </button>
    </div>
  );
}

export function AccountPage() {
  const { tr } = useI18n();
  const { client, logout } = usePortalAuth();
  const [pw, setPw] = useState(false);
  if (!client) return null;
  return (
    <div className="grid gap-4">
      <div className="card flex items-center gap-4 rounded-3xl p-5">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand/15 text-xl font-bold text-brand">{client.name.slice(0, 1)}</span>
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{client.name}</div>
          <div className="text-sm text-faint ltr text-start">@{client.username}</div>
        </div>
      </div>
      <div className="card flex items-center justify-between gap-3 rounded-3xl">
        <span className="font-semibold">{tr("اللغة", "Language")}</span>
        <LangToggle />
      </div>
      <div className="card rounded-3xl">
        <button className="flex w-full items-center justify-between font-semibold" onClick={() => setPw((v) => !v)} aria-expanded={pw}>
          {tr("تغيير كلمة المرور", "Change password")}
          <span className="text-faint" aria-hidden>
            {pw ? "−" : "+"}
          </span>
        </button>
        {pw && (
          <div className="mt-4">
            <PasswordForm onDone={() => setPw(false)} />
          </div>
        )}
      </div>
      <button className="btn w-full !py-3 text-bad" onClick={() => void logout()}>
        {tr("تسجيل الخروج", "Sign out")}
      </button>
    </div>
  );
}
