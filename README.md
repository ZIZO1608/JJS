# JJ's ERP

Offline-first ERP for JJ's deli shop. It runs on one laptop in the kitchen, works with no internet, and speaks Arabic and English. When there is internet it can copy everything to the cloud so the owner can follow the day from a phone.

## Run it

Needs Node.js 20 or newer (22 recommended).

```bash
npm install
npm run dev          # development: server on :4310 + web app on http://localhost:5173
```

One process, the way the shop runs it:

```bash
npm run build
npm start            # open http://127.0.0.1:4310
```

Desktop app (its own window, data kept in the Windows app-data folder):

```bash
npm run desktop
npm run dist:win     # Windows installer (.exe) in dist/ — run this on Windows
```

> On Windows, if Electron complains about `better-sqlite3`, run `npx electron-builder install-app-deps` once. It rebuilds the database module for Electron.

On first open you see **Set up JJ's ERP**: enter the business name and create the Admin account. Then:

1. **Settings → Network & cloud → Load sample data** if you want to try everything with a sample menu, stock, clients and a delivery person (only on an empty menu). Or build the real menu in **Menu**.
2. **Settings → Currency** — set the rate API (or a manual rate) before selling in SYP.
3. **Settings → Money** — set the opening balance of the cash box.
4. **Users** — add the manager and the members. They get the simple screens.

## What is in it

| Module | What it does |
| --- | --- |
| Orders | 3-step order screen (who → items → pay) with big buttons, add-ons like double filling, barcode scanner for product codes, live price check, receipt printing (58/80 mm). Walk-in, client, free trial and staff purchases. Pickup or delivery with the delivery person. Cash, Sham Cash, on credit, deduct from salary — all editable. Cancel puts stock, money and debt back. Standing orders due today show on top. |
| Daily close | Receive cash from the delivery person, count the cash box, see the difference, close the day (locks it), print the day report. Only Admin reopens a day. |
| Clients | Each client has a box (balance): orders on credit charge it, payments and top-ups add to it. Credit limit with optional block. Tiers (e.g. Favourite 10%), special prices, monthly subscriptions with included items, loyalty (buy 100 → 5 free, editable), standing orders by weekday, statement print, analytics. |
| Menu | Categories, products (code, price, shelf life, allergens, photo), add-on groups with min/max and their own recipes, product recipes (ingredients + packaging). |
| Warehouse | Fridges, freezer and store with places inside. Make products (ingredients go out, a dated batch goes into the fridge) and print expiry labels with barcode. Scan a label to find the batch. Waste with reasons, moves, counts, receiving. Sales take from the fridge first (oldest first), the rest is made fresh. |
| Purchasing | Suppliers, purchase invoices into chosen places with expiry, paid now or later, weighted average cost. |
| Costing | Real cost and margin of every product, packaging share, ingredient prices, monthly overheads per item, prep list for tomorrow from standing orders. |
| Expenses | Category + item dropdowns with **+ Add new**, paid from a cash box. |
| Assets | Equipment with price and useful life: monthly depreciation (استهلاك), book value. |
| People | Employees, pay model chosen by the admin (fixed, commission, both: % of delivered sales + $ per converted client), advances (سلف), monthly payroll that settles advances and staff purchases, sales-call log with free trials and follow-ups. |
| Reports | Any date range: sales, discounts, tax, delivery, cost, gross profit, expenses, waste, depreciation, salaries, net; by payment method, product, category, client; trials and conversions; unpaid balances. CSV export (opens in Excel with Arabic). |
| Dashboard | Today, last 7 days, alerts (expired, expires today, low stock, near credit limit, cash with the delivery person), cash boxes, who owes money. |
| Settings | Business, lists, currency and rate API, taxes (% or fixed), cash boxes and payment methods, loyalty and order rules, tiers and subscription plans, printing sizes, LAN access, cloud copy, backups. |
| Users & roles | Admin, Manager, Member plus custom roles with a permission grid. Anyone without **see costs** gets the simple big-button screens. Every change is in the audit log. |

## Money rules

- Two currencies: USD and SYP. Every money row keeps its currency, the rate used (1 USD = x SYP) and the USD value, so reports never change when the rate changes.
- SYP amounts are whole pounds. USD has cents.
- A cash box has one currency; payments in the other currency are converted at that moment's rate.

## The phone dashboard (cloud copy)

1. Create a free Supabase project.
2. Supabase → SQL editor → paste `cloud/schema.sql` → Run. (Regenerate it with `npm run cloud:schema` after changing tables.)
3. In the app: **Settings → Network & cloud** → Supabase URL + `service_role` key → turn on. The laptop pushes changes every 2 minutes and a daily summary. The key never leaves the laptop's database and is never shown again. Password hashes and API keys are never sent.
4. Supabase → Authentication → add the owner's email and password.
5. Put the project URL and the `anon` key at the top of `cloud/dashboard.html` and open it on the phone (or host it anywhere). It can only read the daily summary.

The laptop is always the source of truth; the cloud copy is one-way.

## Using it from a phone in the shop

**Settings → Network & cloud → Allow phones on the same Wi-Fi**, restart the app, then open one of the addresses shown there on the phone. Off by default.

## Where things are

| Path | What |
| --- | --- |
| `server/` | Local API: Express + SQLite (better-sqlite3) through Drizzle ORM |
| `server/db/schema.ts` | Database tables. After changing it run `npm run db:generate` to make a migration |
| `server/services/` | Business rules: orders and pricing, stock (FIFO batches), money boxes, clients, reports, sync |
| `drizzle/` | SQL migrations, applied automatically on start |
| `shared/` | Permissions matrix and money helpers used by server and web |
| `web/` | React + Vite + Tailwind app (RTL/LTR) |
| `electron/main.cjs` | Desktop wrapper |
| `cloud/` | Supabase schema and the phone dashboard |
| `data/` | Created on first run: `jjs.db` and `backups/` (dev and `npm start`) |
| `tests/` | API suites and browser tours |
| `docs/` | Screenshots and API shape notes |

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4310` | Local server port |
| `JJS_DATA_DIR` | `./data` | Where the database and backups live |

## Tests

```bash
npm run build
npm test                         # 3 API suites, each on a throwaway database
# browser tour of every screen (needs Python + Playwright):
JJS_DATA_DIR=/tmp/jjs-tour PORT=4396 npm start &
python3 tests/ui-tour.py http://127.0.0.1:4396 docs/screens
```

`tests/api-full.mjs` walks one full business day: production, fridge-first sales, add-ons, tier discount, credit and the credit-limit block, free trial and conversion, subscriptions, loyalty, taxes, staff purchase, payments and statement, cancel, purchase and average cost, expenses, waste, counts, prep list, advances and payroll, delivery cash handover, manager/member permissions, daily close and lock, reports, depreciation, and sync. `tests/api-sync.mjs` checks the cloud copy against a fake Supabase.

## Backups

Automatic once a day (and **Back up now** in Settings → Backups), last 30 kept, in `data/backups/` (desktop: the app-data folder). To restore, close the app and copy a backup over `jjs.db`.
