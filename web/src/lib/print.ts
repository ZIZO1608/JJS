import { get, put } from "./api";

/** Open a print view in its own small window; the view prints itself when ready. */
export function openPrint(path: string) {
  const w = window.open(path, "_blank", "width=460,height=720");
  if (!w) window.location.assign(path); // pop-ups blocked: print in this window
}

/* ------------------------------------------------------------------ */
/* Desktop app: print straight to a printer, no print window           */
/* ------------------------------------------------------------------ */

export interface DesktopPrinter {
  name: string;
  displayName: string;
  isDefault: boolean;
}
interface DesktopApi {
  printers(): Promise<DesktopPrinter[]>;
  print(o: { deviceName: string; widthMm: number; heightMm: number; copies?: number }): Promise<{ ok: boolean; error?: string }>;
}

/** Only the JJ's ERP desktop app has this; a browser returns null and uses the normal print window. */
export const desktop = (): DesktopApi | null => (window as unknown as { jjsDesktop?: DesktopApi }).jjsDesktop ?? null;

/** Labels and receipts can be the same physical printer with two Windows names. */
export type PrintKind = "label" | "receipt";

/** This PC's choice of printers (each PC names its printers differently, so it stays on the PC). */
export interface DevicePrinters {
  label: string;
  receipt: string;
  /** Send straight to the printer instead of opening the print window. */
  direct: boolean;
  /** Labels and receipts share one printer: ask to swap the roll when the job needs the other one. */
  sharedRoll: boolean;
}
const DEVICE_KEY = "jjs.printers";
const DEVICE_DEFAULTS: DevicePrinters = { label: "", receipt: "", direct: true, sharedRoll: true };

export function readDevicePrinters(): DevicePrinters {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    return raw ? { ...DEVICE_DEFAULTS, ...(JSON.parse(raw) as Partial<DevicePrinters>) } : DEVICE_DEFAULTS;
  } catch {
    return DEVICE_DEFAULTS;
  }
}
export function writeDevicePrinters(v: DevicePrinters) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: the choice lasts until the window closes */
  }
}

/** Pick sensible printers the first time: names with "label" / "invoice|receipt", or an XP-236B. */
export function guessDevicePrinters(list: DesktopPrinter[], cur: DevicePrinters): DevicePrinters {
  const find = (re: RegExp) => list.find((p) => re.test(p.name))?.name ?? "";
  const xp = find(/xp-?236|xp-?365|xprinter/i);
  return {
    ...cur,
    label: cur.label || find(/label|ملصق/i) || xp,
    receipt: cur.receipt || find(/invoice|receipt|فاتور|إيصال/i) || xp,
  };
}

/* ------------------------------------------------------------------ */
/* Which roll is in the shared printer (kept on the server for all PCs) */
/* ------------------------------------------------------------------ */

export interface RollState {
  roll: PrintKind;
  changedAt: string | null;
  changedBy: string | null;
}
export const getRoll = () => get<RollState>("/system/printer-roll");
export const setRoll = (roll: PrintKind) => put<RollState>("/system/printer-roll", { roll });
