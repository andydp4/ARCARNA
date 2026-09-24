import { describe, expect, it } from "vitest";
import {
  DEVICE_NAMES,
  fixedThanks,
  isDeviceName,
  normaliseProblemReport,
  PROBLEM_CHIPS,
  problemReportInputSchema,
  problemResolveSchema,
  problemSentryTags,
  screenFor,
  scrubProblemNote,
  UNNAMED_DEVICE,
} from "./problemReports";

/** The "Problem?" rules shared by the till and the server (v1.2 Phase 8A). */

const base = {
  clientRef: "pabc123-xyz",
  chip: "too_slow" as const,
  screen: "/operations?pane=order",
  online: true,
  queue: { waiting: 0, failed: 0, needsAttention: 0 },
};

describe("chips and devices", () => {
  it("offers the five chips in order", () => {
    expect(PROBLEM_CHIPS.map((c) => c.label)).toEqual(["Too slow", "Can't find it", "Did the wrong thing", "Error message", "Other"]);
  });

  it("names devices from the fixed list only: Till 1–6, Counter tablet, Phone 1–6", () => {
    expect(DEVICE_NAMES).toHaveLength(13);
    expect(DEVICE_NAMES[0]).toBe("Till 1");
    expect(DEVICE_NAMES).toContain("Counter tablet");
    expect(DEVICE_NAMES).toContain("Phone 6");
    expect(isDeviceName("Till 7")).toBe(false);
    expect(isDeviceName("Sam's phone")).toBe(false);
  });
});

describe("screenFor", () => {
  it("keeps the route shape and drops ids and query strings", () => {
    expect(screenFor("/open-orders/3f2a9c1e-1111-4222-8333-444455556666/refund")).toBe("/open-orders/:id/refund");
    expect(screenFor("/customers/12345")).toBe("/customers/:id");
    expect(screenFor("/products", "?q=smith")).toBe("/products");
  });

  it("keeps the Operations pane so the till is told apart from the board", () => {
    expect(screenFor("/operations", "?pane=order&q=jane")).toBe("/operations?pane=order");
    expect(screenFor("/operations?pane=order")).toBe("/operations?pane=order");
  });

  it("never keeps something that looks like a name or an email in the path", () => {
    expect(screenFor("/customers/jane@example.com")).toBe("/customers/:value");
    expect(screenFor("/search/Jane%20Smith")).toBe("/search/:value");
  });
});

describe("scrubProblemNote", () => {
  it("removes emails, phone numbers, card numbers and postcodes", () => {
    const out = scrubProblemNote(
      "Customer jane@example.com on 07700 900123, card 4111 1111 1111 1111, lives at SW1A 1AA, scanner slow",
    );
    expect(out).not.toMatch(/jane@|07700|4111|SW1A/);
    expect(out).toContain("scanner slow");
  });

  it("leaves an ordinary note alone", () => {
    expect(scrubProblemNote("Pay button took 10 seconds")).toBe("Pay button took 10 seconds");
  });
});

describe("the input the server accepts", () => {
  it("refuses a chip off the list and unknown fields", () => {
    expect(problemReportInputSchema.safeParse({ ...base, chip: "angry" }).success).toBe(false);
    expect(problemReportInputSchema.safeParse({ ...base, userName: "Sam" }).success).toBe(false);
    expect(problemReportInputSchema.safeParse(base).success).toBe(true);
  });

  it("stores an unknown device as unnamed, and shapes the screen again", () => {
    const parsed = problemReportInputSchema.parse({ ...base, device: "Sam's phone", screen: "/customers/12345?q=smith", note: "  " });
    const r = normaliseProblemReport(parsed);
    expect(r.device).toBe(UNNAMED_DEVICE);
    expect(r.screen).toBe("/customers/:id");
    expect(r.note).toBeNull();
  });

  it("marks fixed only with a version", () => {
    expect(problemResolveSchema.safeParse({ outcome: "fixed" }).success).toBe(false);
    expect(problemResolveSchema.safeParse({ outcome: "fixed", version: "1.2.0" }).success).toBe(true);
    expect(problemResolveSchema.safeParse({ outcome: "fixed", version: "<script>" }).success).toBe(false);
    expect(fixedThanks("1.2.0")).toBe("Thanks, fixed in version 1.2.0");
  });
});

describe("Sentry tags", () => {
  it("tags role, screen and device and carries no name or note", () => {
    const tags = problemSentryTags({ role: "CASHIER", screen: "/operations?pane=order", device: "Till 2", chip: "too_slow", appVersion: "1.2.0", online: false });
    expect(tags).toMatchObject({ role: "CASHIER", screen: "/operations?pane=order", device: "Till 2", problem: "too_slow", online: "no" });
    expect(Object.keys(tags)).not.toContain("note");
    expect(Object.keys(tags)).not.toContain("user");
  });
});
