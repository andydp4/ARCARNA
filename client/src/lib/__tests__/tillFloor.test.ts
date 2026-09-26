import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { replaceCacheStore } from "../offline-storage";
import { tillFloorOf } from "../tillFloor";

/** The till's minimum-only floor (PRC-01, owner Q4), received and cached offline. */

function openCacheDb(): Promise<IDBDatabase> {
  const factory = new IDBFactory();
  return new Promise((resolve, reject) => {
    const req = factory.open("till-floor-test", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("products-cache", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll(db: IDBDatabase): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction("products-cache", "readonly").objectStore("products-cache").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe("tillFloorOf", () => {
  it("reads the floor the server sent", () => {
    expect(tillFloorOf({ tillFloor: 3.25, defaultSalePrice: "5.00", minPrice: "1.00" })).toBe(3.25);
  });

  it("falls back to the minimum-only rule for a row cached before the field existed", () => {
    expect(tillFloorOf({ defaultSalePrice: "5.00", minPrice: "4.00" })).toBe(4);
    expect(tillFloorOf({ defaultSalePrice: "5.00", minPrice: null })).toBe(5);
  });

  it("never uses cost, even when a cost is on the row", () => {
    expect(tillFloorOf({ defaultSalePrice: "5.00", minPrice: "2.00", costPrice: "3.00" })).toBe(2);
  });

  it("no product, no floor", () => {
    expect(tillFloorOf(null)).toBeNull();
  });
});

describe("the till floor survives the offline product cache", () => {
  it("is still there when the catalogue is read back offline", async () => {
    const db = await openCacheDb();
    await replaceCacheStore(db, "products-cache", [
      { id: "p1", name: "Widget", defaultSalePrice: "4.50", minPrice: "4.00", tillFloor: 4 },
    ]);
    const [row] = await readAll(db);
    expect(tillFloorOf(row)).toBe(4);
  });
});
