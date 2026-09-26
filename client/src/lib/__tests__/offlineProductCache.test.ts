import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { offlineCacheTargetFor, replaceCacheStore } from "../offline-storage";

function openCacheDb(): Promise<IDBDatabase> {
  const factory = new IDBFactory();
  return new Promise((resolve, reject) => {
    const req = factory.open("offline-cache-test", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("products-cache", { keyPath: "id" });
      req.result.createObjectStore("customers-cache", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll(db: IDBDatabase, store: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe("offlineCacheTargetFor", () => {
  it("matches only the list endpoints, not their sub-routes", () => {
    expect(offlineCacheTargetFor("/arcarna/api/products")).toBe("products");
    expect(offlineCacheTargetFor("https://x.test/api/products?limit=5")).toBe("products");
    expect(offlineCacheTargetFor("/api/customers")).toBe("customers");
    expect(offlineCacheTargetFor("/arcarna/api/products/top-sellers")).toBeNull();
    expect(offlineCacheTargetFor("/api/customers/intelligence")).toBeNull();
    expect(offlineCacheTargetFor("/api/products/abc/aliases")).toBeNull();
  });
});

describe("replaceCacheStore", () => {
  it("replaces the catalogue in one go and drops rows that are gone", async () => {
    const db = await openCacheDb();
    await replaceCacheStore(db, "products-cache", [
      { id: "p1", name: "One" },
      { id: "p2", name: "Two" },
    ]);
    await replaceCacheStore(db, "products-cache", [{ id: "p2", name: "Two v2" }, { id: "p3", name: "Three" }]);
    const rows = await readAll(db, "products-cache");
    expect(rows.map((r) => r.id).sort()).toEqual(["p2", "p3"]);
    expect(rows.find((r) => r.id === "p2").name).toBe("Two v2");
  });

  it("a top-sellers shaped response (no id) never wipes the cached catalogue", async () => {
    const db = await openCacheDb();
    await replaceCacheStore(db, "products-cache", [{ id: "p1", name: "One" }]);
    await replaceCacheStore(db, "products-cache", [
      { productId: "p1", units: 4 },
      { productId: "p9", units: 2 },
    ]);
    const rows = await readAll(db, "products-cache");
    expect(rows).toEqual([{ id: "p1", name: "One" }]);
  });

  it("skips rows without an id and keeps the valid ones", async () => {
    const db = await openCacheDb();
    await replaceCacheStore(db, "customers-cache", [{ id: "c1" }, { name: "no id" }, null]);
    expect((await readAll(db, "customers-cache")).map((r) => r.id)).toEqual(["c1"]);
  });

  it("an empty list really does empty the cache", async () => {
    const db = await openCacheDb();
    await replaceCacheStore(db, "customers-cache", [{ id: "c1" }]);
    await replaceCacheStore(db, "customers-cache", []);
    expect(await readAll(db, "customers-cache")).toEqual([]);
  });
});
