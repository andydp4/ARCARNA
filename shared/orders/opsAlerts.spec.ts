import { describe, expect, it } from "vitest";
import {
  chimeFor,
  customerWaitingRecipients,
  delayedRecipients,
  dueKeyFor,
  dueSoonOrLateRecipients,
  newUnassignedRecipients,
  shouldAlertAssigned,
  shouldAlertDueSoon,
  shouldAlertNewUnassigned,
  stationRecipients,
  type OpsStaffPresence,
} from "./opsAlerts";

function staff(overrides: Partial<OpsStaffPresence> & { userId: string }): OpsStaffPresence {
  return { station: "collection", onBreak: false, present: true, ...overrides };
}

describe("dueKeyFor", () => {
  it("is the ISO of the instant, so a revised promise starts a new cycle", () => {
    const a = new Date("2026-09-12T14:00:00.000Z");
    const b = new Date("2026-09-12T14:30:00.000Z");
    expect(dueKeyFor(a)).toBe(a.toISOString());
    expect(dueKeyFor(b)).not.toBe(dueKeyFor(a));
  });

  it("collapses null/undefined to '' — the column's own default", () => {
    expect(dueKeyFor(null)).toBe("");
    expect(dueKeyFor(undefined)).toBe("");
  });

  it("accepts a string instant identically to a Date", () => {
    const iso = "2026-09-12T14:00:00.000Z";
    expect(dueKeyFor(iso)).toBe(new Date(iso).toISOString());
  });
});

describe("stationRecipients — presence fallback", () => {
  it("prefers present, not-on-break members of the station or Both", () => {
    const result = stationRecipients("collection", [
      staff({ userId: "sam", station: "collection", present: true }),
      staff({ userId: "ana", station: "both", present: true }),
      staff({ userId: "ravi", station: "delivery", present: true }), // wrong station
      staff({ userId: "kim", station: "collection", present: false }), // not present
    ]);
    expect(result.map((s) => s.userId).sort()).toEqual(["ana", "sam"]);
  });

  it("falls back to everyone on the station when nobody is present", () => {
    const result = stationRecipients("collection", [
      staff({ userId: "sam", station: "collection", present: false }),
      staff({ userId: "kim", station: "collection", present: false }),
    ]);
    expect(result.map((s) => s.userId).sort()).toEqual(["kim", "sam"]);
  });

  it("never includes someone on a break, present or not, fallback or not", () => {
    const result = stationRecipients("collection", [
      staff({ userId: "sam", station: "collection", present: true, onBreak: true }),
    ]);
    expect(result).toHaveLength(0);
  });

  it("excludes people on a different station entirely, even in the fallback", () => {
    const result = stationRecipients("delivery", [
      staff({ userId: "sam", station: "collection", present: false }),
    ]);
    expect(result).toHaveLength(0);
  });
});

describe("shouldAlertAssigned", () => {
  it("skips a self-claim (the assignee is the actor)", () => {
    expect(shouldAlertAssigned({ assigneeId: "sam", actorId: "sam", isDefaultOwnerPick: false, inputUserId: null })).toBe(false);
  });

  it("skips the inputter when the default-owner rule picked them", () => {
    expect(
      shouldAlertAssigned({ assigneeId: "ana", actorId: null, isDefaultOwnerPick: true, inputUserId: "ana" }),
    ).toBe(false);
  });

  it("alerts a manager's explicit assign to someone else", () => {
    expect(
      shouldAlertAssigned({ assigneeId: "sam", actorId: "manager-1", isDefaultOwnerPick: false, inputUserId: "ana" }),
    ).toBe(true);
  });

  it("alerts the default-owner rule's pick when it is NOT the inputter (least-loaded station member)", () => {
    expect(
      shouldAlertAssigned({ assigneeId: "sam", actorId: null, isDefaultOwnerPick: true, inputUserId: "ana" }),
    ).toBe(true);
  });
});

describe("shouldAlertNewUnassigned", () => {
  it("is false before 60 seconds", () => {
    expect(shouldAlertNewUnassigned({ ageSeconds: 59, loaderPresent: false })).toBe(false);
  });

  it("is true at 60 seconds when the loader is not present", () => {
    expect(shouldAlertNewUnassigned({ ageSeconds: 60, loaderPresent: false })).toBe(true);
  });

  it("is skipped for the first 5 minutes while the loader is present", () => {
    expect(shouldAlertNewUnassigned({ ageSeconds: 61, loaderPresent: true })).toBe(false);
    expect(shouldAlertNewUnassigned({ ageSeconds: 299, loaderPresent: true })).toBe(false);
  });

  it("fires at 5 minutes even with the loader present", () => {
    expect(shouldAlertNewUnassigned({ ageSeconds: 300, loaderPresent: true })).toBe(true);
  });
});

describe("newUnassignedRecipients", () => {
  it("is the station's present members, one row each", () => {
    const result = newUnassignedRecipients("delivery", [
      staff({ userId: "ravi", station: "delivery", present: true }),
      staff({ userId: "sam", station: "collection", present: true }),
    ]);
    expect(result).toEqual([{ userId: "ravi", station: "delivery" }]);
  });
});

describe("customerWaitingRecipients", () => {
  it("goes to the assignee alone when there is one", () => {
    expect(customerWaitingRecipients("sam", [staff({ userId: "ana", station: "collection" })])).toEqual([
      { userId: "sam", station: "" },
    ]);
  });

  it("falls back to present Collection members when unassigned", () => {
    const result = customerWaitingRecipients(null, [
      staff({ userId: "ana", station: "collection", present: true }),
      staff({ userId: "ravi", station: "delivery", present: true }),
    ]);
    expect(result).toEqual([{ userId: "ana", station: "collection" }]);
  });
});

describe("shouldAlertDueSoon", () => {
  it("skips a promise made within lead+2 minutes of receipt", () => {
    const receivedAt = new Date("2026-09-12T14:00:00.000Z");
    const dueAt = new Date(receivedAt.getTime() + 11 * 60_000); // 11 min window, lead 10 -> 11 <= 10+2
    expect(shouldAlertDueSoon({ receivedAt, dueAt, leadMinutes: 10 })).toBe(false);
  });

  it("alerts a promise comfortably ahead of lead+2 minutes", () => {
    const receivedAt = new Date("2026-09-12T14:00:00.000Z");
    const dueAt = new Date(receivedAt.getTime() + 20 * 60_000);
    expect(shouldAlertDueSoon({ receivedAt, dueAt, leadMinutes: 10 })).toBe(true);
  });

  it("is exact at the lead+2 boundary (skipped, not alerted)", () => {
    const receivedAt = new Date("2026-09-12T14:00:00.000Z");
    const dueAt = new Date(receivedAt.getTime() + 12 * 60_000); // exactly lead(10)+2
    expect(shouldAlertDueSoon({ receivedAt, dueAt, leadMinutes: 10 })).toBe(false);
  });
});

describe("dueSoonOrLateRecipients", () => {
  const staffList = [
    staff({ userId: "sam", station: "collection", present: true }),
    staff({ userId: "kim", station: "collection", present: true }),
  ];

  it("due_soon: assignee only, pulse (station '') — never widens to the station", () => {
    const result = dueSoonOrLateRecipients({
      kind: "due_soon",
      assigneeId: "sam",
      assigneePresent: true,
      fulfilmentMethod: "collection",
      staff: staffList,
    });
    expect(result).toEqual([{ userId: "sam", station: "" }]);
  });

  it("due_soon: station (chime) when unassigned", () => {
    const result = dueSoonOrLateRecipients({
      kind: "due_soon",
      assigneeId: null,
      assigneePresent: false,
      fulfilmentMethod: "collection",
      staff: staffList,
    });
    expect(result.map((r) => r.userId).sort()).toEqual(["kim", "sam"]);
    expect(result.every((r) => r.station === "collection")).toBe(true);
  });

  it("late: assignee's pulse row only when present", () => {
    const result = dueSoonOrLateRecipients({
      kind: "late",
      assigneeId: "sam",
      assigneePresent: true,
      fulfilmentMethod: "collection",
      staff: staffList,
    });
    expect(result).toEqual([{ userId: "sam", station: "" }]);
  });

  it("late: ALSO widens to the station when the assignee has been absent 15 min", () => {
    const result = dueSoonOrLateRecipients({
      kind: "late",
      assigneeId: "sam",
      assigneePresent: false,
      fulfilmentMethod: "collection",
      staff: staffList,
    });
    // sam's own pulse row, plus kim's station (chime) row — sam not duplicated into the station list.
    expect(result).toEqual(
      expect.arrayContaining([
        { userId: "sam", station: "" },
        { userId: "kim", station: "collection" },
      ]),
    );
    expect(result).toHaveLength(2);
  });
});

describe("delayedRecipients", () => {
  it("alerts the assignee when someone else declared the delay", () => {
    expect(delayedRecipients("sam", "manager-1")).toEqual([{ userId: "sam", station: "" }]);
  });

  it("is silent when the assignee declared their own delay", () => {
    expect(delayedRecipients("sam", "sam")).toEqual([]);
  });

  it("is silent with no assignee at all", () => {
    expect(delayedRecipients(null, "manager-1")).toEqual([]);
  });
});

describe("chimeFor — chime policy", () => {
  const now = new Date("2026-09-12T14:00:00.000Z");
  const fresh = (kind: Parameters<typeof chimeFor>[0][number]["kind"], station: "" | "collection" = "") => ({
    kind,
    station,
    createdAt: now,
  });

  it("highest severity wins across six simultaneous rows, exactly one chime", () => {
    const kind = chimeFor(
      [
        fresh("due_soon", "collection"),
        fresh("new_unassigned", "collection"),
        fresh("assigned"),
        fresh("late", "collection"),
        fresh("customer_waiting"),
        fresh("delayed"),
      ],
      now,
    );
    expect(kind).toBe("customer_waiting");
  });

  it("falls through the severity order when the top kind is absent", () => {
    expect(chimeFor([fresh("assigned"), fresh("due_soon", "collection")], now)).toBe("assigned");
  });

  it("the assignee's own due_soon/late (station '') never chimes", () => {
    expect(chimeFor([fresh("due_soon", ""), fresh("late", "")], now)).toBeNull();
  });

  it("a station due_soon/late (non-empty station) DOES chime when nothing louder is present", () => {
    expect(chimeFor([fresh("due_soon", "collection")], now)).toBe("due_soon");
  });

  it("rows older than 2 minutes pulse but never chime", () => {
    const stale = { kind: "assigned" as const, station: "" as const, createdAt: new Date(now.getTime() - 121_000) };
    expect(chimeFor([stale], now)).toBeNull();
  });

  it("a row exactly at the 2-minute boundary still chimes", () => {
    const boundary = { kind: "assigned" as const, station: "" as const, createdAt: new Date(now.getTime() - 120_000) };
    expect(chimeFor([boundary], now)).toBe("assigned");
  });

  it("no delivered rows at all: silence, not an error", () => {
    expect(chimeFor([], now)).toBeNull();
  });
});
