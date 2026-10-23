// "JJ's ERP Server" — starts the shop: the local server and the database, no window.
// It lives in the system tray. The "JJ's ERP" app (electron/client.cjs) opens the window on it.
const { app, Tray, Menu, nativeImage, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 4310);
// Shared with the "JJ's ERP" app and with the older all-in-one installer, so existing data is kept.
const SHARED_DIR = path.join(app.getPath("appData"), "jjs-erp");
const INFO_FILE = path.join(SHARED_DIR, "server.json");
app.setPath("userData", path.join(app.getPath("appData"), "jjs-erp-server"));
process.env.JJS_DATA_DIR = process.env.JJS_DATA_DIR || path.join(SHARED_DIR, "data");
process.env.JJS_MIGRATIONS_DIR = process.env.JJS_MIGRATIONS_DIR || path.join(ROOT, "drizzle");
process.env.NODE_ENV = "production";

if (!app.requestSingleInstanceLock()) app.quit();

let tray = null;
let shopUrl = `http://127.0.0.1:${PORT}`;

async function alreadyRunning() {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok;
  } catch {
    return false;
  }
}

/** Open the "JJ's ERP" app if it is installed next to us, else the browser. */
function openApp() {
  const candidates = [
    path.join(path.dirname(app.getPath("exe")), "..", "jjs-erp", "JJ's ERP.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "jjs-erp", "JJ's ERP.exe"),
  ];
  const exe = candidates.find((p) => fs.existsSync(p));
  if (exe) spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
  else void shell.openExternal(shopUrl);
}

function buildMenu() {
  const startsWithWindows = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: "JJ's ERP Server — the shop is running", enabled: false },
    { label: shopUrl, enabled: false },
    { type: "separator" },
    { label: "Open JJ's ERP", click: openApp },
    { label: "Open data folder", click: () => void shell.openPath(process.env.JJS_DATA_DIR) },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: startsWithWindows,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        tray.setContextMenu(buildMenu());
      },
    },
    { type: "separator" },
    {
      label: "Stop the shop",
      click: () => {
        const choice = dialog.showMessageBoxSync({
          type: "warning",
          buttons: ["Stop", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          title: "JJ's ERP Server",
          message: "Stop the shop?",
          detail: "JJ's ERP will not work until the server is started again.",
        });
        if (choice === 0) app.quit();
      },
    },
  ]);
}

async function boot() {
  try {
    if (await alreadyRunning()) {
      dialog.showMessageBoxSync({ type: "info", title: "JJ's ERP Server", message: "The shop is already running.", detail: shopUrl });
      return app.quit();
    }
    const { start } = await import(pathToFileURL(path.join(ROOT, "dist", "server", "server", "index.js")).href);
    // No host: the server listens on this PC only, unless the admin turned on phone access in Settings.
    const { url } = await start(PORT);
    shopUrl = url;
    fs.mkdirSync(SHARED_DIR, { recursive: true });
    fs.writeFileSync(INFO_FILE, JSON.stringify({ exe: app.getPath("exe"), url, pid: process.pid }, null, 2));

    const icon = nativeImage.createFromPath(path.join(ROOT, "dist", "web", "favicon.png")).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip("JJ's ERP Server — the shop is running");
    tray.setContextMenu(buildMenu());
    tray.on("double-click", openApp);
    tray.displayBalloon?.({ title: "JJ's ERP Server", content: "The shop is running. Open JJ's ERP to work." });
  } catch (err) {
    dialog.showErrorBox("JJ's ERP Server could not start", String(err && err.stack ? err.stack : err));
    app.quit();
  }
}

app.on("second-instance", () => {
  dialog.showMessageBox({ type: "info", title: "JJ's ERP Server", message: "The shop is already running.", detail: "Look for the JJ's ERP icon next to the clock." });
});
// No windows: keep running until "Stop the shop".
// server.json stays after quitting: "JJ's ERP" reads it to find this exe and start the shop.
app.on("window-all-closed", () => {});
app.whenReady().then(boot);
