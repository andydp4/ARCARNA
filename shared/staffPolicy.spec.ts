import { describe, expect, it } from "vitest";
import {
  adminOnlySettingChanges,
  cashierProfileForRole,
  mayConfirmCommissionPayment,
  maySeeShiftSheet,
  orgSettingsForRole,
  shiftSheetForRole,
} from "./staffPolicy";

describe("shift sheets (STF-FN4)", () => {
  const cashierShift = { userId: "cashier-a", role: "CASHIER" as const };
  const managerShift = { userId: "manager-b", role: "MANAGER" as const };
  const adminShift = { userId: "admin-c", role: "ADMIN" as const };

  it("a cashier reads only their own", () => {
    const me = { userId: "cashier-a", role: "CASHIER" };
    expect(maySeeShiftSheet(me, cashierShift)).toBe(true);
    expect(maySeeShiftSheet(me, { userId: "cashier-z", role: "CASHIER" })).toBe(false);
    expect(maySeeShiftSheet(me, managerShift)).toBe(false);
    // A code-only shift has no person, so it is nobody's own.
    expect(maySeeShiftSheet(me, { userId: null, role: null })).toBe(false);
  });

  it("a manager reads cashiers' and their own, not other managers' or admins'", () => {
    const me = { userId: "manager-b", role: "MANAGER" };
    expect(maySeeShiftSheet(me, cashierShift)).toBe(true);
    expect(maySeeShiftSheet(me, managerShift)).toBe(true);
    expect(maySeeShiftSheet(me, { userId: "manager-y", role: "MANAGER" })).toBe(false);
    expect(maySeeShiftSheet(me, adminShift)).toBe(false);
    expect(maySeeShiftSheet(me, { userId: null, role: null })).toBe(true);
  });

  it("admins and the owner read all; nobody else reads any", () => {
    for (const role of ["ADMIN", "SUPER_ADMIN"]) {
      expect(maySeeShiftSheet({ userId: "x", role }, adminShift)).toBe(true);
    }
    expect(maySeeShiftSheet({ userId: "cashier-a", role: "CUSTOMER" }, cashierShift)).toBe(false);
    expect(maySeeShiftSheet({ userId: "cashier-a", role: null }, cashierShift)).toBe(false);
  });
});

describe("the staff list", () => {
  const profile = { id: "p1", cashierCode: "001", pinCode: "4321", defaultCommissionRate: "12.00" };

  it("never carries the PIN, for anyone", () => {
    for (const role of ["MANAGER", "ADMIN", "SUPER_ADMIN"]) {
      const out = cashierProfileForRole(profile, role);
      expect(out).not.toHaveProperty("pinCode");
      expect(JSON.stringify(out)).not.toContain("4321");
      expect(out.hasPin).toBe(true);
    }
    expect(cashierProfileForRole({ ...profile, pinCode: null }, "ADMIN").hasPin).toBe(false);
  });

  it("shows commission rates to admins only", () => {
    expect(cashierProfileForRole(profile, "ADMIN")).toHaveProperty("defaultCommissionRate", "12.00");
    expect(cashierProfileForRole(profile, "MANAGER")).not.toHaveProperty("defaultCommissionRate");
    expect(orgSettingsForRole({ defaultCashierCommissionRate: 10, x: 1 }, "MANAGER")).toEqual({ x: 1 });
    expect(orgSettingsForRole({ defaultCashierCommissionRate: 10 }, "SUPER_ADMIN")).toEqual({
      defaultCashierCommissionRate: 10,
    });
  });
});

describe("admin-only settings (Q16)", () => {
  const current = {
    cashierCommissionEnabled: false,
    defaultCashierCommissionRate: "10.00",
    globalExpenseAllocationMode: "daily_percentage",
    opsPrepSlaMinutes: 20,
    opsLateGraceMinutes: null,
    requireCashierForSale: true,
  };

  it("names only the admin-only keys that would really change", () => {
    expect(
      adminOnlySettingChanges(current, {
        cashierCommissionEnabled: false,
        defaultCashierCommissionRate: "10",
        opsPrepSlaMinutes: 20,
        requireCashierForSale: false,
      }),
    ).toEqual([]);
    expect(adminOnlySettingChanges(current, { defaultCashierCommissionRate: 12, opsLateGraceMinutes: 5 })).toEqual([
      { key: "defaultCashierCommissionRate", from: "10.00", to: 12 },
      { key: "opsLateGraceMinutes", from: null, to: 5 },
    ]);
    expect(adminOnlySettingChanges(current, { cashierCommissionEnabled: true }).map((c) => c.key)).toEqual([
      "cashierCommissionEnabled",
    ]);
    expect(adminOnlySettingChanges(current, { globalExpenseAllocationMode: "none" })).toHaveLength(1);
  });
});

describe("confirming commission payments", () => {
  it("nobody confirms their own", () => {
    for (const role of ["MANAGER", "ADMIN", "SUPER_ADMIN"]) {
      const verdict = mayConfirmCommissionPayment({ userId: "u1", role }, { userId: "u1", role: role as any });
      expect(verdict.ok, role).toBe(false);
    }
  });

  it("below the owner, only cashiers' pay", () => {
    const manager = { userId: "m1", role: "MANAGER" };
    expect(mayConfirmCommissionPayment(manager, { userId: "c1", role: "CASHIER" }).ok).toBe(true);
    expect(mayConfirmCommissionPayment(manager, { userId: null, role: null }).ok).toBe(true);
    expect(mayConfirmCommissionPayment(manager, { userId: "m2", role: "MANAGER" }).ok).toBe(false);
    expect(mayConfirmCommissionPayment({ userId: "a1", role: "ADMIN" }, { userId: "m2", role: "MANAGER" }).ok).toBe(false);
    expect(mayConfirmCommissionPayment({ userId: "o1", role: "SUPER_ADMIN" }, { userId: "m2", role: "MANAGER" }).ok).toBe(true);
    expect(mayConfirmCommissionPayment({ userId: "c9", role: "CASHIER" }, { userId: "c1", role: "CASHIER" }).ok).toBe(false);
  });
});

describe("shift sheet fields by role (Q6, Q16)", () => {
  const sheet = {
    grossSales: 20,
    cashSales: 20,
    stockCost: 13.37,
    personalUseCost: 13.37,
    orderExpenses: 13.37,
    globalExpenseAllocation: 1,
    netSalesProfit: 6.63,
    businessRetainedProfit: 5.3,
    hasIncompleteCostData: false,
    commissionRate: 20,
    commissionAmount: 1.33,
  };

  it("a cashier keeps sales and their commission earned, never cost or the rate", () => {
    const out = shiftSheetForRole(sheet, "CASHIER");
    expect(out).toEqual({ grossSales: 20, cashSales: 20, commissionAmount: 1.33 });
    expect(JSON.stringify(out)).not.toContain("13.37");
  });

  it("a manager sees cost, not the commission rate", () => {
    const out = shiftSheetForRole(sheet, "MANAGER");
    expect(out.stockCost).toBe(13.37);
    expect(out).not.toHaveProperty("commissionRate");
  });

  it("an admin and the owner see everything", () => {
    expect(shiftSheetForRole(sheet, "ADMIN")).toEqual(sheet);
    expect(shiftSheetForRole(sheet, "SUPER_ADMIN")).toEqual(sheet);
  });
});
