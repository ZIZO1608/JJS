// Gives the app's pages two printing calls and nothing else: list this PC's printers,
// and print the current page straight to one of them (no print window).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jjsDesktop", {
  printers: () => ipcRenderer.invoke("jjs:printers"),
  print: (opts) => ipcRenderer.invoke("jjs:print", opts),
});
