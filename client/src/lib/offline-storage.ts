import {
  legacyOfflineDbNameForOrg,
  offlineDbNameForOrg,
  OFFLINE_DB_PREFIX_LEGACY,
} from "@shared/storageKeys";

export { offlineDbNameForOrg, legacyOfflineDbNameForOrg };

/** @deprecated use OFFLINE_DB_PREFIX_LEGACY from shared/storageKeys */
export const LEGACY_OFFLINE_DB_NAME = OFFLINE_DB_PREFIX_LEGACY;

const DB_VERSION = 2;

type QueueStoreName = 'offline-orders' | 'mutations-queue';
type CacheStoreName = 'products-cache' | 'customers-cache';
type LegacyMigratedStoreName = QueueStoreName | CacheStoreName;
type OfflineQueueRecord = (OfflineOrder | QueuedMutation) & Record<string, unknown>;

const QUEUE_STORE_NAMES: QueueStoreName[] = ['offline-orders', 'mutations-queue'];
const CACHE_STORE_NAMES: CacheStoreName[] = ['products-cache', 'customers-cache'];

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

async function getAllFromStore<T>(db: IDBDatabase, storeName: LegacyMigratedStoreName): Promise<T[]> {
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

async function copyCacheIfTargetEmpty(
  sourceDb: IDBDatabase,
  targetDb: IDBDatabase,
  storeName: CacheStoreName,
): Promise<number> {
  const targetRecords = await getAllFromStore<Record<string, unknown>>(targetDb, storeName);
  if (targetRecords.length > 0) return 0;

  const sourceRecords = await getAllFromStore<Record<string, unknown>>(sourceDb, storeName);
  if (sourceRecords.length === 0) return 0;

  const tx = targetDb.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const record of sourceRecords) {
    store.add(record);
  }
  await transactionDone(tx);
  return sourceRecords.length;
}

async function migrateLegacyDataToCurrentDb(orgId: string): Promise<void> {
  const legacyName = legacyOfflineDbNameForOrg(orgId);
  if (!(await dbExists(legacyName))) return;

  const currentDb = await openOfflineDb(offlineDbNameForOrg(orgId));
  const legacyDb = await openOfflineDb(legacyName);
  try {
    await Promise.all(
      [
        ...QUEUE_STORE_NAMES.map((storeName) => copyUnsyncedQueue(legacyDb, currentDb, storeName)),
        ...CACHE_STORE_NAMES.map((storeName) => copyCacheIfTargetEmpty(legacyDb, currentDb, storeName)),
      ],
    );
  } finally {
    currentDb.close();
    legacyDb.close();
  }
}

/** Use the current DB name after copying legacy offline data from before rebrand. */
export async function resolveOfflineDbName(orgId: string): Promise<string> {
  const newName = offlineDbNameForOrg(orgId);
  await migrateLegacyDataToCurrentDb(orgId);
  return newName;
}

export interface OfflineOrder {
  id?: number;
  data: any;
  timestamp: number;
  synced: number;
}

export interface QueuedMutation {
  id?: number;
  type: 'ORDER_CREATE' | 'ORDER_UPDATE' | 'ORDER_DELETE' | 'PRODUCT_UPDATE' | 'CUSTOMER_CREATE' | 'CUSTOMER_UPDATE' | 'EXPENSE_CREATE';
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  data: any;
  timestamp: number;
  synced: number;
  error?: string;
}

class OfflineStorage {
  private orgId: string | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

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
    const db = await this.openDB();
    const tx = db.transaction('products-cache', 'readwrite');
    const store = tx.objectStore('products-cache');

    await store.clear();

    for (const product of products) {
      await store.put(product);
    }
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
    const db = await this.openDB();
    const tx = db.transaction('customers-cache', 'readwrite');
    const store = tx.objectStore('customers-cache');

    await store.clear();

    for (const customer of customers) {
      await store.put(customer);
    }
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

  async queueMutation(mutation: Omit<QueuedMutation, 'id' | 'timestamp' | 'synced'>): Promise<number> {
    const db = await this.openDB();
    const tx = db.transaction('mutations-queue', 'readwrite');
    const store = tx.objectStore('mutations-queue');

    const queuedMutation: QueuedMutation = {
      ...mutation,
      timestamp: Date.now(),
      synced: 0
    };

    return new Promise((resolve, reject) => {
      const request = store.add(queuedMutation);
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(request.error);
    });
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

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingMutationsCount(): Promise<number> {
    const mutations = await this.getUnsyncedMutations();
    return mutations.length;
  }
}

export const offlineStorage = new OfflineStorage();
