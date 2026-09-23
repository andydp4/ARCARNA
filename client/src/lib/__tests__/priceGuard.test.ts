import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildConfirmation,
  cachedEnabled,
  cachedManagers,
  checkCartLine,
  choiceProblem,
  flaggedCartLines,
  lastReason,
  rememberEnabled,
  rememberManagers,
  rememberReason,
} from "../priceGuard";

/** The till's side of the price guard (v1.2 Phase 4, PRC-02). */

const product = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Widget",
  productId: "W1",
  defaultSalePrice: "5.00",
  stock: 10,
  stockLimit: 0,
  tillFloor: 4,
  ...over,
});
const line = (customPrice: number, quantity = 1, over: Record<string, unknown> = {}) => ({
  product: product(over) as any,
  quantity,
  customPrice,
});

describe("the till's check on a cart line", () => {
  it("uses the cached floor, with no connection needed", () => {
    expect(checkCartLine(line(3.5))).toEqual({ kind: "below", floor: 4 });
    expect(checkCartLine(line(4))).toBeNull();
  });

  it("a row cached before tillFloor existed falls back to the minimum-only rule", () => {
    expect(checkCartLine(line(3, 1, { tillFloor: undefined, minPrice: "3.50" }))?.kind).toBe("below");
  });

  it("lists flagged lines with the lowest price, quantity and £ under; weighed per kg", () => {
    const lines = flaggedCartLines([line(3.5, 0.4), line(5, 2, { id: "p2" }), line(0, 2, { id: "p3", name: "Free?" })]);
    expect(lines).toEqual([
      { productId: "p1", name: "Widget", quantity: 0.4, unitPrice: 3.5, floor: 4, under: 0.2 },
      { productId: "p3", name: "Free?", quantity: 2, unitPrice: 0, floor: 4, under: 8 },
    ]);
  });
});

describe("the reason at Pay", () => {
  it("is required, Other needs a note, Manager agreed needs a manager", () => {
    expect(choiceProblem({ reason: null, note: "", managerUserId: "" })).toMatch(/reason/);
    expect(choiceProblem({ reason: "other", note: "", managerUserId: "" })).toMatch(/reason/);
    expect(choiceProblem({ reason: "manager_agreed", note: "", managerUserId: "" })).toMatch(/manager/);
    expect(choiceProblem({ reason: "manager_agreed", note: "", managerUserId: "alex" })).toBeNull();
    expect(choiceProblem({ reason: "trade", note: "", managerUserId: "alex" })).toBeNull();
  });

  it("builds the confirmation the sale (and a queued sale) carries", () => {
    const flagged = flaggedCartLines([line(3.5)]);
    const c = buildConfirmation({ reason: "manager_agreed", note: "", managerUserId: "alex" }, flagged, new Date("2026-09-23T10:00:00Z"));
    expect(c).toEqual({
      reason: "manager_agreed",
      managerUserId: "alex",
      lines: [{ productId: "p1", unitPrice: 3.5 }],
      confirmedAt: "2026-09-23T10:00:00.000Z",
    });
    // A manager picked, then the reason changed: the manager is not sent.
    expect(buildConfirmation({ reason: "trade", note: "", managerUserId: "alex" }, flagged)?.managerUserId).toBeUndefined();
  });
});

describe("kept on the device", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it("remembers the switch and the managers per org, and the last reason per person", () => {
    rememberEnabled("org-a", true);
    rememberManagers("org-a", [{ id: "alex", name: "Alex" }]);
    rememberReason("sam", "damaged");
    expect(cachedEnabled("org-a")).toBe(true);
    expect(cachedEnabled("org-b")).toBe(false);
    expect(cachedManagers("org-a")).toEqual([{ id: "alex", name: "Alex" }]);
    expect(lastReason("sam")).toBe("damaged");
    expect(lastReason("jo")).toBeNull();
  });

  it("works with no storage at all", () => {
    delete (globalThis as any).localStorage;
    expect(() => rememberReason("sam", "trade")).not.toThrow();
    expect(lastReason("sam")).toBeNull();
    expect(cachedEnabled("org-a")).toBe(false);
  });
});
