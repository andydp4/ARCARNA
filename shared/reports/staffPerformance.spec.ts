/**
 * Staff Performance (v1.2 Phase 7B) — pure maths.
 */
import { describe, expect, it } from "vitest";
import {
  changePercent,
  computeStaffPerformance,
  daysInclusive,
  isPerformanceProvisional,
  presetRange,
  previousPeriod,
  splitValueBroughtIn,
  type PerformanceOrder,
  type PerformancePerson,
} from "./staffPerformance";

const people = new Map<string, PerformancePerson>([
  ["amy", { name: "Amy", role: "CASHIER" }],
  ["ben", { name: "Ben", role: "CASHIER" }],
  ["mo", { name: "Mo", role: "MANAGER" }],
  ["ada", { name: "Ada", role: "ADMIN" }],
  ["own", { name: "Owner", role: "SUPER_ADMIN" }],
]);

let n = 0;
function order(o: Partial<PerformanceOrder>): PerformanceOrder {
  n += 1;
  return {
    id: `o${n}`,
    value: 10,
    fulfilment: "collection",
    channel: "pos",
    loaderId: null,
    completerId: null,
    preparerId: null,
    dispatcherId: null,
    assigneeId: null,
    items: 1,
    lines: 1,
    wrongItem: false,
    ...o,
  };
}

describe("value brought in splits like commission", () => {
  it("solo keeps 100%; otherwise 90% completer, 10% loader, adding back to the penny", () => {
    expect(splitValueBroughtIn(1000, "amy", "amy")).toEqual({ completerPence: 1000, loaderPence: 0, solo: true });
    expect(splitValueBroughtIn(1000, "amy", null)).toEqual({ completerPence: 1000, loaderPence: 0, solo: true });
    expect(splitValueBroughtIn(1000, "amy", "ben")).toEqual({ completerPence: 900, loaderPence: 100, solo: false });
    const odd = splitValueBroughtIn(1235, "amy", "ben");
    expect(odd.completerPence + odd.loaderPence).toBe(1235);
  });
});

describe("computeStaffPerformance", () => {
  const orders = [
    order({ value: 20, loaderId: "amy", completerId: "amy" }), // Amy solo
    order({ value: 50, loaderId: "ben", completerId: "amy", preparerId: "ben", assigneeId: "ben" }), // Amy took Ben's card at handover
    order({ value: 30, fulfilment: "delivery", loaderId: "mo", completerId: "ben", preparerId: "mo", dispatcherId: "mo" }),
    order({ value: 40, loaderId: "amy", completerId: "ada" }), // admin covered
    order({ value: 15, loaderId: null, completerId: "own" }), // owner, web order
    order({ value: 12.34, loaderId: "ben", completerId: null }), // nobody completed by name
    order({ value: 8, loaderId: "ghost", completerId: "ghost" }), // deleted account
    order({ value: 5, loaderId: "amy", completerId: "amy", wrongItem: true, items: 3, lines: 2 }),
  ];
  const activity = new Map([
    ["amy", { reopens: 1, refundsProcessed: 2, refundsValue: 7.5 }],
    ["mo", { unreadyTaps: 1, deletes: 1 }],
    ["ben", { stillOpen: 2 }],
  ]);
  const result = computeStaffPerformance(orders, people, activity);
  const row = (id: string) => result.rows.find((r) => r.userId === id)!;

  it("the team rows add up to gross settled sales, in sales and in value brought in", () => {
    const gross = orders.reduce((s, o) => s + Math.round(o.value * 100), 0) / 100;
    expect(result.grossSettledSales).toBe(gross);
    const staffSales = result.rows.reduce((s, r) => s + Math.round(r.salesCompleted * 100), 0);
    const staffValue = result.rows.reduce((s, r) => s + Math.round(r.valueBroughtIn * 100), 0);
    const cover = Math.round(result.adminCover.salesCompleted * 100);
    const unattributed = Math.round(result.unattributed.salesCompleted * 100);
    expect((staffSales + cover + unattributed) / 100).toBe(gross);
    expect(result.total.salesCompleted).toBe(gross);
    expect(
      (staffValue + Math.round(result.adminCover.valueBroughtIn * 100) + Math.round(result.unattributed.valueBroughtIn * 100)) / 100,
    ).toBe(gross);
    expect(result.total.valueBroughtIn).toBe(gross);
    expect(result.total.completed).toBe(orders.length);
  });

  it("admins and the owner are Admin cover, never a row; unknown and nobody are Unattributed", () => {
    expect(result.rows.map((r) => r.userId).sort()).toEqual(["amy", "ben", "mo"]);
    expect(result.adminCover.completed).toBe(2);
    expect(result.adminCover.salesCompleted).toBe(55);
    // Amy loaded the admin-covered £40 order: she keeps the loader's 10%.
    expect(result.unattributed.completed).toBe(2);
    expect(result.unattributed.salesCompleted).toBe(20.34);
  });

  it("each job counts on its own: grabbing a card at handover adds one Completed and nothing else", () => {
    const amy = row("amy");
    const ben = row("ben");
    expect(amy.completed).toBe(3);
    expect(amy.loaded).toBe(3); // 20, 40 (admin completed), 5
    expect(ben.loaded).toBe(2);
    expect(ben.prepared).toBe(1);
    // Ben still has his load and prep on the order Amy completed, and 10% of
    // it. Nothing from the £12.34 he loaded that nobody completed by name: a
    // split needs a completer, so it stays Unattributed whole.
    expect(ben.valueBroughtIn).toBe(5 + 27);
    expect(result.unattributed.valueBroughtIn).toBe(12.34 + 8);
    expect(amy.valueBroughtIn).toBe(20 + 45 + 4 + 5);
    expect(amy.completedOthers).toBe(1);
    expect(amy.solo).toBe(2);
  });

  it("splits Completed into Collected and Delivered and credits dispatch", () => {
    const ben = row("ben");
    expect(ben.delivered).toBe(1);
    expect(ben.collected).toBe(0);
    expect(row("mo").dispatched).toBe(1);
    expect(row("mo").prepared).toBe(1);
  });

  it("works out averages and wrong-item rate from the orders they picked", () => {
    const amy = row("amy");
    expect(amy.averageOrderValue).toBe(25);
    expect(amy.itemsPerOrder).toBeCloseTo(5 / 3);
    expect(amy.linesPerOrder).toBeCloseTo(4 / 3);
    // Amy picked the two solo orders (nobody prepared them); Ben prepared the £50 one.
    expect(amy.picked).toBe(2);
    expect(amy.wrongItemRatePercent).toBe(50);
  });

  it("carries activity onto the right row", () => {
    expect(row("amy").reopens).toBe(1);
    expect(row("amy").refundsValue).toBe(7.5);
    expect(row("mo").deletes).toBe(1);
    expect(row("ben").stillOpen).toBe(2);
    expect(result.total.refundsProcessed).toBe(2);
  });

  it("with no orders every figure is zero and every ratio is empty, not NaN", () => {
    const empty = computeStaffPerformance([], people);
    expect(empty.rows).toEqual([]);
    expect(empty.total.averageOrderValue).toBeNull();
    expect(empty.total.wrongItemRatePercent).toBeNull();
    expect(empty.grossSettledSales).toBe(0);
  });
});

describe("dates", () => {
  it("presets run Monday to Sunday and months by the calendar", () => {
    // 2026-09-24 is a Thursday.
    expect(presetRange("today", "2026-09-24")).toEqual({ from: "2026-09-24", to: "2026-09-24" });
    expect(presetRange("this-week", "2026-09-24")).toEqual({ from: "2026-09-21", to: "2026-09-24" });
    expect(presetRange("last-week", "2026-09-24")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
    expect(presetRange("last-4-weeks", "2026-09-24")).toEqual({ from: "2026-08-24", to: "2026-09-20" });
    expect(presetRange("last-month", "2026-03-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("last-week", "2026-09-21")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });

  it("the previous period is the same length, immediately before", () => {
    expect(previousPeriod("2026-09-14", "2026-09-20")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(daysInclusive("2026-09-14", "2026-09-20")).toBe(7);
  });

  it("change against the previous period", () => {
    expect(changePercent(15, 10)).toBe(50);
    expect(changePercent(0, 0)).toBe(0);
    expect(changePercent(5, 0)).toBeNull();
  });

  it("per-person figures are provisional for the first two weeks", () => {
    const since = new Date("2026-09-01T00:00:00Z");
    expect(isPerformanceProvisional(since, new Date("2026-09-14T23:00:00Z"))).toBe(true);
    expect(isPerformanceProvisional(since, new Date("2026-09-15T00:00:01Z"))).toBe(false);
  });
});
