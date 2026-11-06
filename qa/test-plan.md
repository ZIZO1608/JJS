# JJ's ERP — pre-handover test plan

Tested on a throwaway copy (own data folder, production build, port 4420) with the sample data, the three env-var logins (admin `jabal`, `manager`, `member`) and one portal client (`qaclient`).

## Roles and workflows

**Admin (jabal)** — everything
- First open with env-var admin (no setup page for strangers), sample data load
- Settings: business, currency + rate (no API key → manual rate), taxes, cash boxes, printing, backups
- Users / roles / audit log
- Full day: production run → orders (walk-in, client, part paid, SYP, % and amount discount) → delivery + money collection → returns → expenses → daily close
- Purchasing, costing, reports + CSV export, money cloud

**Manager** — daily work, no costs, no users/roles/audit/settings
- Orders, deliveries, client requests (accept/decline), daily close (blind count), clients payments, reports without cost data
- Blocked by URL: /users /roles /audit /settings /costing /purchasing /people /assets

**Member** — orders only
- New order, orders list, cancel rules
- Blocked by URL: everything else (/clients /close /menu /warehouse /reports …)

**Portal client (qaclient)**
- Login, new order request, my orders, report a problem, subscription, notifications, account/password
- Cannot reach staff screens or other clients' data

## Checklist sections applied
1. Core workflows — all of the above, both empty system and with data
2. Data and money — totals, discounts (% and amount, > total), SYP/USD, part payments, cancel/return reversal, day boundary (Asia/Damascus), invoice numbers
3. Forms — required fields, negatives, huge numbers, double submit
4. Roles — menu per role, forbidden URLs, forbidden API calls with each role's session, portal IDOR
5. Arabic / English + RTL — every screen in both
6. Mobile — every screen at 390px
7. Errors / empty states — unknown routes, deep links after refresh, API errors
8. Printing / exports — receipt/A4/labels Arabic, CSV with BOM
9. Security & hygiene — secrets in repo/bundle, npm audit, default accounts, sample data, debug output, backups
10. Node/SQLite + POS — DB outside web root, backups, timezone, sessions, rate limit on login
