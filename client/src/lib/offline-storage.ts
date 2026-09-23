import {
  legacyOfflineDbNameForOrg,
  offlineDbNameForOrg,
  OFFLINE_DB_PREFIX,
  OFFLINE_DB_PREFIX_LEGACY,
} from "@shared/storageKeys";
import type { QueuedSaleFields } from "./saleQueue";

export { offlineDbNameForOrg, legacyOfflineDbNameForOrg };

/** @deprecated use OFFLINE_DB_PREFIX_LEGACY from shared/storageKeys */
export const LEGACY_OFFLINE_DB_NAME = OFFLINE_DB_PREFIX_LEGACY;

const DB_VERSION = 2;

type QueueStoreName = 'offline-orders' | 'mutations-queue';
type OfflineQueueRecord = (OfflineOrder | QueuedMutation) & Record<string, unknown>;

const QUEUE_STORE_NAMES: QueueStoreName[] = ['offline-orders', 'mutations-queue'];
const CACHE_STORE_NAMES = ['products-cache', 'customers-cache'] as const;

function upgradeOfflineDbSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('offline-orders')) {
    const orderStore = db.createObjectStore('offline-orders', {
      keyPath: 'id',
      autoIncrement: true
    });
    orderStore.createIndex('synced', 'synced', { unique: false });
    orderStore.createIndex('timestamp', 'timestamp', { unique: false });
  }

  if (!db.objectStoreNames.contains('mutations-queue')) {
    const mutationsStore = db.createObjectStore('mutations-queue', {
      keyPath: 'id',
      autoIncrement: true
    });
    mutationsStore.createIndex('synced', 'synced', { unique: false });
    mutationsStore.createIndex('timestamp', 'timestamp', { unique: false });
    mutationsStore.createIndex('type', 'type', { unique: false });
  }

  if (!db.objectStoreNames.contains('products-cache')) {
    db.createObjectStore('products-cache', { keyPath: 'id' });
  }

  if (!db.objectStoreNames.contains('customers-cache')) {
    db.createObjectStore('customers-cache', { keyPath: 'id' });
  }
}

function openOfflineDb(name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      upgradeOfflineDbSchema((event.target as IDBOpenDBRequest).result);
    };
  });
}

async function dbExists(name: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  if (typeof indexedDB.databases === "function") {
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === name);
  }
  return new Promise((resolve) => {
    let createdDuringProbe = false;
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => {
      createdDuringProbe = true;
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      req.result.close();
      resolve(true);
    };
    req.onerror = () => resolve(!createdDuringProbe && req.error?.name !== "AbortError");
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  if (!db.objectStoreNames.contains(storeName)) return [];
  const tx = db.transaction(storeName, 'readonly');
  const records = await requestToPromise<T[]>(tx.objectStore(storeName).getAll());
  await transactionDone(tx);
  return records;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

function queueRecordSignature(record: OfflineQueueRecord): string {
  const { id: _id, synced: _synced, error: _error, ...signature } = record;
  return stableStringify(signature);
}

async function copyUnsyncedQueue(
  sourceDb: IDBDatabase,
  targetDb: IDBDatabase,
  storeName: QueueStoreName,
): Promise<number> {
  const sourceRecords = (await getAllFromStore<OfflineQueueRecord>(sourceDb, storeName))
    .filter((record) => record.synced === 0);
  if (sourceRecords.length === 0) return 0;

  const targetRecords = await getAllFromStore<OfflineQueueRecord>(targetDb, storeName);
  const existing = new Set(targetRecords.map(queueRecordSignature));
  const recordsToCopy = sourceRecords.filter((record) => !existing.has(queueRecordSignature(record)));
  if (recordsToCopy.length === 0) return 0;

  const tx = targetDb.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const record of recordsToCopy) {
    const { id: _id, synced: _synced, error: _error, ...copy } = record;
    store.add({ ...copy, synced: 0 });
  }
  await transactionDone(tx);
  return recordsToCopy.length;
}

/** Copy a cache store (products/customers) from the legacy DB into the current
 *  DB, but only when the current cache is empty — so offline POS keeps working
 *  after the rebrand DB switch without clobbering freshly-cached data. */
async function copyCacheStoreIfEmpty(
  sourceDb: IDBDatabase,
  targetDb: IDBDatabase,
  storeName: string,
): Promise<number> {
  if (
    !sourceDb.objectStoreNames.contains(storeName) ||
    !targetDb.objectStoreNames.contains(storeName)
  ) {
    return 0;
  }
  const targetRecords = await getAllFromStore<{ id: string }>(targetDb, storeName);
  if (targetRecords.length > 0) return 0;
  const sourceRecords = await getAllFromStore<{ id: string }>(sourceDb, storeName);
  if (sourceRecords.length === 0) return 0;

  const tx = targetDb.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const record of sourceRecords) {
    store.put(record);
  }
  await transactionDone(tx);
  return sourceRecords.length;
}

async function migrateLegacyQueuesToCurrentDb(orgId: string): Promise<void> {
  const legacyName = legacyOfflineDbNameForOrg(orgId);
  if (!(await dbExists(legacyName))) return;

  const currentDb = await openOfflineDb(offlineDbNameForOrg(orgId));
  const legacyDb = await openOfflineDb(legacyName);
  try {
    await Promise.all([
      ...QUEUE_STORE_NAMES.map((storeName) => copyUnsyncedQueue(legacyDb, currentDb, storeName)),
      // Also carry over cached products/customers so offline POS still works
      // after the rebrand DB switch (copied only when the new cache is empty).
      ...CACHE_STORE_NAMES.map((storeName) => copyCacheStoreIfEmpty(legacyDb, currentDb, storeName)),
    ]);
  } finally {
    currentDb.close();
    legacyDb.close();
  }
}

/** Use the current DB name after copying any unsynced legacy queues from before rebrand. */
export async function resolveOfflineDbName(orgId: string): Promise<string> {
  const newName = offlineDbNameForOrg(orgId);
  await migrateLegacyQueuesToCurrentDb(orgId);
  return newName;
}

export interface OfflineOrder {
  id?: number;
  data: any;
  timestamp: number;
  synced: number;
}

/**
 * Fired whenever the mutation queue changes, so the offline indicator and the
 * sign-out guard can recount without polling IndexedDB.
 */
export const offlineQueueEvents: EventTarget =
  typeof EventTarget !== "undefined" ? new EventTarget() : ({ addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true } as unknown as EventTarget);

function queueChanged(): void {
  try {
    offlineQueueEvents.dispatchEvent(new Event("change"));
  } catch {
    /* no Event constructor (tests) */
  }
}

export interface QueuedMutation extends QueuedSaleFields {
  id?: number;
  type: 'ORDER_CREATE' | 'ORDER_UPDATE' | 'ORDER_DELETE' | 'PRODUCT_UPDATE' | 'CUSTOMER_CREATE' | 'CUSTOMER_UPDATE' | 'EXPENSE_CREATE';
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  data: any;
  timestamp: number;
  synced: number;
  error?: string;
}

/**
 * Which offline cache (if any) a successful GET should refresh.
 *
 * Only the two list endpoints themselves qualify. This used to be a substring
 * match, so `/api/products/top-sellers` (rows of {productId, units}, no `id`)
 * was written into the product cache — the clear committed, the first put
 * threw, and the till was left with an empty offline catalogue.
 */
export function offlineCacheTargetFor(url: string): "products" | "customers" | null {
  let pathname: string;
  try {
    pathname = new URL(url, "http://local.invalid").pathname;
  } catch {
    return null;
  }
  pathname = pathname.replace(/\/+$/, "");
  if (/(^|\/)api\/products$/.test(pathname)) return "products";
  if (/(^|\/)api\/customers$/.test(pathname)) return "customers";
  return null;
}

/**
 * Replace a cache store's contents in ONE transaction: write the new rows
 * first, then delete keys that are no longer present. Rows without an `id`
 * are skipped rather than allowed to throw mid-way. If anything fails the
 * whole transaction aborts, so the previous (good) cache survives.
 */
export async function replaceCacheStore(
  db: IDBDatabase,
  storeName: (typeof CACHE_STORE_NAMES)[number],
  rows: unknown[],
): Promise<void> {
  const valid = rows.filter(
    (r): r is Record<string, unknown> & { id: IDBValidKey } =>
      !!r &&
      typeof r === "object" &&
      (typeof (r as { id?: unknown }).id === "string" ||
        typeof (r as { id?: unknown }).id === "number"),
  );
  // An empty or wholly-invalid response is not evidence the catalogue is empty.
  if (valid.length === 0 && rows.length > 0) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const keep = new Set<IDBValidKey>();
    try {
      for (const row of valid) {
        store.put(row);
        keep.add(row.id);
      }
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      for (const key of keysReq.result) {
        if (!keep.has(key)) store.delete(key);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("cache transaction aborted"));
  });
}

/** Unsent sales in one offline DB (any org), for the sign-out guard and the keep-on-wipe rule. */
async function countUnsentSalesInDb(name: string): Promise<number> {
  const db = await openOfflineDb(name);
  try {
    const queued = await getAllFromStore<QueuedMutation>(db, 'mutations-queue');
    const legacy = await getAllFromStore<OfflineOrder>(db, 'offline-orders');
    return (
      queued.filter((m) => m.type === 'ORDER_CREATE' && m.synced === 0).length +
      legacy.filter((o) => o.synced === 0).length
    );
  } finally {
    db.close();
  }
}

/** Every offline DB name on this device, current and legacy. */
export async function listOfflineDbNames(): Promise<string[]> {
  const names = new Set<string>();
  if (typeof indexedDB === "undefined") return [];
  if (typeof indexedDB.databases === "function") {
    for (const db of await indexedDB.databases()) {
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
  return [...names];
}

/**
 * Sales on this device that have not reached arcarna, across every org's
 * offline DB — sign-out deletes all of them, so it must count all of them.
 * An unreadable DB counts as holding one: the guard fails safe.
 */
export async function countUnsentSalesOnDevice(): Promise<number> {
  let total = 0;
  for (const name of await listOfflineDbNames()) {
    if (!(await dbExists(name))) continue;
    try {
      total += await countUnsentSalesInDb(name);
    } catch {
      total += 1;
    }
  }
  return total;
}

/** Whether this DB holds unsent sales (so a wipe must keep its queue). Fails safe. */
export async function dbHoldsUnsentSales(name: string): Promise<boolean> {
  if (!(await dbExists(name))) return false;
  try {
    return (await countUnsentSalesInDb(name)) > 0;
  } catch {
    return true;
  }
}

/** Empties a DB's product and customer caches, leaving its queues alone. */
export async function clearOfflineCaches(name: string): Promise<void> {
  const db = await openOfflineDb(name);
  try {
    const stores = CACHE_STORE_NAMES.filter((store) => db.objectStoreNames.contains(store));
    if (stores.length === 0) return;
    const tx = db.transaction(stores, 'readwrite');
    for (const store of stores) tx.objectStore(store).clear();
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

class OfflineStorage {
  private orgId: string | null = null;
  private userId: string | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  /** Who is signed in, so a queued sale is only ever sent in its own person's name. */
  setActiveUser(userId: string | null): void {
    this.userId = userId;
  }

  getActiveUserId(): string | null {
    return this.userId;
  }

  setActiveOrg(orgId: string | null): void {
    if (this.orgId === orgId) return;
    this.orgId = orgId;
    this.dbPromise = null;
  }

  getActiveOrgId(): string | null {
    return this.orgId;
  }

  private requireOrgId(): string {
    if (!this.orgId) {
      throw new Error("Offline storage requires an active organization");
    }
    return this.orgId;
  }

  private openDB(): Promise<IDBDatabase> {
    const orgId = this.requireOrgId();
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = (async () => {
      const dbName = await resolveOfflineDbName(orgId);
      return openOfflineDb(dbName);
    })();

    return this.dbPromise;
  }

  async saveOfflineOrder(orderData: any): Promise<number> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readwrite');
    const store = tx.objectStore('offline-orders');

    const order: OfflineOrder = {
      data: orderData,
      timestamp: Date.now(),
      synced: 0
    };

    return new Promise((resolve, reject) => {
      const request = store.add(order);
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(request.error);
    });
  }

  async getOfflineOrders(): Promise<OfflineOrder[]> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readonly');
    const store = tx.objectStore('offline-orders');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getUnsyncedOrders(): Promise<OfflineOrder[]> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readonly');
    const store = tx.objectStore('offline-orders');
    const index = store.index('synced');

    return new Promise((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only(0));
      request.onsuccess = () => {
        const orders = request.result;
        orders.sort((a, b) => a.timestamp - b.timestamp);
        resolve(orders);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async markOrderSynced(id: number): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readwrite');
    const store = tx.objectStore('offline-orders');

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const order = getRequest.result;
        if (order) {
          order.synced = 1;
          const updateRequest = store.put(order);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async deleteOrder(id: number): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('offline-orders', 'readwrite');
    const store = tx.objectStore('offline-orders');

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async cacheProducts(products: any[]): Promise<void> {
    await replaceCacheStore(await this.openDB(), 'products-cache', products);
  }

  async getCachedProducts(): Promise<any[]> {
    const db = await this.openDB();
    const tx = db.transaction('products-cache', 'readonly');
    const store = tx.objectStore('products-cache');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async cacheCustomers(customers: any[]): Promise<void> {
    await replaceCacheStore(await this.openDB(), 'customers-cache', customers);
  }

  async getCachedCustomers(): Promise<any[]> {
    const db = await this.openDB();
    const tx = db.transaction('customers-cache', 'readonly');
    const store = tx.objectStore('customers-cache');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** `timestamp` defaults to now; pass one to keep when the sale was really rung. */
  async queueMutation(
    mutation: Omit<QueuedMutation, 'id' | 'timestamp' | 'synced'> & { timestamp?: number },
  ): Promise<number> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');

    const queuedMutation: QueuedMutation = {
      ...mutation,
      timestamp: mutation.timestamp ?? Date.now(),
      synced: 0
    };

    const id = await new Promise<number>((resolve, reject) => {
      const request = store.add(queuedMutation);
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(request.error);
    });
    queueChanged();
    return id;
  }

  /** Merge fields into a queued mutation (retry schedule, refusal, reference). */
  async updateMutation(id: number, patch: Partial<QueuedMutation>): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');
    await new Promise<void>((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const current = getRequest.result;
        if (!current) return resolve();
        const put = store.put({ ...current, ...patch, id });
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
    queueChanged();
  }

  async getUnsyncedMutations(): Promise<QueuedMutation[]> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readonly');
    const store = tx.objectStore('mutations-queue');
    const index = store.index('synced');

    return new Promise((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only(0));
      request.onsuccess = () => {
        const mutations = request.result;
        mutations.sort((a, b) => a.timestamp - b.timestamp);
        resolve(mutations);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async markMutationSynced(id: number): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const mutation = getRequest.result;
        if (mutation) {
          mutation.synced = 1;
          const updateRequest = store.put(mutation);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async markMutationError(id: number, error: string): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const mutation = getRequest.result;
        if (mutation) {
          mutation.error = error;
          const updateRequest = store.put(mutation);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async deleteMutation(id: number): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    queueChanged();
  }

  async getPendingMutationsCount(): Promise<number> {
    const mutations = await this.getUnsyncedMutations();
    return mutations.length;
  }
}

export const offlineStorage = new OfflineStorage();
