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

export interface LoyaltySettings {
  enabled: boolean;
  /** Buy this many items in a calendar month… */
  buyQty: number;
  /** …and get this many free. */
  freeQty: number;
}
export interface OrderSettings {
  defaultDeliveryFee: number;
  /** When false, only the single best automatic discount applies. */
  allowStacking: boolean;
}
export interface PrintSettings {
  receiptWidthMm: 58 | 80;
  labelWidthMm: number;
  labelHeightMm: number;
  receiptFooterAr: string;
  receiptFooterEn: string;
}
export interface NetworkSettings {
  /** Let phones on the same Wi-Fi open the system (needs a restart). */
  lanAccess: boolean;
}
export interface SyncSettings {
  enabled: boolean;
  supabaseUrl: string;
  serviceKey: string;
}
export interface SyncStatus {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  pushed: number;
}

export interface SettingsShape {
  business: BusinessInfo;
  "currency.default": Currency;
  "fx.config": FxConfig;
  /** Manual USD→SYP rate that overrides the API until cleared */
  "fx.manualRate": number | null;
  "fx.lastCheckedAt": string | null;
  "fx.lastError": string | null;
  loyalty: LoyaltySettings;
  orders: OrderSettings;
  printing: PrintSettings;
  network: NetworkSettings;
  sync: SyncSettings;
  "sync.status": SyncStatus;
}

export const SETTING_DEFAULTS: SettingsShape = {
  business: { nameAr: "JJ's deli shop", nameEn: "JJ's deli shop", phone: "", address: "", logo: "" },
  "currency.default": "USD",
  "fx.config": { apiUrl: "", apiKey: "", jsonPath: "rate" },
  "fx.manualRate": null,
  "fx.lastCheckedAt": null,
  "fx.lastError": null,
  loyalty: { enabled: true, buyQty: 100, freeQty: 5 },
  orders: { defaultDeliveryFee: 0, allowStacking: false },
  printing: { receiptWidthMm: 80, labelWidthMm: 50, labelHeightMm: 30, receiptFooterAr: "شكراً لكم", receiptFooterEn: "Thank you" },
  network: { lanAccess: false },
  sync: { enabled: false, supabaseUrl: "", serviceKey: "" },
  "sync.status": { lastRunAt: null, lastOkAt: null, lastError: null, pushed: 0 },
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
