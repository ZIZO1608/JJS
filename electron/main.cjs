// Desktop wrapper: starts the local server inside the app and opens it in a window.
// Data lives in the user's app-data folder so reinstalling the app never touches it.
const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
process.env.JJS_DATA_DIR = process.env.JJS_DATA_DIR || path.join(app.getPath("userData"), "data");
process.env.JJS_MIGRATIONS_DIR = process.env.JJS_MIGRATIONS_DIR || path.join(ROOT, "drizzle");
process.env.NODE_ENV = "production";

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

async function boot() {
  try {
    const { start } = await import(pathToFileURL(path.join(ROOT, "dist", "server", "server", "index.js")).href);
    const { url } = await start(Number(process.env.PORT || 4310), "127.0.0.1");
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
      if (target.startsWith(url)) return { action: "allow", overrideBrowserWindowOptions: { width: 480, height: 760, autoHideMenuBar: true, title: "JJ's ERP" } };
      void shell.openExternal(target);
      return { action: "deny" };
    });
    await win.loadURL(url);
  } catch (err) {
    dialog.showErrorBox("JJ's ERP could not start", String(err && err.stack ? err.stack : err));
    app.quit();
  }
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(boot);
app.on("window-all-closed", () => app.quit());
