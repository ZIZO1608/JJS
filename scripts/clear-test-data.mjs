// Remove the test records before the shop starts for real.
//
// KEEPS: logins, roles & permissions, settings (business info, receipt, printer), lists,
//        menu (categories, products, options, recipes, price lists), stock items & warehouses,
//        clients (+ their portal logins, special prices, standing orders), suppliers, employees,
//        cash boxes & payment methods, taxes, assets, monthly expenses, exchange rates.
// REMOVES: orders, payments, money in boxes, client balances, stock quantities & batches,
//        purchases, expenses, returns, consignments, production, payroll & advances,
//        subscriptions, sales calls, portal requests, notifications, business days, audit log.
//        Order / invoice numbers start again from 1.
//
//   node scripts/clear-test-data.mjs          → shows what would be removed (changes nothing)
//   node scripts/clear-test-data.mjs --yes    → does it
//   node scripts/clear-test-data.mjs --yes path/to/backup.db → cleans that file instead
//
// Live database: it never touches the open file. It writes a cleaned copy as restore.pending.db;
// restart the app (or "Restart" in Coolify) and it is swapped in, and the old database is kept in
// backups/ as "...-before-restore.db", so this can be undone with Settings → Backups → Restore.
// On the server: open the container terminal in Coolify and run it from /app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const WIPE = [
  "order_lines", "orders", "payments", "order_requests", "order_reports",
  "box_moves", "client_moves", "subscriptions", "subscription_requests",
  "stock_moves", "batches", "purchase_lines", "purchases", "price_changes",
  "production_runs", "consignment_lines", "consignments", "return_lines", "returns",
  "expenses", "advances", "payslips", "payroll_runs", "sales_calls",
  "notifications", "business_days", "audit_log",
];

const args = process.argv.slice(2);
const doIt = args.includes("--yes");
const fileArg = args.find((a) => !a.startsWith("--"));
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.JJS_DATA_DIR ?? path.join(root, "data");
const livePath = path.join(dataDir, "jjs.db");
const source = fileArg ? path.resolve(fileArg) : livePath;
if (!fs.existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(1);
}

const tablesIn = (db) => new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((r) => r.name));
const counts = (db) => {
  const have = tablesIn(db);
  return WIPE.filter((t) => have.has(t)).map((t) => [t, db.prepare(`select count(*) as n from "${t}"`).get().n]);
};

{
  const db = new Database(source, { readonly: true });
  const users = db.prepare("select username from users where deleted_at is null").all().map((u) => u.username);
  const keep = ["products", "items", "clients", "suppliers", "employees"].map((t) => `${t} ${db.prepare(`select count(*) as n from "${t}" where deleted_at is null`).get().n}`);
  console.log(`Database: ${source}`);
  console.log(`Kept: logins (${users.join(", ")}), ${keep.join(", ")}, settings and printer.`);
  console.log("To remove:");
  for (const [t, n] of counts(db)) if (n) console.log(`  ${t.padEnd(22)} ${n}`);
  db.close();
}
if (!doIt) {
  console.log("\nNothing changed. Run again with --yes to remove them.");
  process.exit(0);
}

// Work on a copy: the live file stays untouched while the app is running.
const target = fileArg ? source : path.join(dataDir, "restore.pending.db");
if (fileArg) {
  const before = source.replace(/\.db$/i, "") + "-before-clear.db";
  fs.copyFileSync(source, before);
  console.log(`\nCopy of the original kept at ${before}`);
} else {
  const live = new Database(livePath, { readonly: true });
  await live.backup(target);
  live.close();
}

const db = new Database(target);
db.pragma("foreign_keys = OFF");
const have = tablesIn(db);
const now = new Date().toISOString();
db.transaction(() => {
  for (const t of WIPE) if (have.has(t)) db.prepare(`delete from "${t}"`).run();
  // History that pointed at removed records.
  db.prepare("update clients set converted_at = null, updated_at = ?, synced_at = null where converted_at is not null").run(now);
  db.prepare("update suppliers set opening_paid_usd = 0, updated_at = ?, synced_at = null where opening_paid_usd <> 0").run(now);
  db.prepare("delete from settings where key = 'sync.status'").run();
})();
const broken = db.prepare("pragma foreign_key_check").all();
if (broken.length) {
  console.error("Stopped: some kept records still point at removed ones:", broken.slice(0, 10));
  db.close();
  if (!fileArg) fs.rmSync(target);
  process.exit(1);
}
db.pragma("journal_mode = DELETE");
db.exec("vacuum");
db.close();

if (fileArg) {
  console.log(`Cleaned ${target}. Load it with Settings → Backups → Restore.`);
} else {
  console.log(`\nCleaned copy ready. Restart the app now (Coolify: Restart) to switch to it.`);
  console.log(`The current database will be kept in ${path.join(dataDir, "backups")} as ...-before-restore.db.`);
}
