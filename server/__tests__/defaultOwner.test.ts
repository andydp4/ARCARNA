/**
 * The default-owner rule (Phase N, N3b; brief "Decisions locked" → Assignment,
 * owner's answer Q4/Q16): the inputter, if on the order's station or Both;
 * otherwise the present, not-on-break station member with the fewest open
 * orders; otherwise nobody.
 *
 * Pure and synchronous (`resolveDefaultOwner`, server/routes/orders.ts) — no
 * database needed to prove the three cases the brief's DoD names.
 */
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));

import { describe, expect, it, vi } from "vitest";
import { resolveDefaultOwner, type DefaultOwnerCandidate } from "../routes/orders";

function candidate(overrides: Partial<DefaultOwnerCandidate> & { userId: string }): DefaultOwnerCandidate {
  return {
    station: "collection",
    onBreak: false,
    present: true,
    openCount: 0,
    ...overrides,
  };
}

describe("resolveDefaultOwner", () => {
  it("picks the inputter when they are on the order's station", () => {
    const candidates = [
      candidate({ userId: "sam", station: "collection", openCount: 3 }),
      candidate({ userId: "ana", station: "collection", openCount: 0 }),
    ];
    // Ana has fewer open orders, but Sam keyed this one in and is on-station.
    expect(resolveDefaultOwner("collection", "sam", candidates)).toBe("sam");
  });

  it("picks the inputter on a 'both' station for a delivery order", () => {
    const candidates = [candidate({ userId: "sam", station: "both" })];
    expect(resolveDefaultOwner("delivery", "sam", candidates)).toBe("sam");
  });

  it("does not require presence for the inputter — keying it in in is being present", () => {
    const candidates = [candidate({ userId: "sam", station: "collection", present: false })];
    expect(resolveDefaultOwner("collection", "sam", candidates)).toBe("sam");
  });

  it("falls through to the least-loaded present station member when the inputter is off-station", () => {
    const candidates = [
      candidate({ userId: "sam", station: "delivery" }), // inputter, wrong station
      candidate({ userId: "ana", station: "collection", openCount: 2 }),
      candidate({ userId: "ben", station: "collection", openCount: 0 }),
    ];
    expect(resolveDefaultOwner("collection", "sam", candidates)).toBe("ben");
  });

  it("falls through when there is no inputter at all (web/API order)", () => {
    const candidates = [
      candidate({ userId: "ana", station: "collection", openCount: 5 }),
      candidate({ userId: "ben", station: "both", openCount: 1 }),
    ];
    expect(resolveDefaultOwner("collection", null, candidates)).toBe("ben");
  });

  it("skips a present station member who is on break", () => {
    const candidates = [
      candidate({ userId: "ana", station: "collection", onBreak: true, openCount: 0 }),
      candidate({ userId: "ben", station: "collection", openCount: 3 }),
    ];
    expect(resolveDefaultOwner("collection", null, candidates)).toBe("ben");
  });

  it("skips an absent (not-present) station member", () => {
    const candidates = [
      candidate({ userId: "ana", station: "collection", present: false, openCount: 0 }),
      candidate({ userId: "ben", station: "collection", present: true, openCount: 4 }),
    ];
    expect(resolveDefaultOwner("collection", null, candidates)).toBe("ben");
  });

  it("leaves the order Unassigned when nobody is eligible", () => {
    const candidates = [
      candidate({ userId: "ana", station: "delivery" }), // wrong station
      candidate({ userId: "ben", station: "collection", onBreak: true }), // on break
      candidate({ userId: "cal", station: "collection", present: false }), // absent
    ];
    expect(resolveDefaultOwner("collection", "someone-else", candidates)).toBeNull();
  });

  it("leaves the order Unassigned with no ops_staff rows at all", () => {
    expect(resolveDefaultOwner("collection", "sam", [])).toBeNull();
  });
});
