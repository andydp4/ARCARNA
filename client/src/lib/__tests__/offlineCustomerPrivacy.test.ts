import { IDBFactory, IDBKeyRange as FakeKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { offlineDbNameForOrg } from "@shared/storageKeys";

/**
 * Device copies (v1.2 Phase 5, PRV-07): the till's offline store holds names
 * only — the cashier view — and queued customer edits hold no contact details.
 */

const ORG = "org-privacy-test";

const FULL_ROW = {
  id: "c1",
  orgId: ORG,
  name: "Jane Smith",
  phone: "07700 904821",
  email: "jane@gmail.com",
  address: "1 High Street",
  category: "Gold",
  loyaltyPoints: 120,
  totalSpent: "999.00",
  receiptEmailOptIn: true,
};

function openRaw(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function freshStorage() {
  const mod = await import("../offline-storage");
  const storage = new (mod.offlineStorage.constructor as any)();
  storage.setActiveOrg(ORG);
  return storage as typeof mod.offlineStorage;
}

describe("the till's offline store holds the cashier view only (PRV-07)", () => {
  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
    (globalThis as any).IDBKeyRange = FakeKeyRange;
  });
  afterEach(() => {
    delete (globalThis as any).indexedDB;
  });

  it("caches names, tier, points and masks — never a phone, email, address or spend", async () => {
    const storage = await freshStorage();
    await storage.cacheCustomers([FULL_ROW]);
    const [row] = await storage.getCachedCustomers();
    expect(row).toMatchObject({
      id: "c1",
      name: "Jane Smith",
      category: "Gold",
      loyaltyPoints: 120,
      phoneMasked: "••4821",
      emailMasked: "j•••@gmail.com",
      hasPhone: true,
      hasEmail: true,
    });
    for (const field of ["phone", "email", "address", "totalSpent", "orgId"]) {
      expect(row, field).not.toHaveProperty(field);
    }
    expect(JSON.stringify(row)).not.toContain("904821");
    expect(JSON.stringify(row)).not.toContain("jane@gmail.com");
  });

  it("cuts full rows and queued contact details left by an older version of the app", async () => {
    const name = offlineDbNameForOrg(ORG);
    const old = await openRaw(name, 2, (db) => {
      db.createObjectStore("offline-orders", { keyPath: "id", autoIncrement: true }).createIndex("synced", "synced");
      const q = db.createObjectStore("mutations-queue", { keyPath: "id", autoIncrement: true });
      q.createIndex("synced", "synced");
      q.createIndex("timestamp", "timestamp");
      q.createIndex("type", "type");
      db.createObjectStore("products-cache", { keyPath: "id" });
      db.createObjectStore("customers-cache", { keyPath: "id" });
    });
    await put(old, "customers-cache", FULL_ROW);
    await put(old, "mutations-queue", {
      type: "CUSTOMER_CREATE",
      method: "POST",
      endpoint: "/api/customers",
      data: { name: "Walk In", phone: "07700 900123", email: "w@x.com", address: "2 Road", category: "Bronze" },
      timestamp: 1,
      synced: 0,
    });
    await put(old, "mutations-queue", {
      type: "ORDER_CREATE",
      method: "POST",
      endpoint: "/api/orders",
      data: { deliveryAddress: "3 Lane", items: [] },
      timestamp: 2,
      synced: 0,
    });
    old.close();

    const storage = await freshStorage();
    const [cached] = await storage.getCachedCustomers();
    expect(cached).toMatchObject({ id: "c1", name: "Jane Smith", phoneMasked: "••4821" });
    for (const field of ["phone", "email", "address", "totalSpent"]) expect(cached, field).not.toHaveProperty(field);
    const queued = await storage.getUnsyncedMutations();
    const customer = queued.find((m) => m.type === "CUSTOMER_CREATE")!;
    expect(customer.data).toEqual({ name: "Walk In", category: "Bronze" });
    // A sale's delivery address is the order's, and must still reach the server.
    expect(queued.find((m) => m.type === "ORDER_CREATE")!.data.deliveryAddress).toBe("3 Lane");
  });

  it("a customer edit queued now keeps no contact details", async () => {
    const storage = await freshStorage();
    await storage.queueMutation({
      type: "CUSTOMER_UPDATE",
      method: "PUT",
      endpoint: "/api/customers/c1",
      data: { name: "Jane S", email: "jane@gmail.com", phone: "07700 904821", replacePhone: "07700 111111" },
    });
    const [m] = await storage.getUnsyncedMutations();
    expect(m.data).toEqual({ name: "Jane S" });
  });
});
