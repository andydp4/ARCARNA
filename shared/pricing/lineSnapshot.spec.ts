import { describe, expect, it } from "vitest";
import {
  commissionCostBasis,
  isPriceCheckExempt,
  lineUnitCost,
  snapshotFor,
  underpricedLine,
} from "./lineSnapshot";
import { tillFloor, withTillFloor } from "./floor";

describe("snapshotFor", () => {
  it("takes list price, the minimum (not cost) and known cost", () => {
    expect(snapshotFor({ defaultSalePrice: "4.50", minPrice: "4.00", costPrice: "2.10" })).toEqual({
      listPrice: 4.5,
      floorPrice: 4,
      unitCost: 2.1,
    });
  });

  it("a minimum that follows the sale price snapshots the sale price", () => {
    expect(snapshotFor({ defaultSalePrice: "4.50", minPrice: null, costPrice: null })).toEqual({
      listPrice: 4.5,
      floorPrice: 4.5,
      unitCost: null,
    });
  });

  it("keeps the minimum separate from a cost above it", () => {
    const snap = snapshotFor({ salePrice: 5, minPrice: 3, costPrice: 3.5 });
    expect(snap).toEqual({ listPrice: 5, floorPrice: 3, unitCost: 3.5 });
  });

  it("£0 cost is unknown, not free (usableCost rule)", () => {
    expect(snapshotFor({ salePrice: 5, costPrice: "0" })?.unitCost).toBeNull();
  });

  it("no product, or no usable sale price, means no snapshot", () => {
    expect(snapshotFor(null)).toBeNull();
    expect(snapshotFor({ name: "x" } as any)).toBeNull();
  });
});

describe("underpricedLine", () => {
  const snap = { listPrice: 5, floorPrice: 4, unitCost: 3 };

  it("at or above the minimum is fine", () => {
    expect(underpricedLine({ quantity: 2, unitPrice: 4 }, snap)).toBeNull();
    expect(underpricedLine({ quantity: 2, unitPrice: 5 }, snap)).toBeNull();
  });

  it("below the minimum is recorded with £ under list", () => {
    expect(underpricedLine({ quantity: 2, unitPrice: 3.5 }, snap)).toEqual({
      belowMinimum: true,
      belowCost: false,
      underList: 3,
      underCost: 0,
    });
  });

  it("below cost is recorded with £ under cost", () => {
    expect(underpricedLine({ quantity: 3, unitPrice: 2.5 }, snap)).toEqual({
      belowMinimum: true,
      belowCost: true,
      underList: 7.5,
      underCost: 1.5,
    });
  });

  it("below cost is caught even when the minimum is below cost", () => {
    const r = underpricedLine({ quantity: 1, unitPrice: 2.5 }, { listPrice: 5, floorPrice: 2, unitCost: 3 });
    expect(r).toMatchObject({ belowMinimum: false, belowCost: true, underCost: 0.5, underList: 2.5 });
  });

  it("with no minimum set, any price under list is below the minimum (no allowance, Q3)", () => {
    const r = underpricedLine({ quantity: 1, unitPrice: 4.49 }, { listPrice: 4.5, floorPrice: 4.5, unitCost: null });
    expect(r).toMatchObject({ belowMinimum: true, belowCost: false, underList: 0.01 });
  });

  it("compares in pence: 4.5 is not below 4.50", () => {
    expect(underpricedLine({ quantity: 1, unitPrice: 4.5 }, { listPrice: 4.5, floorPrice: 4.5, unitCost: null })).toBeNull();
  });

  it("a line with no snapshot is not judged", () => {
    expect(underpricedLine({ quantity: 1, unitPrice: 0 }, null)).toBeNull();
  });
});

describe("isPriceCheckExempt", () => {
  it("website sales are exempt; everything else is checked", () => {
    expect(isPriceCheckExempt({ channel: "web", paymentMethod: "transfer", source: "sale" })).toBe(true);
    expect(isPriceCheckExempt({ channel: "pos", paymentMethod: "cash", source: "sale" })).toBe(false);
    expect(isPriceCheckExempt({ channel: "api", paymentMethod: "card", source: "sale" })).toBe(false);
    expect(isPriceCheckExempt({ channel: "phone", paymentMethod: "cash", source: "sale" })).toBe(false);
  });

  it("a manager's edit of a website order is checked", () => {
    expect(isPriceCheckExempt({ channel: "web", paymentMethod: "transfer", source: "edit" })).toBe(false);
  });

  it("personal use is not a sale", () => {
    expect(isPriceCheckExempt({ channel: "pos", paymentMethod: "personal_use", source: "sale" })).toBe(true);
  });
});

describe("lineUnitCost", () => {
  it("uses the snapshot for a snapshotted line, whatever the cost is today", () => {
    expect(lineUnitCost({ listPrice: "5.00", unitCost: "2.00" }, "9.99")).toBe(2);
  });

  it("a snapshotted line with no known cost stays unknown after a cost is set", () => {
    expect(lineUnitCost({ listPrice: "5.00", unitCost: null }, "3.00")).toBeNull();
  });

  it("a line sold before snapshots uses today's cost", () => {
    expect(lineUnitCost({ listPrice: null, unitCost: null }, "3.00")).toBe(3);
    expect(lineUnitCost({}, "0")).toBeNull();
  });
});

describe("commissionCostBasis (owner Q5)", () => {
  it("all costs known: everything counts", () => {
    expect(
      commissionCostBasis([
        { quantity: 2, lineTotal: 10, unitCost: 2 },
        { quantity: 1, lineTotal: 5, unitCost: 1 },
      ]),
    ).toEqual({ stockCost: 5, knownShare: 1, costMissingLines: 0 });
  });

  it("a line with no known cost leaves commission, its revenue with it", () => {
    const basis = commissionCostBasis([
      { quantity: 2, lineTotal: 10, unitCost: 2 },
      { quantity: 1, lineTotal: 30, unitCost: null },
    ]);
    expect(basis).toEqual({ stockCost: 4, knownShare: 0.25, costMissingLines: 1 });
  });

  it("no known cost at all: nothing earns commission", () => {
    expect(commissionCostBasis([{ quantity: 1, lineTotal: 10, unitCost: null }]).knownShare).toBe(0);
  });

  it("no lines: nothing is left out", () => {
    expect(commissionCostBasis([])).toEqual({ stockCost: 0, knownShare: 1, costMissingLines: 0 });
  });
});

describe("tillFloor (owner Q4)", () => {
  it("is the minimum only, never cost", () => {
    expect(tillFloor({ defaultSalePrice: "5.00", minPrice: "2.00", costPrice: "3.00" })).toBe(2);
  });

  it("follows the sale price when no minimum is set", () => {
    expect(tillFloor({ defaultSalePrice: "4.50", minPrice: null, costPrice: "9.00" })).toBe(4.5);
  });

  it("rides on the product row", () => {
    const row = withTillFloor({ id: "p1", defaultSalePrice: "4.50", minPrice: "4.00" });
    expect(row).toMatchObject({ id: "p1", tillFloor: 4 });
  });
});
