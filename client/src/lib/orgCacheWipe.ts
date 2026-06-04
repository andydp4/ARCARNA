import { resolveAppPath } from "@/lib/appPaths";
import { LEGACY_OFFLINE_DB_NAME, offlineDbNameForOrg } from "@/lib/offline-storage";

export async function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

async function postToServiceWorker(message: unknown): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage(message);
}

export async function clearServiceWorkerOrgCache(orgId: string): Promise<void> {
  await postToServiceWorker({ type: "CLEAR_ORG_CACHE", orgId });
}

export async function clearServiceWorkerAllCaches(): Promise<void> {
  await postToServiceWorker({ type: "CLEAR_ALL_CACHES" });
}

/** Remove IndexedDB + SW API cache for one tenant (org switch away). */
export async function wipeOrgOfflineData(orgId: string): Promise<void> {
  await Promise.all([
    deleteIndexedDb(offlineDbNameForOrg(orgId)),
    clearServiceWorkerOrgCache(orgId),
  ]);
}

/** Logout / session end — drop legacy DB and every org-scoped offline DB. */
export async function wipeAllOfflineData(): Promise<void> {
  const names = new Set<string>([LEGACY_OFFLINE_DB_NAME]);
  if (typeof indexedDB.databases === "function") {
    const listed = await indexedDB.databases();
    for (const db of listed) {
      if (db.name?.startsWith("midnight-epos-db")) {
        names.add(db.name);
      }
    }
  }
  await Promise.all([...names].map((name) => deleteIndexedDb(name)));
  await clearServiceWorkerAllCaches();
}

/** Sign out — clears offline data and ends Clerk / legacy session. */
export async function navigateToLogout(): Promise<void> {
  window.location.href = resolveAppPath("/sign-out");
}
