// Silent printing for the desktop app: the page asks, the main process prints that same page
// to the named printer at the given paper size. Only pages from the shop's own address may ask.
const { ipcMain } = require("electron");
const path = require("node:path");

const PRELOAD = path.join(__dirname, "preload.cjs");

/** webPreferences for every app window, so print views opened with window.open can print too. */
const webPreferences = () => ({ contextIsolation: true, nodeIntegration: false, sandbox: true, preload: PRELOAD });

function registerPrinting(shopUrl) {
  const fromShop = (event) => {
    try {
      return new URL(event.senderFrame.url).origin === new URL(shopUrl).origin;
    } catch {
      return false;
    }
  };

  ipcMain.handle("jjs:printers", async (event) => {
    if (!fromShop(event)) return [];
    const list = await event.sender.getPrintersAsync();
    return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
  });

  ipcMain.handle("jjs:print", async (event, opts) => {
    if (!fromShop(event)) return { ok: false, error: "not allowed" };
    const deviceName = String(opts && opts.deviceName ? opts.deviceName : "");
    const known = (await event.sender.getPrintersAsync()).some((p) => p.name === deviceName);
    if (!known) return { ok: false, error: `Printer not found: ${deviceName}` };
    const mm = (v, lo, hi) => Math.round(Math.min(hi, Math.max(lo, Number(v) || lo)) * 1000);
    const copies = Math.round(Math.min(500, Math.max(1, Number(opts.copies) || 1)));
    return await new Promise((resolve) => {
      event.sender.print(
        {
          silent: true,
          printBackground: true,
          deviceName,
          copies,
          margins: { marginType: "none" },
          // Electron wants microns; Chromium rejects pages under ~10 mm on a side.
          pageSize: { width: mm(opts.widthMm, 20, 300), height: mm(opts.heightMm, 15, 3000) },
        },
        (ok, reason) => resolve(ok ? { ok: true } : { ok: false, error: reason || "print failed" }),
      );
    });
  });
}

module.exports = { registerPrinting, webPreferences };
