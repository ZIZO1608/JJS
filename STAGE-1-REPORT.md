# Stage 1 report: Foundation

**Status:** done and tested. All 29 API checks and the full browser walkthrough pass, with no console errors.

## What was built

| Area | What works |
| --- | --- |
| First run | **Set up JJ's ERP** screen: business name (AR/EN) and the first Admin. Refused once any user exists. |
| Login | Username + password (bcrypt). Stays logged in on this laptop for 30 days. 5 wrong passwords lock that username for 1 minute. |
| Roles & permissions | Admin, Manager, Member seeded. Role builder: create, rename and delete roles, with a modules × actions checkbox grid (view, create, edit, delete, export, see costs). `can()` is enforced on the API (403) and the UI hides what a role cannot use. |
| Safety rules | Admin always keeps every permission. The last active Admin cannot be deactivated or demoted. System roles cannot be deleted, and neither can a role that still has users. A user cannot deactivate themselves. |
| Simple mode | Any role without **see costs** gets the simple screens: top tabs, big buttons, no rate or charts. Admin gets the full sidebar. This is decided by permissions, so a custom role picks the right mode automatically. |
| Users | List with search, sort and paging. Create, edit (password optional), activate and deactivate. A deactivated user is logged out immediately. |
| Audit log | Every create, edit, delete, login, logout, setup and backup is logged with who, when, and the before/after values. Passwords and API keys are never stored. Filters: record, user, action, from/to date. |
| Settings → Business | Name AR/EN, phone, address, logo upload (resized to 400 px and stored in the database). |
| Settings → Lists | One editable list per type: expense items, expense categories, units, payment methods, client tags, waste reasons. Add, rename, hide, reorder, delete (soft delete, so old records keep the name). |
| `LookupSelect` | A reusable dropdown whose last option is **+ Add new**. It opens a small dialog, saves, and selects the new item. The person filling a form may add to that form's list (for example a manager adding an expense item) without full settings rights. |
| Settings → Currency & rate | Main currency (USD/SYP). Rate pulled from your rate API every 30 minutes; the URL, the API key and where the number sits in the JSON reply (`jsonPath`) are configurable. Every fetched rate is stored. If the API fails, the last good rate is kept and the error is shown. A manual rate overrides the API until cleared. Helpers: `getCurrentRate()` (server) and `convert()` (`shared/money.ts`). |
| Settings → Taxes | Taxes are a percentage or a fixed amount, with active on/off. Above 100% is refused. |
| Settings → Backups | An automatic backup once a day (checked at start and every hour), keeping the last 30, plus a **Back up now** button. Safe while the app runs (SQLite online backup). |
| Bilingual | Arabic (RTL) and English (LTR). All text is in `web/src/i18n/ar.json` and `en.json`. Each user's language is saved. Form errors are translated too. |
| Offline | Fonts are bundled, there are no CDN calls, and SQLite is a local file. Only the rate API needs internet. |
| Desktop | `electron/main.cjs` starts the server inside the app and keeps data in the Windows app-data folder. |

## Folder structure

```
server/            Express API
  db/schema.ts     tables (Drizzle)        db/seed.ts  roles + default lists
  lib/             auth, audit, settings, helpers
  routes/          auth, users, roles, audit, settings, lookups, fx, taxes, backups
  services/        fx (rate API), backup
shared/            permissions + money helpers used by server and web
web/src/           React app: pages/, components/, lib/, i18n/
drizzle/           migrations (applied on start)
electron/          desktop wrapper
tests/             api-smoke.mjs, ui-walkthrough.py
```

## Database tables created

`users`, `roles`, `permissions`, `sessions`, `audit_log`, `settings`, `lookups`, `fx_rates`, `taxes`.

Every syncable table has a UUID v7 `id` plus `created_at`, `updated_at`, `deleted_at` and `synced_at`, ready for the cloud sync in Stage 10.

## How to run

See README.md. In short: `npm install`, then `npm run dev`, then open http://localhost:5173.

## Screens (see `docs/stage-1-screens/`)

1. First-run setup
2. Admin home
3. Users
4. Role builder (Manager)
5. Settings, Business
6. Settings, Lists with **+ Add new**
7. Settings, Currency & rate (manual rate active)
8. Settings, Backups
9. Audit log with before/after details
10. Users in English
11. Manager home (simple mode)
12. Member home on a phone-width screen

## Decisions that differ from the spec

- **Look:** the spec asked for orange buttons and the Antonio font. Following your later "simple UI" request, it uses neutral ink-on-white with one font (IBM Plex Sans Arabic), and orange only in the logo.
- **Usernames:** usernames can be 2 characters (so `jj` works), not 3.
- **Simple mode is decided by the "see costs" permission,** not by the role name, so custom roles follow the same rule.
- **Who may use + Add new:** each list belongs to a module, and anyone with *create* on that module may add to it (expense lists → expenses, units and waste reasons → warehouse, client tags → clients, payment methods → settings only).

## Not verified here

- **The rate API itself:** its URL and reply format are unknown. Enter them in Settings → Currency & rate and press **Save and check now**. If the number is nested, set the path (for example `data.usd`).
- **The Windows installer:** `npm run dist:win` was not run, because this was built on Linux. Build it on the Windows laptop, and if Electron reports a `better-sqlite3` version mismatch, run `npx electron-builder install-app-deps` once.

## Suggested Stage 2: Menu

1. Categories (AR/EN, order, active).
2. Products with price, currency, shelf life in hours, photo and active state.
3. Option groups ("Extras", "Remove", "Size") with min/max picks, and options with price changes, attachable to a category or a product.
4. Price lists: special prices per client, ready for Stage 5.
5. Units come from the Lists already built, using `LookupSelect`.
