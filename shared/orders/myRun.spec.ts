import { describe, expect, it } from "vitest";
import {
  couldntDeliverSchema,
  deliveryIssueNote,
  mapsPlatformFor,
  mapsUrl,
  moveStop,
  orderRunStops,
  reorderIds,
  runOrderSchema,
} from "./myRun";

const stop = (id: string, dueAt: string | null, createdAt = "2026-09-24T08:00:00.000Z") => ({ id, dueAt, createdAt });

describe("the order of a run", () => {
  const a = stop("a", "2026-09-24T12:00:00.000Z");
  const b = stop("b", "2026-09-24T10:00:00.000Z");
  const c = stop("c", null);
  const d = stop("d", "2026-09-24T10:00:00.000Z", "2026-09-24T07:00:00.000Z");

  it("is by due time with nothing saved, undated last, older order first on a tie", () => {
    expect(orderRunStops([a, b, c, d], []).map((s) => s.id)).toEqual(["d", "b", "a", "c"]);
    expect(orderRunStops([a, b, c, d], null).map((s) => s.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("puts the driver's saved order first, then the rest by due time", () => {
    expect(orderRunStops([a, b, c, d], ["c", "a"]).map((s) => s.id)).toEqual(["c", "a", "d", "b"]);
  });

  it("ignores saved ids no longer on the run, and repeats", () => {
    expect(orderRunStops([a, b], ["gone", "b", "b"]).map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("moving stops", () => {
  it("moves one step up or down and never wraps", () => {
    expect(moveStop(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveStop(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveStop(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveStop(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveStop(["a", "b"], "x", 1)).toEqual(["a", "b"]);
  });

  it("drops a dragged stop where it lands", () => {
    expect(reorderIds(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(reorderIds(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(reorderIds(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("saves ids only, lower-cased and without repeats", () => {
    const id = "0F1E2D3C-4B5A-4968-8776-655443322110";
    expect(runOrderSchema.parse({ orderIds: [id, id.toLowerCase()] }).orderIds).toEqual([id.toLowerCase()]);
    expect(runOrderSchema.safeParse({ orderIds: ["1; drop table"] }).success).toBe(false);
    expect(runOrderSchema.safeParse({}).success).toBe(false);
  });
});

describe("map links", () => {
  const where = { deliveryAddress: "5 Live Lane,  Flat 2", deliveryPostcode: "LV1 1VE" };

  it("uses Apple Maps on an iPhone or iPad, Google Maps otherwise", () => {
    expect(mapsPlatformFor("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("apple");
    expect(mapsPlatformFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("apple");
    expect(mapsPlatformFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("google");
    expect(mapsPlatformFor("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("google");
  });

  it("builds plain directions URLs with the address and postcode", () => {
    expect(mapsUrl(where, "apple")).toBe("https://maps.apple.com/?daddr=5%20Live%20Lane%2C%20Flat%202%2C%20LV1%201VE&dirflg=d");
    expect(mapsUrl(where, "google")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=5%20Live%20Lane%2C%20Flat%202%2C%20LV1%201VE&travelmode=driving",
    );
    expect(mapsUrl({ deliveryAddress: null, deliveryPostcode: "LV1 1VE" }, "google")).toContain("destination=LV1%201VE");
    expect(mapsUrl({ deliveryAddress: " ", deliveryPostcode: null }, "apple")).toBeNull();
  });

  it("escapes what could break out of the URL", () => {
    const url = mapsUrl({ deliveryAddress: "1 A&B Road #2?x=y", deliveryPostcode: null }, "google")!;
    expect(new URL(url).searchParams.get("destination")).toBe("1 A&B Road #2?x=y");
  });
});

describe("couldn't deliver", () => {
  it("takes a reason chip, and Other needs a note", () => {
    expect(couldntDeliverSchema.safeParse({ reason: "no_answer" }).success).toBe(true);
    expect(couldntDeliverSchema.safeParse({ reason: "other" }).success).toBe(false);
    expect(couldntDeliverSchema.safeParse({ reason: "other", note: "  " }).success).toBe(false);
    expect(couldntDeliverSchema.safeParse({ reason: "other", note: "gate locked" }).success).toBe(true);
    expect(couldntDeliverSchema.safeParse({ reason: "lost" }).success).toBe(false);
  });

  it("writes the board note", () => {
    expect(deliveryIssueNote("wrong_address")).toBe("Couldn't deliver: Wrong address");
    expect(deliveryIssueNote("refused", " said not ordered ")).toBe("Couldn't deliver: Refused — said not ordered");
  });
});
