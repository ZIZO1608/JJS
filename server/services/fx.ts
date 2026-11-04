import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { fxRates } from "../db/schema.js";
import { FX_REFRESH_MS } from "../env.js";
import { getSetting, setSetting, SYRIAN_RATES_URL } from "../lib/settings.js";
import { newId, nowIso } from "../lib/util.js";

export interface CurrentRate {
  /** 1 USD = rate SYP. null when nothing has been fetched or set yet. */
  rate: number | null;
  source: "api" | "manual" | null;
  /** When the shown rate was last confirmed (API check or manual set). */
  updatedAt: string | null;
  manualRate: number | null;
  apiConfigured: boolean;
  lastError: string | null;
}

const latestApiRate = () =>
  db.select().from(fxRates).where(and(eq(fxRates.fromCcy, "USD"), eq(fxRates.toCcy, "SYP"), eq(fxRates.source, "api"))).orderBy(desc(fxRates.fetchedAt)).get();

/** Saved settings first; an install that never saved them gets the Syrian API, with the key from the environment. */
function rateApi() {
  const cfg = getSetting("fx.config");
  const apiUrl = cfg.apiUrl || SYRIAN_RATES_URL;
  const apiKey = cfg.apiKey || process.env.JJS_FX_API_KEY || "";
  // The Syrian API refuses requests without a key, so don't call it until there is one.
  return { apiUrl, apiKey, jsonPath: cfg.apiUrl ? cfg.jsonPath : "rates.sell", ready: apiUrl !== SYRIAN_RATES_URL || !!apiKey };
}

export function getCurrentRate(): CurrentRate {
  const manual = getSetting("fx.manualRate");
  const cfg = rateApi();
  const lastError = getSetting("fx.lastError");
  if (manual && manual > 0) {
    const lastManual = db.select().from(fxRates).where(eq(fxRates.source, "manual")).orderBy(desc(fxRates.fetchedAt)).get();
    return { rate: manual, source: "manual", updatedAt: lastManual?.fetchedAt ?? null, manualRate: manual, apiConfigured: cfg.ready, lastError };
  }
  const api = latestApiRate();
  return {
    rate: api?.rate ?? null,
    source: api ? "api" : null,
    updatedAt: getSetting("fx.lastCheckedAt") ?? api?.fetchedAt ?? null,
    manualRate: null,
    apiConfigured: cfg.ready,
    lastError,
  };
}

const readPath = (obj: unknown, path: string): unknown =>
  path.split(".").filter(Boolean).reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

/** Fetch USD→SYP from the user's own rate API. Keeps the last good rate on any failure. */
export async function refreshRate(): Promise<CurrentRate> {
  const cfg = rateApi();
  if (!cfg.ready) return getCurrentRate();
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
      headers["x-api-key"] = cfg.apiKey;
    }
    const res = await fetch(cfg.apiUrl, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`The rate API answered ${res.status}`);
    const json = (await res.json()) as unknown;
    const value = Number(readPath(json, cfg.jsonPath || "rate"));
    if (!(value > 0)) throw new Error(`No positive number found at "${cfg.jsonPath || "rate"}" in the API response`);
    const last = latestApiRate();
    if (!last || last.rate !== value) {
      db.insert(fxRates).values({ id: newId(), fromCcy: "USD", toCcy: "SYP", rate: value, source: "api" }).run();
    }
    setSetting("fx.lastCheckedAt", nowIso());
    setSetting("fx.lastError", null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setSetting("fx.lastError", msg);
    console.warn("[fx] refresh failed, keeping the last rate:", msg);
  }
  return getCurrentRate();
}

export function setManualRate(rate: number | null) {
  setSetting("fx.manualRate", rate);
  if (rate && rate > 0) db.insert(fxRates).values({ id: newId(), fromCcy: "USD", toCcy: "SYP", rate, source: "manual" }).run();
}

export function startFxScheduler() {
  void refreshRate();
  return setInterval(() => void refreshRate(), FX_REFRESH_MS);
}
