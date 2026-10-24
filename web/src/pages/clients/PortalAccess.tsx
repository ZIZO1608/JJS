import { useState } from "react";
import { Field, Modal, Spinner, TextInput } from "../../components/ui";
import { post, put } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import { waLink } from "../distribution/common";

export interface PortalCredentials {
  username: string;
  password: string;
}
interface PortalAccount {
  username: string;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const portalUrl = () => `${window.location.origin}/portal`;

/** Shown once after a login is made or reset: the password is not kept in readable form. */
export function CredentialsDialog({ credentials, clientName, phone, onClose }: { credentials: PortalCredentials; clientName: string; phone: string; onClose: () => void }) {
  const { tr } = useI18n();
  const toast = useToast();
  const message = tr(
    `أهلاً ${clientName} 👋\nصار فيك تطلب من JJ's وتتابع طلباتك من هاتفك:\n${portalUrl()}\nاسم المستخدم: ${credentials.username}\nكلمة المرور: ${credentials.password}\n(ستُطلب منك كلمة مرور جديدة عند أول دخول)`,
    `Hi ${clientName} 👋\nYou can now order from JJ's and follow your orders from your phone:\n${portalUrl()}\nUsername: ${credentials.username}\nPassword: ${credentials.password}\n(You'll choose your own password on first sign-in)`,
  );
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(tr("تم النسخ", "Copied"));
    } catch {
      toast(tr("تعذّر النسخ، انسخها يدوياً", "Could not copy. Copy it by hand."), "error");
    }
  };
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-sunken px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="truncate font-mono text-lg font-bold ltr text-start">{value}</div>
      </div>
      <button className="btn px-3 py-1.5 text-sm" onClick={() => void copy(value)}>
        {tr("نسخ", "Copy")}
      </button>
    </div>
  );
  return (
    <Modal
      title={tr("دخول الزبون جاهز ✓", "Client login ready ✓")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => void copy(message)}>
            {tr("نسخ الرسالة", "Copy message")}
          </button>
          {phone && (
            <a className="btn" href={waLink(phone, message)} target="_blank" rel="noreferrer">
              {tr("أرسل واتساب", "Send on WhatsApp")}
            </a>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            {tr("تم", "Done")}
          </button>
        </>
      }
    >
      <div className="grid gap-2">
        <Row label={tr("رابط الدخول", "Sign-in link")} value={portalUrl()} />
        <Row label={tr("اسم المستخدم", "Username")} value={credentials.username} />
        <Row label={tr("كلمة المرور", "Password")} value={credentials.password} />
      </div>
      <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
        {tr("كلمة المرور تظهر الآن فقط. أرسلها للزبون قبل الإغلاق — يمكنك إنشاء واحدة جديدة لاحقاً.", "The password is shown only now. Send it to the client before closing — you can make a new one later.")}
      </p>
    </Modal>
  );
}

/** Admin types the username and password (e.g. studyzone / studyzone123) instead of a made-up one. */
function ChooseLoginForm({ initialUsername, busy, onSubmit }: { initialUsername: string; busy: boolean; onSubmit: (body: { username: string; password: string }) => void }) {
  const { tr } = useI18n();
  const [f, setF] = useState({ username: initialUsername, password: "" });
  const okUser = /^[a-zA-Z0-9._-]{3,40}$/.test(f.username.trim());
  return (
    <form
      className="mt-4 grid gap-3 rounded-xl border border-line bg-sunken/40 p-4 text-start sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ username: f.username.trim(), password: f.password });
      }}
    >
      <Field label={tr("اسم المستخدم", "Username")} htmlFor="pl-user" hint={tr("أحرف إنكليزية وأرقام", "English letters and numbers")}>
        <TextInput id="pl-user" dir="ltr" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      </Field>
      <Field label={tr("كلمة المرور", "Password")} htmlFor="pl-pass" hint={tr("6 أحرف على الأقل", "At least 6 characters")}>
        <TextInput id="pl-pass" dir="ltr" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      <button className="btn btn-primary sm:col-span-2" disabled={busy || !okUser || f.password.length < 6}>
        {tr("احفظ الدخول", "Save login")}
      </button>
    </form>
  );
}

/** Client page tab: the client's own login to the ordering portal. */
export function PortalTab({ clientId, clientName, phone }: { clientId: string; clientName: string; phone: string }) {
  const { tr, fmtDate, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useData<{ account: PortalAccount | null }>(`/clients/${clientId}/portal`);
  const [shown, setShown] = useState<PortalCredentials | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const manage = can("clients", "create");
  if (!data) return <Spinner />;
  const a = data.account;

  const run = async (fn: () => Promise<{ credentials?: PortalCredentials }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.credentials) setShown(r.credentials);
      setChoosing(false);
      await reload();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card max-w-xl">
      {a ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-muted">{tr("اسم المستخدم", "Username")}</div>
              <div className="font-mono text-lg font-bold ltr text-start">{a.username}</div>
            </div>
            <span className={`chip ${a.active ? "!bg-good/15 !text-good" : "!bg-bad/15 !text-bad"}`}>{a.active ? tr("مفعّل", "Active") : tr("موقوف", "Stopped")}</span>
          </div>
          <dl className="mt-3 grid gap-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{tr("آخر دخول", "Last sign-in")}</dt>
              <dd>{a.lastLoginAt ? fmtDate(a.lastLoginAt, true) : tr("لم يدخل بعد", "Not yet")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{tr("كلمة المرور", "Password")}</dt>
              <dd>{a.mustChangePassword ? tr("مؤقتة (لم يغيّرها بعد)", "Temporary (not changed yet)") : tr("اختارها الزبون", "Chosen by the client")}</dd>
            </div>
          </dl>
          {manage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn" disabled={busy} onClick={() => void run(() => post(`/clients/${clientId}/portal/reset`))}>
                {tr("كلمة مرور جديدة", "New password")}
              </button>
              <button className="btn" disabled={busy} onClick={() => setChoosing((v) => !v)} aria-expanded={choosing}>
                {tr("اختر اسماً وكلمة مرور", "Set username & password")}
              </button>
              <button className={`btn ${a.active ? "text-bad" : ""}`} disabled={busy} onClick={() => void run(() => put(`/clients/${clientId}/portal`, { active: !a.active }))}>
                {a.active ? tr("إيقاف الدخول", "Stop access") : tr("تفعيل الدخول", "Allow access")}
              </button>
            </div>
          )}
          {manage && choosing && <ChooseLoginForm initialUsername={a.username} busy={busy} onSubmit={(body) => void run(() => post(`/clients/${clientId}/portal/reset`, body))} />}
        </>
      ) : (
        <div className="text-center">
          <div className="text-3xl" aria-hidden>
            📱
          </div>
          <p className="mt-2 font-semibold">{tr("هذا الزبون ليس لديه دخول بعد", "This client has no login yet")}</p>
          <p className="text-sm text-muted">{tr("مع الدخول يطلب من هاتفه وتصلك الطلبات للموافقة.", "With a login they order from their phone and you approve each order.")}</p>
          {manage && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => post(`/clients/${clientId}/portal`))}>
                {tr("أنشئ دخولاً تلقائياً", "Create a login")}
              </button>
              <button className="btn" disabled={busy} onClick={() => setChoosing((v) => !v)} aria-expanded={choosing}>
                {tr("أو اختر الاسم وكلمة المرور", "Or choose them yourself")}
              </button>
            </div>
          )}
          {manage && choosing && <ChooseLoginForm initialUsername="" busy={busy} onSubmit={(body) => void run(() => post(`/clients/${clientId}/portal`, body))} />}
        </div>
      )}
      {shown && <CredentialsDialog credentials={shown} clientName={clientName} phone={phone} onClose={() => setShown(null)} />}
    </div>
  );
}
