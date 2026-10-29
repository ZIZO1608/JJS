import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled so the app looks right with no internet.
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "./styles.css";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { I18nProvider } from "./lib/i18n";
import { ToastProvider } from "./lib/toast";

// The client portal is its own download: staff never fetch it, clients never fetch the staff screens.
const PortalApp = lazy(() => import("./portal/PortalApp").then((m) => ({ default: m.PortalApp })));

// Clients use the same address under /portal: their own login, screens and home-screen icon.
const isPortal = window.location.pathname === "/portal" || window.location.pathname.startsWith("/portal/");
if (isPortal) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#d2561a");
  document.title = "JJ's";
}

// After an update the old screen files are gone: reload once to get the new ones instead of showing an error.
window.addEventListener("vite:preloadError", (e) => {
  try {
    const last = Number(sessionStorage.getItem("jjs:reloaded") ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem("jjs:reloaded", String(Date.now()));
  } catch {
    /* storage blocked: still reload */
  }
  e.preventDefault();
  window.location.reload();
});

// Lets the browser install the app (desktop / home-screen icon). Not in dev: Vite serves fresh files.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider raised={isPortal}>
        {isPortal ? (
          <Suspense fallback={null}>
            <PortalApp />
          </Suspense>
        ) : (
          <AuthProvider>
            <App />
          </AuthProvider>
        )}
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
