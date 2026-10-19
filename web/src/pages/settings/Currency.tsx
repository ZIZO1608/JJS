import { useCallback, useEffect, useState } from "react";
import { Field, Spinner, StatusDot, TextInput } from "../../components/ui";
import { get, put, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useI18n, type TKey } from "../../lib/i18n";
import { useToast } from "../../lib/toast";

interface Current {
  rate: number | null;
  source: "api" | "manual" | null;
  updatedAt: string | null;
  manualRate: number | null;
  apiConfigured: boolean;
  lastError: string | null;
}
interface HistoryRow {
  id: string;
  rate: number;
  source: "api" | "manual";
  fetchedAt: string;
}

export function CurrencyTab() {
  const { t, err, fmtDate } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const editable = can("settings", "edit");
  const [cur, setCur] = useState<Current | null>(null);
  const [def, setDef] = useState<"USD" | "SYP">("USD");
  const [manual, setManual] = useState("");
  const [cfg, setCfg] = useState({ apiUrl: "", jsonPath: "rate", apiKey: "", hasApiKey: false });
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, p, conf, h] = await Promise.all([
      get<Current>("/fx/current"),
      get<{ defaultCurrency: "USD" | "SYP" }>("/settings/public"),
      get<{ apiUrl: string; jsonPath: string; hasApiKey: boolean }>("/fx/config"),
      get<{ rates: HistoryRow[] }>("/fx/history"),
    ]);
    setCur(c);
    setDef(p.defaultCurrency);
    setCfg((x) => ({ ...x, ...conf, apiKey: "" }));
    setHistory(h.rates);
    if (c.manualRate) setManual(String(c.manualRate));
  }, []);
  useEffect(() => {
    load().catch((e) => toast(err(e), "error"));
  }, [load, toast, err]);

  const ago = (iso: string | null) => {
    if (!iso) return t("currency.never");
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return t("currency.ago.now");
    if (m < 60) return t("currency.ago.min", { n: m });
    if (m < 60 * 24) return t("currency.ago.hour", { n: Math.round(m / 60) });
    return t("currency.ago.day", { n: Math.round(m / 1440) });
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      toast(t("common.saved"));
    } catch (e) {
      toast(err(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!cur) return <Spinner />;
  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <div className="card">
        <div className="text-sm text-muted">{t("currency.current")}</div>
        <div className="mt-1 text-3xl font-bold num">{cur.rate ? t("currency.perUsd", { rate: cur.rate.toLocaleString("en-US") }) : "—"}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="chip">
            <StatusDot tone={cur.rate ? "good" : "mute"} />
            {t(`currency.source.${cur.source ?? "none"}` as TKey)}
          </span>
          <span>{t("currency.updated", { ago: ago(cur.updatedAt) })}</span>
        </div>
        {cur.lastError && <p className="mt-3 rounded-lg bg-sunken p-3 text-sm text-bad">{t("currency.lastError", { msg: cur.lastError })}</p>}
        {editable && cur.apiConfigured && (
          <button className="btn mt-3" disabled={busy} onClick={() => run(() => post("/fx/refresh"))}>
            {t("currency.refresh")}
          </button>
        )}
      </div>

      <div className="card">
        <Field label={t("currency.default")} hint={t("currency.defaultHint")}>
          <div className="flex gap-2">
            {(["USD", "SYP"] as const).map((c) => (
              <button
                key={c}
                disabled={!editable || busy}
                aria-pressed={def === c}
                onClick={() => run(() => put("/settings/currency", { defaultCurrency: c }))}
                className={`btn flex-1 ${def === c ? "!border-ink" : "text-muted"}`}
              >
                {c === "USD" ? "USD $" : "SYP ل.س"}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="card">
        <h3 className="font-semibold">{t("currency.manualTitle")}</h3>
        <p className="mb-3 text-sm text-muted">{t("currency.manualHint")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <TextInput id="fx-manual" type="number" min={0} step="0.01" dir="ltr" className="num" value={manual} disabled={!editable} onChange={(e) => setManual(e.target.value)} aria-label={t("currency.manualTitle")} />
          </div>
          {editable && (
            <>
              <button className="btn btn-primary" disabled={busy || !(Number(manual) > 0)} onClick={() => run(() => put("/fx/manual", { rate: Number(manual) }))}>
                {t("currency.setManual")}
              </button>
              {cur.manualRate && (
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    setManual("");
                    void run(() => put("/fx/manual", { rate: null }));
                  }}
                >
                  {t("currency.clearManual")}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">{t("currency.apiTitle")}</h3>
        <div className="grid gap-3">
          <Field label={t("currency.apiUrl")} htmlFor="fx-url">
            <TextInput id="fx-url" dir="ltr" placeholder="https://…" value={cfg.apiUrl} disabled={!editable} onChange={(e) => setCfg({ ...cfg, apiUrl: e.target.value })} />
          </Field>
          <Field label={t("currency.jsonPath")} htmlFor="fx-path" hint={t("currency.jsonPathHint")}>
            <TextInput id="fx-path" dir="ltr" value={cfg.jsonPath} disabled={!editable} onChange={(e) => setCfg({ ...cfg, jsonPath: e.target.value })} />
          </Field>
          <Field label={t("currency.apiKey")} htmlFor="fx-key" hint={cfg.hasApiKey ? t("currency.apiKeyKept") : t("common.optional")}>
            <TextInput id="fx-key" type="password" dir="ltr" value={cfg.apiKey} disabled={!editable} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} autoComplete="off" />
          </Field>
          {editable && (
            <button
              className="btn btn-primary w-fit"
              disabled={busy}
              onClick={() => run(() => put("/fx/config", { apiUrl: cfg.apiUrl, jsonPath: cfg.jsonPath, ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}) }))}
            >
              {t("currency.testSave")}
            </button>
          )}
        </div>
      </div>

      <div className="card p-0 lg:col-span-2">
        <h3 className="border-b border-line p-4 font-semibold">{t("currency.history")}</h3>
        {history.length === 0 ? (
          <p className="p-4 text-faint">{t("common.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="td text-muted">{fmtDate(h.fetchedAt, true)}</td>
                    <td className="td ltr num font-semibold">{h.rate.toLocaleString("en-US")} SYP</td>
                    <td className="td">{t(`currency.source.${h.source}` as TKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
