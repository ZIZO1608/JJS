import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { Modal } from "./ui";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// The browser fires this once, often before React has mounted, so keep it at module level.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);

/** Re-renders when the browser offers (or withdraws) its install prompt. */
export function useInstall() {
  const { tr } = useI18n();
  const toast = useToast();
  const [, rerender] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const install = async () => {
    // No prompt from the browser (Safari, Firefox, or Chrome not ready yet): show the steps instead.
    if (!deferred) return setHelp(true);
    const e = deferred;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null;
    notify();
    if (outcome === "accepted") toast(tr("تم التثبيت ✓ ستجد أيقونة JJ's على شاشتك", "Installed ✓ the JJ's icon is on your screen"));
  };
  return { installed: isInstalled(), install, help, closeHelp: () => setHelp(false) };
}

/** Steps for browsers that cannot install with one click. */
export function InstallHelp({ onClose }: { onClose: () => void }) {
  const { tr } = useI18n();
  const ios = isIos();
  const android = isAndroid();
  const steps = ios
    ? [tr("افتح الموقع من متصفح Safari", "Open this site in Safari"), tr("اضغط زر المشاركة ⬆️ في الأسفل", "Tap the Share button ⬆️ at the bottom"), tr("اختر «إضافة إلى الشاشة الرئيسية» ➕", "Choose “Add to Home Screen” ➕"), tr("اضغط «إضافة» — وستظهر أيقونة JJ's", "Tap “Add” — the JJ's icon appears")]
    : android
      ? [tr("افتح الموقع من متصفح Chrome", "Open this site in Chrome"), tr("اضغط القائمة ⋮ أعلى الشاشة", "Tap the ⋮ menu at the top"), tr("اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»", "Choose “Install app” or “Add to Home screen”"), tr("اضغط «تثبيت» — وستظهر أيقونة JJ's", "Tap “Install” — the JJ's icon appears")]
      : [tr("افتح الموقع من Chrome أو Edge", "Open this site in Chrome or Edge"), tr("اضغط أيقونة التثبيت 🖥️⬇ في شريط العنوان، أو القائمة ⋮", "Click the install icon 🖥️⬇ in the address bar, or the ⋮ menu"), tr("اختر «تثبيت JJ's»", "Choose “Install JJ's”"), tr("سيفتح كبرنامج مستقل مع أيقونة على سطح المكتب", "It opens as its own app with a desktop icon")];
  return (
    <Modal
      title={tr("ثبّت التطبيق على جهازك", "Install the app on your device")}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          {tr("تمام", "Got it")}
        </button>
      }
    >
      <p className="mb-3 text-muted">{ios ? "iPhone / iPad" : android ? "Android" : tr("الكمبيوتر", "Computer")}</p>
      <ol className="grid gap-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 rounded-xl bg-sunken/60 p-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
  </svg>
);

/** "Install on this device": puts a JJ's icon on the desktop / home screen that opens the app in its own window. */
export function InstallButton({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { tr } = useI18n();
  const { installed, install, help, closeHelp } = useInstall();
  if (installed) return null;
  const label = tr("تثبيت التطبيق", "Install app");
  return (
    <>
      <button type="button" className={`btn ${className}`} onClick={() => void install()} aria-label={label} title={label}>
        <DownloadIcon />
        {compact ? <span className="hidden sm:inline">{label}</span> : label}
      </button>
      {help && <InstallHelp onClose={closeHelp} />}
    </>
  );
}
