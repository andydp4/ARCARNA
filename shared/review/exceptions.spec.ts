import { describe, expect, it } from "vitest";
import {
  latestDigestSlot,
  mayReviewException,
  refundExceptionRules,
  REVIEW_RULE_DEFAULTS,
  reviewQueuesFor,
  reviewRulesFromOrg,
  reviewRulesSchema,
  staleLine,
  weekKeyFor,
} from "./exceptions";

describe("Needs a look: who reviews what", () => {
  const cashier = { userId: "c1", role: "CASHIER" };
  const manager = { userId: "m1", role: "MANAGER" };
  const admin = { userId: "a1", role: "ADMIN" };
  const owner = { userId: "o1", role: "SUPER_ADMIN" };

  it("managers review cashiers', never managers' or their own", () => {
    expect(mayReviewException(manager, { userId: "c1", role: "CASHIER" })).toBe(true);
    expect(mayReviewException(manager, { userId: "m2", role: "MANAGER" })).toBe(false);
    expect(mayReviewException(manager, { userId: "m1", role: "CASHIER" })).toBe(false);
  });

  it("admins review managers' too; only the owner reviews admins'", () => {
    expect(mayReviewException(admin, { userId: "m2", role: "MANAGER" })).toBe(true);
    expect(mayReviewException(admin, { userId: "a2", role: "ADMIN" })).toBe(false);
    expect(mayReviewException(owner, { userId: "a2", role: "ADMIN" })).toBe(true);
    expect(mayReviewException(owner, { userId: "o1", role: "SUPER_ADMIN" })).toBe(true);
  });

  it("cashiers review nothing; an unknown subject counts as a cashier", () => {
    expect(mayReviewException(cashier, { userId: "c2", role: "CASHIER" })).toBe(false);
    expect(mayReviewException(manager, { userId: null, role: null })).toBe(true);
  });

  it("one queue per role below the viewer's", () => {
    expect(reviewQueuesFor("CASHIER")).toEqual([]);
    expect(reviewQueuesFor("MANAGER")).toEqual(["CASHIER"]);
    expect(reviewQueuesFor("ADMIN")).toEqual(["CASHIER", "MANAGER"]);
    expect(reviewQueuesFor("SUPER_ADMIN")).toEqual(["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"]);
  });

  it("the weekly line", () => {
    expect(staleLine(3)).toBe("3 unreviewed for over 7 days");
  });
});

describe("the admin rules", () => {
  it("defaults are £50, 14 days, 24 hours, immediately", () => {
    expect(reviewRulesFromOrg({})).toEqual(REVIEW_RULE_DEFAULTS);
    expect(REVIEW_RULE_DEFAULTS).toMatchObject({ refundCashOver: 50, refundAfterDays: 14, refundSameCashierHours: 24, priceGuardMinSignal: "immediate" });
    expect(reviewRulesFromOrg({ priceGuardMinSignal: "twice_daily", refundCashOver: "75.50", refundAfterDays: 30, refundSameCashierHours: 6 })).toEqual({
      priceGuardMinSignal: "twice_daily",
      refundCashOver: 75.5,
      refundAfterDays: 30,
      refundSameCashierHours: 6,
    });
  });

  it("the settings schema refuses nonsense", () => {
    expect(reviewRulesSchema.safeParse({ ...REVIEW_RULE_DEFAULTS, priceGuardMinSignal: "hourly" }).success).toBe(false);
    expect(reviewRulesSchema.safeParse({ ...REVIEW_RULE_DEFAULTS, refundAfterDays: 0 }).success).toBe(false);
    expect(reviewRulesSchema.safeParse({ ...REVIEW_RULE_DEFAULTS, refundCashOver: -1 }).success).toBe(false);
    expect(reviewRulesSchema.safeParse(REVIEW_RULE_DEFAULTS).success).toBe(true);
  });
});

describe("refunds follow the same rule", () => {
  const rules = REVIEW_RULE_DEFAULTS;
  const now = new Date("2026-09-23T12:00:00Z");
  const base = { isCash: true, total: 10, refunderUserId: "c1", saleUserId: "c1", saleAt: new Date("2026-09-22T12:00:00Z"), reason: "damaged", now };

  it("an ordinary refund raises nothing", () => {
    expect(refundExceptionRules(base, rules)).toEqual([]);
  });
  it("cash over £X (strictly over), not store credit", () => {
    expect(refundExceptionRules({ ...base, total: 50 }, rules)).toEqual([]);
    expect(refundExceptionRules({ ...base, total: 50.01 }, rules)).toEqual(["cash_over"]);
    expect(refundExceptionRules({ ...base, total: 80, isCash: false }, rules)).toEqual([]);
  });
  it("another cashier's sale, N days after, reason Other", () => {
    expect(refundExceptionRules({ ...base, saleUserId: "c2" }, rules)).toEqual(["other_cashier"]);
    expect(refundExceptionRules({ ...base, saleAt: new Date("2026-09-09T12:00:00Z") }, rules)).toEqual(["after_days"]);
    expect(refundExceptionRules({ ...base, saleAt: new Date("2026-09-09T12:00:01Z") }, rules)).toEqual([]);
    expect(refundExceptionRules({ ...base, reason: "other" }, rules)).toEqual(["reason_other"]);
  });
  it("an unknown seller is not someone else's sale", () => {
    expect(refundExceptionRules({ ...base, saleUserId: null }, rules)).toEqual([]);
  });
});

describe("twice-daily round-up and the weekly line timing", () => {
  const tz = "Europe/London";
  it("the latest round-up at or before now (12:00 and 18:00 local)", () => {
    // 23 Sep 2026 is BST (UTC+1): 12:00 local = 11:00Z, 18:00 local = 17:00Z.
    expect(latestDigestSlot(new Date("2026-09-23T10:59:00Z"), tz).toISOString()).toBe("2026-09-22T17:00:00.000Z");
    expect(latestDigestSlot(new Date("2026-09-23T11:00:00Z"), tz).toISOString()).toBe("2026-09-23T11:00:00.000Z");
    expect(latestDigestSlot(new Date("2026-09-23T16:59:00Z"), tz).toISOString()).toBe("2026-09-23T11:00:00.000Z");
    expect(latestDigestSlot(new Date("2026-09-23T20:00:00Z"), tz).toISOString()).toBe("2026-09-23T17:00:00.000Z");
  });
  it("weeks are keyed by their local Monday", () => {
    // Wednesday 23 Sep 2026.
    expect(weekKeyFor(new Date("2026-09-23T12:00:00Z"), tz)).toMatchObject({ key: "2026-09-21", weekday: 3 });
    // Monday 21 Sep, 09:30 BST.
    expect(weekKeyFor(new Date("2026-09-21T08:30:00Z"), tz)).toEqual({ key: "2026-09-21", weekday: 1, hour: 9 });
    // Sunday 27 Sep belongs to the week of the 21st.
    expect(weekKeyFor(new Date("2026-09-27T12:00:00Z"), tz).key).toBe("2026-09-21");
  });
});
