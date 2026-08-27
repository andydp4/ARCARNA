/**
 * Which rate applies to a shift, now that commission belongs to a user rather
 * than a cashier code (migration 057).
 *
 * The order matters and decides money. Everyone starts on the organisation
 * default, because the old per-code rates could never be mapped to users —
 * nothing ever linked a code to an account. A code's own rate is still honoured
 * beneath a user's so shifts closed before the change keep the figures they
 * were closed on.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

const { resolveCommissionRate } = await import("../services/cashierShiftEngine");

describe("commission rate precedence", () => {
  it("uses the person's own rate above everything else", () => {
    expect(resolveCommissionRate({ userRate: "25", cashierRate: "20", orgRate: "10" })).toBe(25);
  });

  it("falls back to the cashier code's rate for orders taken before users were attributed", () => {
    expect(resolveCommissionRate({ userRate: null, cashierRate: "20", orgRate: "10" })).toBe(20);
  });

  it("falls back to the organisation default, which is where everyone starts", () => {
    expect(resolveCommissionRate({ userRate: null, cashierRate: null, orgRate: "10" })).toBe(10);
  });

  it("treats a rate of zero as a real rate, not as unset", () => {
    // Somebody genuinely on 0% must not silently inherit the org default.
    expect(resolveCommissionRate({ userRate: 0, cashierRate: "20", orgRate: "10" })).toBe(0);
    expect(resolveCommissionRate({ userRate: null, cashierRate: 0, orgRate: "10" })).toBe(0);
  });

  it("pays nothing when nothing is set anywhere", () => {
    expect(resolveCommissionRate({})).toBe(0);
  });

  it("accepts rates as numbers or as the strings the database returns", () => {
    expect(resolveCommissionRate({ userRate: 12.5 })).toBe(12.5);
    expect(resolveCommissionRate({ userRate: "12.50" })).toBe(12.5);
  });
});
