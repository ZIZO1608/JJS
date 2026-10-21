import { useEffect, useState } from "react";
import { Field, Modal, Spinner, TextInput } from "../../components/ui";
import { post, put } from "../../lib/api";
import { useAppSettings } from "../../lib/appSettings";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { useData } from "../../lib/useData";
import { Check, useSaver } from "../kit";

interface NetworkInfo {
  lanAccess: boolean;
  addresses: string[];
  port: number;
  dataDir: string;
  listeningOnLan: boolean;
}
interface SyncInfo {
  enabled: boolean;
  supabaseUrl: string;
  hasKey: boolean;
  status: { lastRunAt: string | null; lastOkAt: string | null; lastError: string | null; pushed: number };
  pending: number;
}

export function NetworkTab() {
  const { tr, fmtDate, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { reload } = useAppSettings();
  const net = useData<NetworkInfo>("/system/network");
  const sync = useData<SyncInfo>("/system/sync");
  const lan = useSaver();
  const cloud = useSaver();
  const [lanOn, setLanOn] = useState(false);
  const [c, setC] = useState({ enabled: false, supabaseUrl: "", serviceKey: "" });
  const [running, setRunning] = useState(false);
  const [demo, setDemo] = useState(false);
  const edit = can("settings", "edit");
  useEffect(() => {
    if (net.data) setLanOn(net.data.lanAccess);
  }, [net.data]);
  useEffect(() => {
    if (sync.data) setC({ enabled: sync.data.enabled, supabaseUrl: sync.data.supabaseUrl, serviceKey: "" });
  }, [sync.data]);
  if (!net.data || !sync.data) return <Spinner />;

  const runSync = async () => {
    setRunning(true);
    try {
      const r = await post<{ pushed: number; skipped?: string }>("/system/sync/run");
      toast(r.skipped ? `${tr("ما تمّت المزامنة", "Not synced")}: ${r.skipped}` : tr(`انبعت ${r.pushed} سطر`, `${r.pushed} rows sent`), r.skipped ? "error" : "ok");
      void sync.reload();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setRunning(false);
    }
  };
  const loadDemo = async () => {
    setDemo(false);
    try {
      const r = await post<{ loaded: boolean }>("/system/demo-data");
      toast(r.loaded ? tr("انحمّلت البيانات التجريبية", "Sample data loaded") : tr("القائمة مو فاضية، ما انحمّل شي", "The menu is not empty, nothing loaded"), r.loaded ? "ok" : "error");
      await reload();
    } catch (e) {
      toast(err(e), "error");
    }
  };

  return (
    <div className="grid max-w-3xl gap-5">
      <section className="card grid gap-3">
        <h2 className="text-lg font-bold">{tr("الهواتف على نفس الواي فاي", "Phones on the same Wi-Fi")}</h2>
        <p className="text-sm text-muted">{tr("بتخلي المدير يفتح النظام من موبايله داخل المحل. بيلزم تسكير البرنامج وفتحه بعد التغيير.", "Lets the manager open the system from a phone inside the shop. Close and reopen the app after changing it.")}</p>
        <Check checked={lanOn} onChange={setLanOn} disabled={!edit}>
          {tr("السماح للهواتف", "Allow phones")}
        </Check>
        {net.data.listeningOnLan && (
          <div className="text-sm">
            {tr("افتح على الموبايل:", "Open on the phone:")}
            <ul className="mt-1 grid gap-1">
              {net.data.addresses.map((a) => (
                <li key={a} className="ltr select-all font-semibold">
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}
        {lanOn !== net.data.lanAccess && <p className="text-sm text-warn">{tr("بعد الحفظ سكّر البرنامج وافتحه.", "After saving, close and reopen the app.")}</p>}
        {edit && (
          <button className="btn btn-primary w-fit" disabled={lan.busy || lanOn === net.data.lanAccess} onClick={async () => (await lan.run(() => put("/system/network", { lanAccess: lanOn }))) && void net.reload()}>
            {tr("حفظ", "Save")}
          </button>
        )}
        <p className="text-xs text-faint">
          {tr("مجلد البيانات:", "Data folder:")} <span className="ltr select-all">{net.data.dataDir}</span>
        </p>
      </section>

      <section className="card grid gap-3">
        <h2 className="text-lg font-bold">{tr("نسخة على السحابة (لوحة الهاتف)", "Cloud copy (phone dashboard)")}</h2>
        <p className="text-sm text-muted">{tr("اللابتوب بيبعت نسخة لـ Supabase كل دقيقتين لما يكون في إنترنت. المفتاح بيضل على اللابتوب وما بينعرض مرة تانية.", "The laptop sends a copy to Supabase every 2 minutes when online. The key stays on the laptop and is never shown again.")}</p>
        <Check checked={c.enabled} onChange={(v) => setC({ ...c, enabled: v })} disabled={!edit}>
          {tr("مفعّلة", "On")}
        </Check>
        <Field label="Supabase URL" htmlFor="sy-u">
          <TextInput id="sy-u" dir="ltr" placeholder="https://xxxx.supabase.co" value={c.supabaseUrl} onChange={(e) => setC({ ...c, supabaseUrl: e.target.value })} disabled={!edit} />
        </Field>
        <Field label="service_role key" htmlFor="sy-k" hint={sync.data.hasKey ? tr("محفوظ. اتركه فاضي لتخليه متل ما هو.", "Saved. Leave empty to keep it.") : undefined}>
          <TextInput id="sy-k" dir="ltr" type="password" autoComplete="off" value={c.serviceKey} placeholder={sync.data.hasKey ? "••••••••" : ""} onChange={(e) => setC({ ...c, serviceKey: e.target.value })} disabled={!edit} />
        </Field>
        <div className="grid gap-1 rounded-lg bg-sunken p-3 text-sm">
          <div>
            {tr("بانتظار الإرسال:", "Waiting to send:")} <b className="num ltr">{sync.data.pending}</b>
          </div>
          <div>
            {tr("آخر نجاح:", "Last success:")} {sync.data.status.lastOkAt ? fmtDate(sync.data.status.lastOkAt, true) : "—"}
          </div>
          {sync.data.status.lastError && <div className="text-bad">{sync.data.status.lastError}</div>}
        </div>
        {edit && (
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              disabled={cloud.busy}
              onClick={async () => (await cloud.run(() => put("/system/sync", { enabled: c.enabled, supabaseUrl: c.supabaseUrl.trim(), ...(c.serviceKey ? { serviceKey: c.serviceKey } : {}) }))) && void sync.reload()}
            >
              {tr("حفظ", "Save")}
            </button>
            <button className="btn" onClick={runSync} disabled={running || !sync.data.enabled}>
              {running ? "…" : tr("زامن الآن", "Sync now")}
            </button>
          </div>
        )}
      </section>

      {edit && (
        <section className="card grid gap-3">
          <h2 className="text-lg font-bold">{tr("بيانات تجريبية", "Sample data")}</h2>
          <p className="text-sm text-muted">{tr("منيو، مواد، زبائن، مورّدين، قوائم أسعار ومندوب للتجربة. بتشتغل بس إذا القائمة فاضية، وفيك تعدّلها أو تحذفها بعدين.", "A menu, stock, clients, suppliers, price lists and a rep to try things with. Works only on an empty menu; edit or delete it later.")}</p>
          <button className="btn w-fit" onClick={() => setDemo(true)}>
            {tr("تحميل بيانات تجريبية", "Load sample data")}
          </button>
        </section>
      )}
      {demo && (
        <Modal
          title={tr("تحميل البيانات التجريبية؟", "Load sample data?")}
          onClose={() => setDemo(false)}
          footer={
            <>
              <button className="btn" onClick={() => setDemo(false)}>
                {tr("إلغاء", "Cancel")}
              </button>
              <button className="btn btn-primary" onClick={loadDemo}>
                {tr("تحميل", "Load")}
              </button>
            </>
          }
        >
          <p className="text-sm">{tr("رح تنضاف أصناف ومواد وزبائن تجريبية لهالنظام.", "Sample products, stock and clients will be added to this system.")}</p>
        </Modal>
      )}
    </div>
  );
}
