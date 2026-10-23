import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";

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

const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "Install on this device": puts a JJ's icon on the desktop / home screen that opens the app in its own window. */
export function InstallButton({ className = "" }: { className?: string }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  if (isInstalled() || (!deferred && !isIos())) return null;

  const install = async () => {
    if (!deferred) {
      toast(tr("من Safari: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»", "In Safari: tap Share, then “Add to Home Screen”"));
      return;
    }
    const e = deferred;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null;
    notify();
    if (outcome === "accepted") toast(tr("تم التثبيت — ستجد أيقونة JJ's على سطح المكتب", "Installed — the JJ's icon is on your desktop"));
  };

  return (
    <button type="button" className={`btn ${className}`} onClick={() => void install()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
      </svg>
      {tr("تثبيت التطبيق", "Install app")}
    </button>
  );
}
