import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { syncService } from "./lib/sync-service";

async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    const probe = await fetch("/sw.js", { method: "HEAD", credentials: "same-origin" });
    const contentType = probe.headers.get("content-type") ?? "";
    if (!probe.ok || contentType.includes("text/html")) {
      console.warn(
        "[PWA] /sw.js missing or served as HTML — rebuild deploy so client/public/sw.js is in dist/public",
      );
      syncService.start();
      return;
    }

    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
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

createRoot(document.getElementById("root")!).render(<App />);
