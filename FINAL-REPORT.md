# JJ's ERP — delivery report

**Status:** complete system, built and tested. Offline-first, Arabic/English, simple screens for the manager and staff, full screens for the admin. Covers the original brief and JJ's requirements document (wholesale & distribution).

## Tests run before delivery

| Test | What it does | Result |
| --- | --- | --- |
| `tests/api-smoke.mjs` | Login, roles, users, audit, settings, rate, taxes, backups | 29/29 passed |
| `tests/api-full.mjs` | A full business day: production, fridge-first sales, add-ons, tier discount, credit and block, trial → conversion, subscription, loyalty, tax, staff purchase, payments, statement, cancel, purchase + average cost, expense, waste, count, prep list, advance + payroll, rep cash handover, permissions, day close + lock, reports, depreciation | 31/31 passed |
| `tests/api-sync.mjs` | Cloud copy against a fake Supabase: data pushed, secrets and password hashes never sent, only changes re-sent | passed |
| `tests/api-wholesale.mjs` | Price lists, invoice paid in part, client snapshot, cancel with reason, production run (50 + 30) with materials check, recipe waste %, consignment (30 left → 5 back → 25 invoiced), batch tracing, returns (credit / refund, max returnable), tasting/internal use, supplier invoice (no., discount, transport, packs, due date), paying a supplier, price-change radar, due + monthly expenses, delivery cost, owner withdrawal, daily close box flow + rep settlement + made vs sold, all new reports and CSVs, backup restore | 21/21 passed |
| `tests/ui-tour.py` | Opens every screen in a real browser as admin (Arabic and English), manager, member and on a phone; fails on any page error, console error or server error | passed (140 screens) |
| `tests/ui-flows.py` | Real clicks: shop invoice paid 10 of 19 (rest on account checked), morning production run, a return from the client page (credit checked), a manager walk-in sale, counting the box and closing the day | 5/5 passed |

A real restore was also tested: a backup was queued, the server restarted, and the data went back to the backup (the replaced data was kept as a new backup).

## What is in the system

See `README.md` → **What is in it** and **Wholesale & distribution** for the full table, and `docs/GUIDE-AR.md` for the Arabic guide for the shop. Screenshots are in `docs/screens/`.

Main screens: Home (with **Your day in five answers**), Dashboard, Orders + New order (3 steps), Distribution (route sheet, consignment, returns), Daily close, Clients, Production (morning run, runs, trace a batch), Menu, Warehouse & fridge, Purchasing, Costing, Expenses, Assets, People & payroll, Reports, Users, Roles, Audit log, Settings (business, lists, currency, taxes, money, sales rules, price lists, printing, network & cloud, backups). Print views: receipt (80/58 mm or A4), labels with barcode, client statement, day/period report, route sheet.

## Not verified here (needs the real shop)

- **Windows installer:** `npm run dist:win` must run on Windows (it was not built in this Linux workspace). The source runs on Windows with `run-windows.bat`.
- **Printers and scanner:** print views are sized from Settings → Printing and use the normal print dialog. Test once with the real receipt and label printers and adjust the sizes there.
- **Exchange-rate API:** the rate fetcher is configurable (URL, key, JSON path) but was tested with a manual rate only. Point it at your SYP rate API in Settings → Currency.
- **Supabase:** tested against a fake server. With a real project: run `cloud/schema.sql`, then add the URL and service key in Settings → Network & cloud.

## Notes for continuing in VS Code

- `npm install`, then `npm run dev` (server :4310 + web :5173). Open the workspace; recommended extensions are in `.vscode/`.
- Database changes: edit `server/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`, then `npm run cloud:schema`.
- Business rules live in `server/services/` (orders, stock, wholesale, money, clients, reports, sync). Screens are in `web/src/pages/`.
- Run `npm run build && npm test` before every delivery.
- Amounts are stored in their own currency with the rate used and the USD value; reports total in USD and can show SYP at the period's average rate.

## Choices made where JJ's document was silent or cut

- Sections 11, 13 and 17 and the greyed parts were missing from the document. The system was built from the rest and our earlier discussion.
- Returned goods: staff choose **back to fridge** or **waste** on each line. The default is set in Settings → Sales.
- Consignment is set per client. Shops not on consignment get normal invoices, and returns become a credit.
- Cost method: weighted average (simple and stable). Batches are still used oldest-first for expiry.
- Subscriptions and loyalty stay switched on for direct sales.
