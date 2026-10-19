import { eq } from "drizzle-orm";
import { db, type Tx } from "../db/client.js";
import { settings } from "../db/schema.js";
import { nowIso } from "./util.js";

export type Currency = "USD" | "SYP";

export interface BusinessInfo {
  nameAr: string;
  nameEn: string;
  phone: string;
  address: string;
  /** data: URL of the logo, or empty */
  logo: string;
}

export interface FxConfig {
  apiUrl: string;
  apiKey: string;
  /** Dot path to the USD→SYP number in the API's JSON, e.g. "rate" or "data.usd.sell" */
  jsonPath: string;
}

export interface SettingsShape {
  business: BusinessInfo;
  "currency.default": Currency;
  "fx.config": FxConfig;
  /** Manual USD→SYP rate that overrides the API until cleared */
  "fx.manualRate": number | null;
  "fx.lastCheckedAt": string | null;
  "fx.lastError": string | null;
}

export const SETTING_DEFAULTS: SettingsShape = {
  business: { nameAr: "JJ's deli shop", nameEn: "JJ's deli shop", phone: "", address: "", logo: "" },
  "currency.default": "USD",
  "fx.config": { apiUrl: "", apiKey: "", jsonPath: "rate" },
  "fx.manualRate": null,
  "fx.lastCheckedAt": null,
  "fx.lastError": null,
};

export function getSetting<K extends keyof SettingsShape>(key: K): SettingsShape[K] {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return SETTING_DEFAULTS[key];
  try {
    return JSON.parse(row.value) as SettingsShape[K];
  } catch {
    return SETTING_DEFAULTS[key];
  }
}

export function setSetting<K extends keyof SettingsShape>(key: K, value: SettingsShape[K], tx: Tx | typeof db = db) {
  const json = JSON.stringify(value);
  tx.insert(settings)
    .values({ key, value: json, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: nowIso(), syncedAt: null } })
    .run();
}
