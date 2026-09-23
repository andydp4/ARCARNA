import { resolveAppPath } from "@/lib/appPaths";
import { clearPreviewRole } from "./previewRole";
import { clearOfflineCaches, dbHoldsUnsentSales } from "./offline-storage";
import {
  legacyOfflineDbNameForOrg,
  offlineDbNameForOrg,
  OFFLINE_DB_PREFIX,
  OFFLINE_DB_PREFIX_LEGACY,
} from "@shared/storageKeys";

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

/**
 * Deletes an offline DB — unless it holds sales that have not reached
 * arcarna (v1.2 Phase 1A). Those are kept, with the product and customer
 * caches emptied, and are sent when their person signs back in. Deleting them
 * was a sale silently lost: a lapsed session or an org switch did it with no
 * one pressing anything.
 */
async function deleteUnlessUnsentSales(name: string): Promise<void> {
  if (await dbHoldsUnsentSales(name)) {
    await clearOfflineCaches(name).catch(() => undefined);
    return;
  }
  await deleteIndexedDb(name);
}

/** Remove IndexedDB + SW API cache for one tenant (org switch away). Unsent sales are kept. */
export async function wipeOrgOfflineData(orgId: string): Promise<void> {
  await Promise.all([
    deleteUnlessUnsentSales(offlineDbNameForOrg(orgId)),
    deleteUnlessUnsentSales(legacyOfflineDbNameForOrg(orgId)),
    clearServiceWorkerOrgCache(orgId),
  ]);
}

/**
 * Logout / session end — drop legacy DB and every org-scoped offline DB.
 *
 * `keepUnsentSales` is for a wipe nobody asked for (the session lapsed): a DB
 * still holding unsent sales keeps its queue. Sign-out itself wipes
 * everything, but only after its guard has seen every sale sent or handed to
 * Needs attention.
 */
export async function wipeAllOfflineData(opts: { keepUnsentSales?: boolean } = {}): Promise<void> {
  const names = new Set<string>([OFFLINE_DB_PREFIX_LEGACY, OFFLINE_DB_PREFIX]);
  if (typeof indexedDB.databases === "function") {
    const listed = await indexedDB.databases();
    for (const db of listed) {
      const name = db.name;
      if (
        name?.startsWith(`${OFFLINE_DB_PREFIX_LEGACY}--`) ||
        name?.startsWith(`${OFFLINE_DB_PREFIX}--`) ||
        name === OFFLINE_DB_PREFIX_LEGACY ||
        name === OFFLINE_DB_PREFIX
      ) {
        names.add(name);
      }
    }
  }
  await Promise.all(
    [...names].map((name) => (opts.keepUnsentSales ? deleteUnlessUnsentSales(name) : deleteIndexedDb(name))),
  );
  await clearServiceWorkerAllCaches();
}

/** Sign out — clears offline data and ends Clerk / legacy session. */
export async function navigateToLogout(): Promise<void> {
  // A role preview belongs to this sign-in; the next person must not inherit it.
  clearPreviewRole();
  window.location.href = resolveAppPath("/sign-out");
}
