import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getActiveCashierId,
  getActiveCashierShiftId,
  getActiveCashierShiftReplayToken,
  setActiveCashierId,
  setActiveCashierShiftId,
  setActiveCashierShiftReplayToken,
  setSelectedOrgId,
} from "../orgScope";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

describe("org scoped cashier context", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("clears active cashier context when the selected org changes", () => {
    setSelectedOrgId("org-a");
    setActiveCashierId("cashier-a");
    setActiveCashierShiftId("shift-a");
    setActiveCashierShiftReplayToken("v1.token");

    setSelectedOrgId("org-b");

    expect(getActiveCashierId()).toBeNull();
    expect(getActiveCashierShiftId()).toBeNull();
    expect(getActiveCashierShiftReplayToken()).toBeNull();
  });
});
