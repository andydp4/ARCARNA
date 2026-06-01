import "./instrument";
import { createRoot } from "react-dom/client";
import { Sentry } from "./instrument";
import App from "./App";
import "./index.css";
import { APP_BASE } from "./lib/appPaths";
import { syncService } from "./lib/sync-service";

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
  <Sentry.ErrorBoundary fallback={<p className="p-6 text-center text-sm">Something went wrong. Refresh the page.</p>} showDialog>
    <App />
  </Sentry.ErrorBoundary>,
);
