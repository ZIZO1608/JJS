# Deploy online — Coolify on the VPS

The app runs as one Docker container: the API and the web app on port **4310**, with the SQLite database in **`/data`**.
Domain: **https://jjs.ahmad-zaven.io**

## 1. DNS

At the DNS provider for `ahmad-zaven.io`, add an **A record**: name `jjs` → the VPS IP address.
Check it with `nslookup jjs.ahmad-zaven.io` before going on.

## 2. Create the app in Coolify

1. **Projects → + New → Resource → Private Repository (with GitHub App)**. If GitHub is not connected yet, connect it under **Sources**. Pick this repository, branch `main`.
2. **Build Pack:** `Dockerfile`. **Ports Exposes:** `4310`.
3. **Domains:** `https://jjs.ahmad-zaven.io`. Coolify gets the free SSL certificate by itself.
4. **Persistent Storage → + Add → Volume:** name `jjs-data`, destination path `/data`.
   **Do not skip this.** Without it, every redeploy wipes the database.
5. **Environment Variables** (tick "Is Secret" for the password):

   | Name | Example | What it does |
   |---|---|---|
   | `JJS_ADMIN_USERNAME` | `zaven` | First Admin's username (English letters/numbers) |
   | `JJS_ADMIN_PASSWORD` | a strong password, 6+ characters | First Admin's password |
   | `JJS_ADMIN_NAME` | `Zaven` | Name shown in the app |
   | `JJS_BUSINESS_NAME_AR` | `جي جيز ديلي شوب` | Business name in Arabic |
   | `JJS_BUSINESS_NAME_EN` | `JJ's deli shop` | Business name in English |

   These are used **only on the first start**, when the database has no users. Changing them later does nothing; change passwords inside the app.
   Because the Admin is created from these values, a stranger who opens the site first cannot claim the setup page.
6. **Deploy.** When the status turns green (healthy), open https://jjs.ahmad-zaven.io and log in.

Every `git push` to `main` redeploys automatically when the GitHub App is connected. If it doesn't, turn on **Auto Deploy** in the app settings.

## Install on a computer or phone

Open the site in **Chrome or Edge** and click **Install app**. The button is on the login page and in the top bar.
The JJ's icon then appears on the desktop and in the Start menu, and the app opens in its own window.
On iPhone: in Safari, tap **Share → Add to Home Screen**.

## Forgot a password / "username or password is wrong"

Usernames are not case-sensitive. To see who exists and set a new password, open Coolify → the app → **Terminal** and run:

```sh
node scripts/reset-password.mjs                    # lists all users
node scripts/reset-password.mjs zaven NewPass123   # sets a new password and logs that user out everywhere
```

## Backups

The app keeps 30 daily backups in `/data/backups` inside the volume. For copies off the server, use **Settings → Backups → download** in the app, or Coolify's volume backup.

## Moving the laptop's data to the server (optional)

To start online with the data already on the laptop instead of an empty system:

1. On the laptop: in the app, **Settings → Backups → Back up now**. Then take the newest file from `data/backups/`. It's a clean copy, safer than the live `jjs.db`.
2. Copy it to the VPS: `scp jjs-XXXX.db root@<VPS-IP>:/tmp/jjs.db`
3. On the VPS, put it where the app picks it up on its next start (the container name is in Coolify):
   `docker cp /tmp/jjs.db <container-name>:/data/restore.pending.db`
4. In Coolify, click **Restart**. The server swaps it in on startup and keeps the old database as a backup.

The laptop's users and passwords come along. The `JJS_ADMIN_*` variables are ignored then, because users already exist.
