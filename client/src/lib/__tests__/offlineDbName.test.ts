import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_OFFLINE_DB_NAME,
  legacyOfflineDbNameForOrg,
  offlineDbNameForOrg,
  offlineStorage,
} from "../offline-storage";

describe("offlineDbNameForOrg", () => {
  it("namespaces IndexedDB per tenant", () => {
    expect(offlineDbNameForOrg("org_abc")).toBe("arcarna-epos-db--org_abc");
    expect(offlineDbNameForOrg("org_abc")).not.toBe(LEGACY_OFFLINE_DB_NAME);
  });

  describe("legacy queue migration", () => {
    const originalIndexedDB = globalThis.indexedDB;
    const originalIDBKeyRange = globalThis.IDBKeyRange;

    beforeEach(() => {
      const factory = new IDBFactory();
      Object.defineProperty(factory, "databases", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: factory,
      });
      Object.defineProperty(globalThis, "IDBKeyRange", {
        configurable: true,
        value: IDBKeyRange,
      });
    });

    afterEach(() => {
      offlineStorage.setActiveOrg(null);
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDB,
      });
      Object.defineProperty(globalThis, "IDBKeyRange", {
        configurable: true,
        value: originalIDBKeyRange,
      });
    });

    it("copies unsynced legacy orders and mutations into the ARCARNA DB without indexedDB.databases", async () => {
      const orgId = "org_abc";
      await seedLegacyQueues(orgId);
      await createOfflineDb(offlineDbNameForOrg(orgId));

      offlineStorage.setActiveOrg(orgId);

      await expect(offlineStorage.getUnsyncedOrders()).resolves.toMatchObject([
        {
          data: { total: 42, items: [{ productId: "prod_1", qty: 1 }] },
          synced: 0,
        },
      ]);
      await expect(offlineStorage.getUnsyncedMutations()).resolves.toMatchObject([
        {
          type: "PRODUCT_UPDATE",
          method: "PATCH",
          endpoint: "/api/products/prod_1",
          data: { stock: 9 },
          synced: 0,
        },
      ]);

      const currentDb = await createOfflineDb(offlineDbNameForOrg(orgId));
      try {
        await expect(getAll(currentDb, "offline-orders")).resolves.toHaveLength(1);
        await expect(getAll(currentDb, "mutations-queue")).resolves.toHaveLength(1);
      } finally {
        currentDb.close();
      }
    });
  });
});

function createOfflineDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("offline-orders")) {
        const orderStore = db.createObjectStore("offline-orders", {
          keyPath: "id",
          autoIncrement: true,
        });
        orderStore.createIndex("synced", "synced", { unique: false });
        orderStore.createIndex("timestamp", "timestamp", { unique: false });
      }
      if (!db.objectStoreNames.contains("mutations-queue")) {
        const mutationStore = db.createObjectStore("mutations-queue", {
          keyPath: "id",
          autoIncrement: true,
        });
        mutationStore.createIndex("synced", "synced", { unique: false });
        mutationStore.createIndex("timestamp", "timestamp", { unique: false });
        mutationStore.createIndex("type", "type", { unique: false });
      }
      if (!db.objectStoreNames.contains("products-cache")) {
        db.createObjectStore("products-cache", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("customers-cache")) {
        db.createObjectStore("customers-cache", { keyPath: "id" });
      }
    };
  });
}

async function seedLegacyQueues(orgId: string): Promise<void> {
  const db = await createOfflineDb(legacyOfflineDbNameForOrg(orgId));
  const tx = db.transaction(["offline-orders", "mutations-queue"], "readwrite");
  tx.objectStore("offline-orders").add({
    data: { total: 42, items: [{ productId: "prod_1", qty: 1 }] },
    timestamp: 1000,
    synced: 0,
  });
  tx.objectStore("mutations-queue").add({
    type: "PRODUCT_UPDATE",
    method: "PATCH",
    endpoint: "/api/products/prod_1",
    data: { stock: 9 },
    timestamp: 1001,
    synced: 0,
  });
  await transactionDone(tx);
  db.close();
}

function getAll(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
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
