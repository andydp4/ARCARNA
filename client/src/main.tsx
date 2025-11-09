import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { syncService } from "./lib/sync-service";

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });
      console.log('[PWA] Service Worker registered successfully:', registration.scope);
      
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA] New content available! Refresh to update.');
            }
          });
        }
      });

      syncService.start();
      console.log('[PWA] Sync service started');
    } catch (error) {
      console.error('[PWA] Service Worker registration failed:', error);
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
