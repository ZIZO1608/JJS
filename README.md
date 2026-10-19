# JJ's ERP

Offline-first ERP for JJ's deli shop. Runs on one laptop in the kitchen, works with no internet, Arabic and English.

## Run it

Needs Node.js 20 or newer (22 recommended).

```bash
npm install
npm run dev          # development: server on :4310 + web app on http://localhost:5173
```

Production-style run (one process, the server also serves the built web app):

```bash
npm run build
npm start            # open http://127.0.0.1:4310
```

Desktop app (Electron window, data in the user's app-data folder):

```bash
npm run desktop
npm run dist:win     # Windows installer (.exe) in dist/ — run on Windows
```

> On Windows, if Electron complains about `better-sqlite3`, run `npx electron-builder install-app-deps` once; it rebuilds the database module for Electron.

On first open you will see **Set up JJ's ERP**: enter the business name and create the Admin account. After that, add the manager and members from **Users**.

## Where things are

| Path | What |
| --- | --- |
| `server/` | Local API: Express + SQLite (better-sqlite3) via Drizzle ORM |
| `server/db/schema.ts` | Database tables. After changing it run `npm run db:generate` to create a migration |
| `drizzle/` | SQL migrations, applied automatically on start |
| `shared/permissions.ts` | Modules, actions and the default role matrix, used by server and web |
| `web/` | React + Vite + Tailwind app, all text in `web/src/i18n/ar.json` and `en.json` |
| `electron/main.cjs` | Desktop wrapper |
| `data/` | Created on first run: `jjs.db` and `backups/` (dev and `npm start`) |
| `tests/` | `api-smoke.mjs` (29 API checks) and `ui-walkthrough.py` (browser test) |

## Settings you can change with environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4310` | Local server port |
| `JJS_DATA_DIR` | `./data` | Where the database and backups live |

## Tests

```bash
npm run build
JJS_DATA_DIR=/tmp/jjs-test PORT=4399 npm start &
BASE=http://127.0.0.1:4399 node tests/api-smoke.mjs
```
