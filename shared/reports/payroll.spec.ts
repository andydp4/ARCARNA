import { describe, expect, it } from "vitest";
import { activeHoursOf, buildPayrollMetrics, canSeePayRow, personKey, type PayrollPerson } from "./payroll";

const at = (hhmm: string) => new Date(`2026-01-14T${hhmm}:00.000Z`);

describe("payroll: one row per person (STF-FN3)", () => {
  it("keys a row by the person, or by code for history with no login", () => {
    expect(personKey("user_1", "code-uuid")).toBe("user_1");
    expect(personKey(null, "code-uuid")).toBe("code:code-uuid");
    expect(personKey(null, null)).toBeNull();
  });

  it("measures active hours from opening to the last action, not to the close", () => {
    expect(activeHoursOf({ openedAt: at("10:00"), lastActivityAt: at("13:30") })).toBe(3.5);
    expect(activeHoursOf({ openedAt: at("10:00"), lastActivityAt: null })).toBe(0);
  });

  it("builds a codeless person's row from shifts, summaries, payments and completed orders", () => {
    const people = new Map<string, PayrollPerson>([["user_1", { key: "user_1", name: "Sam", role: "CASHIER" }]]);
    const [row] = buildPayrollMetrics({
      people,
      shifts: [
        { id: "s1", userId: "user_1", cashierId: null, openedAt: at("10:00"), lastActivityAt: at("12:00"), closedAt: at("23:59"), status: "auto_closed", closeReason: null },
        { id: "s2", userId: "user_1", cashierId: null, openedAt: at("14:00"), lastActivityAt: at("16:00"), closedAt: null, status: "open", closeReason: null },
      ],
      summaries: [{ shiftId: "s1", userId: "user_1", cashierId: null, grossSales: "100.00", unpaidCreditSales: "20.00", creditSales: "20.00", netSalesProfit: "40.00", commissionAmount: "4.00" }],
      payments: [{ userId: "user_1", cashierId: null, amountPaid: "1.50" }],
      orders: [{ userId: "user_1", orderCount: 4, sales: 120 }],
    });
    expect(row).toMatchObject({
      key: "user_1",
      name: "Sam",
      totalSales: 100,
      paidSalesReceived: 80,
      commissionEarned: 4,
      commissionPaid: 1.5,
      commissionUnpaid: 2.5,
      shiftCount: 2,
      activeHours: 4,
      salesPerActiveHour: 30,
      orderCount: 4,
      averageOrderValue: 30,
    });
  });
});

describe("canSeePayRow (Q12, Q13a)", () => {
  const cashierRow = { key: "c", role: "CASHIER" as const };
  const managerRow = { key: "m", role: "MANAGER" as const };
  const codeRow = { key: "code:x", role: null };

  it("the owner sees everyone", () => {
    for (const row of [cashierRow, managerRow, codeRow]) expect(canSeePayRow({ userId: "o", role: "SUPER_ADMIN" }, row)).toBe(true);
  });

  it("admins and managers see cashiers, code history and themselves, never managers' pay", () => {
    for (const role of ["ADMIN", "MANAGER"]) {
      expect(canSeePayRow({ userId: "x", role }, cashierRow)).toBe(true);
      expect(canSeePayRow({ userId: "x", role }, codeRow)).toBe(true);
      expect(canSeePayRow({ userId: "x", role }, managerRow)).toBe(false);
    }
    expect(canSeePayRow({ userId: "m", role: "MANAGER" }, managerRow)).toBe(true);
  });

  it("a cashier sees only their own row", () => {
    expect(canSeePayRow({ userId: "c", role: "CASHIER" }, cashierRow)).toBe(true);
    expect(canSeePayRow({ userId: "c2", role: "CASHIER" }, cashierRow)).toBe(false);
  });
});
