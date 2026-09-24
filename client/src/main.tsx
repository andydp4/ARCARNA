import "./instrument";
import { createRoot } from "react-dom/client";
import { Sentry } from "./instrument";
import { initProductAnalytics } from "./lib/analytics";
import App from "./App";
import "./index.css";

initProductAnalytics();
import { APP_BASE } from "./lib/appPaths";
import { syncService } from "./lib/sync-service";
import { reloadOnceInBrowser } from "./lib/crashReporting";
import { installUsageObservers } from "./lib/usage";

// Our own usage record (v1.2 Phase 8B): every API call is timed at fetch
// itself, so slow and failed calls are caught wherever they come from,
// including the sale. Nothing is kept until a member of staff is signed in.
installUsageObservers();

// Vite fires this when a lazy route's chunk (or its CSS) fails to load — after
// a deploy the old hashed files are gone. Reload once to pick up the new build;
// if that already happened recently, let the error reach the page boundary.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnceInBrowser()) event.preventDefault();
});

async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    const swPath = `${APP_BASE}/sw.js`.replace(/\/{2,}/g, "/");
    const probe = await fetch(swPath, { method: "HEAD", credentials: "same-origin" });
    const contentType = probe.headers.get("content-type") ?? "";
    if (!probe.ok || contentType.includes("text/html")) {
      console.warn(
        "[PWA] /sw.js missing or served as HTML — rebuild deploy so client/public/sw.js is in dist/public",
      );
      syncService.start();
      return;
    }

    const scope = APP_BASE ? `${APP_BASE}/` : "/";
    const registration = await navigator.serviceWorker.register(swPath, { scope });
    console.log("[PWA] Service Worker registered:", registration.scope);

    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            console.log("[PWA] New content available — refresh to update.");
          }
        });
      }
    });

    syncService.start();
    console.log("[PWA] Sync service started");
  } catch (error) {
    console.error("[PWA] Service Worker registration failed:", error);
    syncService.start();
  }
}

window.addEventListener("load", () => {
  void registerServiceWorker();
});

createRoot(document.getElementById("root")!).render(
  // Last resort only (the app's own boundaries report with a reference code).
  // No showDialog: Sentry's dialog asks staff for a name and email we already have.
  <Sentry.ErrorBoundary fallback={<p className="p-6 text-center text-sm">Something went wrong. Refresh the page.</p>}>
    <App />
  </Sentry.ErrorBoundary>,
);
