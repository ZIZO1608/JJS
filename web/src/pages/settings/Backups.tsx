import { useCallback, useEffect, useState } from "react";
import { Empty, Modal, Spinner } from "../../components/ui";
import { get, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";

interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

const size = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function BackupsTab() {
  const { t, err, fmtDate, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<{ folder: string; backups: BackupFile[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [restore, setRestore] = useState<BackupFile | null>(null);

  const load = useCallback(async () => {
    setData(await get("/backups"));
    setPending((await get<{ pending: boolean }>("/backups/restore")).pending);
  }, []);
  const doRestore = async () => {
    if (!restore) return;
    try {
      await post("/backups/restore", { name: restore.name });
      setRestore(null);
      await load();
    } catch (e) {
      toast(err(e), "error");
    }
  };
  const cancelRestore = async () => {
    try {
      await post("/backups/restore/cancel");
      await load();
    } catch (e) {
      toast(err(e), "error");
    }
  };
  useEffect(() => {
    load().catch((e) => toast(err(e), "error"));
  }, [load, toast, err]);

  const now = async () => {
    setBusy(true);
    try {
      await post("/backups");
      toast(t("backups.done"));
      await load();
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Spinner />;
  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-muted">{t("backups.subtitle")}</p>
        {can("settings", "edit") && (
          <button className="btn btn-primary" onClick={now} disabled={busy}>
            {busy ? t("common.saving") : t("backups.now")}
          </button>
        )}
      </div>
      {pending && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn bg-warn/10 p-3 text-sm">
          <span>{tr("في نسخة جاهزة للاسترجاع. سكّر البرنامج وافتحه مرة تانية لتنطبق.", "A backup is waiting to be restored. Close the app and open it again to apply it.")}</span>
          {can("settings", "edit") && (
            <button className="btn px-3 py-1 text-sm" onClick={cancelRestore}>
              {tr("إلغاء الاسترجاع", "Cancel restore")}
            </button>
          )}
        </div>
      )}
      <p className="mb-3 text-sm text-muted">
        {t("backups.folder")}: <span className="ltr select-all rounded bg-sunken px-1.5 py-0.5 text-ink">{data.folder}</span>
      </p>
      {data.backups.length === 0 ? (
        <Empty text={t("common.none")} />
      ) : (
        <div className="card p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th">{t("backups.date")}</th>
                <th className="th">{t("backups.file")}</th>
                <th className="th text-end">{t("backups.size")}</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {data.backups.map((b) => (
                <tr key={b.name}>
                  <td className="td">{fmtDate(b.createdAt, true)}</td>
                  <td className="td ltr text-muted">{b.name}</td>
                  <td className="td text-end ltr num">{size(b.sizeBytes)}</td>
                  <td className="td text-end">
                    {can("settings", "edit") && (
                      <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setRestore(b)}>
                        {tr("استرجاع", "Restore")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {restore && (
        <Modal
          title={tr("استرجاع هالنسخة؟", "Restore this backup?")}
          onClose={() => setRestore(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRestore(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" onClick={doRestore}>
                {tr("استرجاع", "Restore")}
              </button>
            </>
          }
        >
          <p className="text-sm">
            {tr(`البيانات رح ترجع متل ما كانت بـ ${fmtDate(restore.createdAt, true)}. الاسترجاع بينطبق لما تسكّر البرنامج وتفتحه، والبيانات الحالية بتنحفظ كنسخة احتياطية لحتى تقدر ترجعلها.`, `The data will go back to how it was on ${fmtDate(restore.createdAt, true)}. It applies when you close and reopen the app; the current data is kept as a backup so you can go back to it.`)}
          </p>
        </Modal>
      )}
    </div>
  );
}
