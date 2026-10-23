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
5. **Environment Variables**: one login for each role. Tick "Is Secret" for the passwords.

   ```
   JJS_ADMIN_USERNAME=zaven
   JJS_ADMIN_PASSWORD=<strong password>
   JJS_ADMIN_NAME=Zaven

   JJS_MANAGER_USERNAME=rami
   JJS_MANAGER_PASSWORD=<strong password>
   JJS_MANAGER_NAME=رامي

   JJS_MEMBER_USERNAME=sami
   JJS_MEMBER_PASSWORD=<strong password>
   JJS_MEMBER_NAME=سامي

   JJS_BUSINESS_NAME_AR=جي جيز ديلي شوب
   JJS_BUSINESS_NAME_EN=JJ's deli shop
   ```

   | Role | Can do |
   |---|---|
   | **Admin** | Everything, including users, roles, audit and settings |
   | **Manager** | Daily work and reports, but not users, roles or audit |
   | **Member** | Daily work only (orders, production, stock…) |

   Rules:
   - Usernames: 2–30 English letters, numbers, `.` `-` `_`, all different. Capital and small letters are the same.
   - Passwords: 6+ characters. Bad values stop the server with a clear message in the Coolify logs.
   - A user is created only if that username doesn't exist yet. **Changing a password here later does nothing.** Change it inside the app (Users page, or the user menu → Change password) or with the reset command below.
   - Leave a role's variables out to skip that role.
   - The Admin is created from these values, so a stranger who opens the site first cannot claim the setup page.
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
