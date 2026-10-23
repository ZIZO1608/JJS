// "JJ's ERP" — the window to work in. The database and server run in "JJ's ERP Server"
// (electron/server.cjs); if the shop is not started yet, this starts it and waits.
const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 4310);
const URL = `http://127.0.0.1:${PORT}`;
const INFO_FILE = path.join(app.getPath("appData"), "jjs-erp", "server.json");
app.setPath("userData", path.join(app.getPath("appData"), "jjs-erp-client"));

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

async function shopIsUp() {
  try {
    return (await fetch(`${URL}/api/health`)).ok;
  } catch {
    return false;
  }
}

function serverExe() {
  try {
    const exe = JSON.parse(fs.readFileSync(INFO_FILE, "utf8")).exe;
    if (exe && fs.existsSync(exe)) return exe;
  } catch {
    /* not started on this PC yet */
  }
  const fallback = path.join(process.env.LOCALAPPDATA || "", "Programs", "jjs-erp-server", "JJ's ERP Server.exe");
  return fs.existsSync(fallback) ? fallback : null;
}

function waitingPage(title, detail) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>JJ's ERP</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,Tahoma,sans-serif;background:#faf7f2;color:#2b2b2b;text-align:center}
h1{font-size:22px;margin:16px 0 6px}p{margin:4px;color:#666}img{width:72px}</style></head>
<body><div><h1>${title}</h1><p>${detail}</p></div></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

async function openWhenReady() {
  if (!(await shopIsUp())) {
    const exe = serverExe();
    if (exe) {
      spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
      await win.loadURL(waitingPage("Starting the shop…", "يتم تشغيل المحل…"));
    } else {
      await win.loadURL(waitingPage("The shop is not started", "Open “JJ's ERP Server” first — شغّل “JJ's ERP Server” أولاً"));
    }
    while (!(await shopIsUp())) await new Promise((r) => setTimeout(r, 1000));
  }
  await win.loadURL(URL);
}

function boot() {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "JJ's ERP",
    icon: path.join(ROOT, "dist", "web", "logo.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Receipts, labels and statements open in a small window of the app itself;
  // anything else (help links) opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(URL)) return { action: "allow", overrideBrowserWindowOptions: { width: 480, height: 760, autoHideMenuBar: true, title: "JJ's ERP" } };
    void shell.openExternal(target);
    return { action: "deny" };
  });
  void openWhenReady();
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(boot);
app.on("window-all-closed", () => app.quit());
