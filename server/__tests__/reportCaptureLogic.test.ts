/**
 * Logic guards for the report capture flows.
 *
 * The two rules worth pinning down are subtle and easy to regress:
 *  1. Delay Log's "proactive comms" verdict compares the moment the customer
 *     was told against the ORIGINAL ETA — not the revised one. Comparing
 *     against the revised ETA would score every late warning as proactive.
 *  2. A reseller payment settles whole unpaid supplies oldest-first; a partial
 *     payment must NOT clear a larger invoice, or ageing under-reports and a
 *     supply hold is missed.
 *
 * The first used to be pinned down against a hand-copied mirror of the rule.
 * N7 re-sourced `delayLog` from `order_events` (`delayed` / `delay_cleared`)
 * rather than the `orders.delayFlag` snapshot — see
 * `server/services/reportsEngine.ts`'s module doc on `delayLog` for why (DoD:
 * "Delay Log shows a cleared delay") — and split the comparison itself out
 * into `shared/reports/delayLog.ts` as `wasProactiveDelayComms`, a pure
 * function with no database import, so this test exercises the REAL rule
 * `delayLog` runs rather than a copy of it that could silently drift out of
 * step (N7 cleanup list: this test's "local mirror → real rule") — importing
 * it from `reportsEngine.ts` directly would pull in `server/db.ts`, which
 * throws at import time with no `DATABASE_URL` set, exactly the environment
 * this `check`-job test runs in.
 *
 * The reseller settlement rule has no equivalent server-side export yet — it
 * lives inline in `POST /api/reseller-transactions`
 * (`server/routes/reportCapture.ts`) and is out of this package's touch list,
 * so its mirror below is unchanged.
 */
import { describe, expect, it } from "vitest";
import { wasProactiveDelayComms as wasProactive } from "@shared/reports/delayLog";

/** Mirrors the oldest-first settlement in POST /api/reseller-transactions. */
function settleOldestFirst(payment: number, supplies: { id: string; amount: number }[]): string[] {
  let remaining = payment;
  const cleared: string[] = [];
  for (const s of supplies) {
    if (remaining + 1e-9 < s.amount) break;
    remaining -= s.amount;
    cleared.push(s.id);
  }
  return cleared;
}

const at = (h: number) => new Date(`2026-07-28T${String(h).padStart(2, "0")}:00:00Z`);

describe("delay log — proactive comms", () => {
  it("counts a warning sent before the original ETA as proactive", () => {
    expect(wasProactive(at(15), at(14))).toBe(true);
  });

  it("does NOT count a warning sent after the original ETA", () => {
    expect(wasProactive(at(15), at(16))).toBe(false);
  });

  it("does not credit the customer never being told", () => {
    expect(wasProactive(at(15), null)).toBe(false);
  });

  it("is false when no original ETA was ever promised", () => {
    expect(wasProactive(null, at(14))).toBe(false);
  });
});

describe("reseller ledger — oldest-first settlement", () => {
  const supplies = [
    { id: "a", amount: 100 },
    { id: "b", amount: 250 },
    { id: "c", amount: 50 },
  ];

  it("clears supplies in order while the payment covers them", () => {
    expect(settleOldestFirst(350, supplies)).toEqual(["a", "b"]);
  });

  it("clears nothing when the payment is short of the oldest invoice", () => {
    expect(settleOldestFirst(80, supplies)).toEqual([]);
  });

  it("does not part-clear a larger invoice (ageing must stay honest)", () => {
    // 100 clears "a" exactly, but the remaining 0 must not touch "b" (250).
    expect(settleOldestFirst(100, supplies)).toEqual(["a"]);
  });

  it("clears everything when fully paid up", () => {
    expect(settleOldestFirst(400, supplies)).toEqual(["a", "b", "c"]);
  });

  it("tolerates floating-point pennies", () => {
    expect(settleOldestFirst(0.1 + 0.2, [{ id: "x", amount: 0.3 }])).toEqual(["x"]);
  });
});
