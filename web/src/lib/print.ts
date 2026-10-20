/** Open a print view in its own small window; the view prints itself when ready. */
export function openPrint(path: string) {
  const w = window.open(path, "_blank", "width=460,height=720");
  if (!w) window.location.assign(path); // pop-ups blocked: print in this window
}
