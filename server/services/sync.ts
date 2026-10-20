import { sql } from "drizzle-orm";
import { db, sqlite } from "../db/client.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { localDate } from "../lib/biz.js";
import { nowIso } from "../lib/util.js";
import { dashboard } from "./reports.js";

/**
 * Stage 10 — cloud copy.
 * Every table carries `synced_at`; any insert or edit leaves it NULL. This worker pushes
 * those rows to Supabase (PostgREST upsert) and stamps them. One-way: the laptop is the truth.
 * It also pushes a small daily snapshot that the phone dashboard (cloud/dashboard.html) reads.
 */
export const SYNC_TABLES = [
  "roles", "permissions", "users", "audit_log", "settings", "lookups", "fx_rates", "taxes",
  "categories", "products", "option_groups", "options", "option_group_links",
  "warehouses", "locations", "items", "batches", "stock_moves",
  "suppliers", "purchases", "purchase_lines", "recipes",
  "client_tiers", "clients", "client_moves", "client_prices", "subscription_plans", "subscriptions",
  "cash_boxes", "payment_methods", "box_moves", "business_days", "orders", "order_lines", "payments", "recurring_orders",
  "expenses", "assets", "employees", "advances", "payroll_runs", "payslips", "sales_calls",
] as const;

/** Columns never sent to the cloud. */
const PRIVATE_COLUMNS: Record<string, string[]> = { users: ["password_hash"], settings: [] };
const BATCH = 200;

const keyOf = (table: string) => (table === "settings" ? "key" : "id");

async function upsert(url: string, key: string, table: string, rows: Record<string, unknown>[]) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}?on_conflict=${keyOf(table)}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${table}: cloud answered ${res.status} ${(await res.text()).slice(0, 200)}`);
}

let running = false;

export async function syncNow(): Promise<{ pushed: number; skipped?: string }> {
  const cfg = getSetting("sync");
  if (!cfg.enabled || !cfg.supabaseUrl || !cfg.serviceKey) return { pushed: 0, skipped: "not configured" };
  if (running) return { pushed: 0, skipped: "already running" };
  running = true;
  const status = getSetting("sync.status");
  let pushed = 0;
  try {
    for (const table of SYNC_TABLES) {
      for (;;) {
        const rows = sqlite.prepare(`select * from "${table}" where synced_at is null limit ${BATCH}`).all() as Record<string, unknown>[];
        if (!rows.length) break;
        const hidden = PRIVATE_COLUMNS[table] ?? [];
        // secrets (sync key, rate-API key) never leave the laptop
        const clean = rows
          .filter((r) => !(table === "settings" && /^(sync|fx\.config)/.test(String(r.key))))
          .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hidden.includes(k))));
        const stamp = nowIso();
        if (clean.length) await upsert(cfg.supabaseUrl, cfg.serviceKey, table, clean.map((r) => ({ ...r, synced_at: stamp })));
        const k = keyOf(table);
        const mark = sqlite.prepare(`update "${table}" set synced_at = ? where "${k}" = ?`);
        sqlite.transaction(() => rows.forEach((r) => mark.run(stamp, r[k])))();
        pushed += rows.length;
        if (rows.length < BATCH) break;
      }
    }
    // the phone dashboard reads one JSON row per day
    const snap = dashboard(db);
    await upsert(cfg.supabaseUrl, cfg.serviceKey, "daily_snapshots", [{ date: localDate(), data: snap, updated_at: nowIso() }]);
    setSetting("sync.status", { lastRunAt: nowIso(), lastOkAt: nowIso(), lastError: null, pushed: status.pushed + pushed });
    return { pushed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setSetting("sync.status", { ...status, lastRunAt: nowIso(), lastError: msg, pushed: status.pushed + pushed });
    console.warn("[sync]", msg);
    return { pushed, skipped: msg };
  } finally {
    running = false;
  }
}

export const pendingCount = () =>
  SYNC_TABLES.reduce((s, t) => s + (db.get<{ n: number }>(sql.raw(`select count(*) as n from "${t}" where synced_at is null`))?.n ?? 0), 0);

export function startSyncScheduler() {
  return setInterval(() => void syncNow(), 2 * 60 * 1000);
}
