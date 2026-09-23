import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "./evidenceCatalog";
import {
  DEFAULT_TRUTHS_LAYOUT,
  TRUTHS_LAYOUT_MAX_WIDGETS,
  TRUTHS_WIDGETS,
  addableWidgets,
  parseTruthsLayout,
  truthsLayoutForRole,
  truthsWidget,
  windowDays,
  windowRange,
  windowWeeks,
} from "./truthsLayout";

describe("Truths at a glance catalogue", () => {
  it("starts from today's Truths Hub charts, then the Evidence guide", () => {
    expect(DEFAULT_TRUTHS_LAYOUT.map((w) => w.id)).toEqual([
      "sales-summary",
      "revenue-by-day",
      "revenue-by-category",
      "payment-methods",
      "orders-by-hour",
      "top-products",
      "customer-mix",
      "top-customers",
      "stock-movement",
      "evidence-guide",
    ]);
    expect(parseTruthsLayout(DEFAULT_TRUTHS_LAYOUT)).toEqual({ ok: true, layout: DEFAULT_TRUTHS_LAYOUT });
  });

  it("offers every visual Truth and every built piece of Evidence, never a planned one", () => {
    for (const id of ["busiest-hours", "order-channels", "stock-turn", "customer-truths", "profit-truths"]) {
      expect(truthsWidget(id)).toBeDefined();
    }
    for (const r of REPORT_CATALOG) {
      expect(!!truthsWidget(`evidence:${r.ref}`)).toBe(r.status === "available");
    }
  });

  it("gives every widget a window it states", () => {
    for (const w of TRUTHS_WIDGETS) expect(w.windows.length).toBeGreaterThan(0);
    expect(truthsWidget("evidence:ARC-T1-001")!.windows).toEqual(["today"]);
    expect(truthsWidget("evidence:ARC-T1-004")!.windows).toEqual(["last7"]);
    expect(truthsWidget("evidence:ARC-T1-002")!.windows).toEqual(["now"]);
  });

  it("keeps Profit Truths to admins", () => {
    expect(truthsWidget("profit-truths")!.minRole).toBe("ADMIN");
  });
});

describe("parseTruthsLayout", () => {
  it("fills in the default size and window", () => {
    const r = parseTruthsLayout([{ id: "busiest-hours" }]);
    expect(r).toEqual({ ok: true, layout: [{ id: "busiest-hours", size: "large", window: "last12w" }] });
  });

  it("refuses unknown, duplicate, planned and badly-shaped widgets", () => {
    expect(parseTruthsLayout("nope").ok).toBe(false);
    expect(parseTruthsLayout([{ id: "made-up" }]).ok).toBe(false);
    expect(parseTruthsLayout([{ id: "evidence:ARC-T1-006" }]).ok).toBe(false); // planned
    expect(parseTruthsLayout([{ id: "stock-turn" }, { id: "stock-turn" }]).ok).toBe(false);
    expect(parseTruthsLayout([{ id: "stock-turn", size: "huge" }]).ok).toBe(false);
    expect(parseTruthsLayout([{ id: "stock-turn", window: "today" }]).ok).toBe(false);
    expect(parseTruthsLayout([null]).ok).toBe(false);
  });

  it("caps the number of widgets", () => {
    const tooMany = parseTruthsLayout(Array.from({ length: TRUTHS_LAYOUT_MAX_WIDGETS + 1 }, () => ({ id: "stock-turn" })));
    expect(tooMany).toEqual({ ok: false, error: expect.stringContaining(`at most ${TRUTHS_LAYOUT_MAX_WIDGETS}`) });
    // The whole catalogue fits, so an admin is never stopped from adding one of each.
    const all = TRUTHS_WIDGETS.map((w) => ({ id: w.id }));
    expect(all.length).toBeLessThanOrEqual(TRUTHS_LAYOUT_MAX_WIDGETS);
    expect(parseTruthsLayout(all).ok).toBe(true);
  });
});

describe("truthsLayoutForRole", () => {
  const layout = [
    { id: "busiest-hours", size: "large", window: "last12w" },
    { id: "profit-truths", size: "medium", window: "month" },
    { id: "gone-widget", size: "small", window: "month" },
  ] as never;

  it("shows a manager the same layout minus Profit Truths", () => {
    expect(truthsLayoutForRole(layout, "MANAGER").map((w) => w.id)).toEqual(["busiest-hours"]);
  });

  it("shows an admin everything still in the catalogue", () => {
    expect(truthsLayoutForRole(layout, "ADMIN").map((w) => w.id)).toEqual(["busiest-hours", "profit-truths"]);
    expect(truthsLayoutForRole(layout, "SUPER_ADMIN").map((w) => w.id)).toEqual(["busiest-hours", "profit-truths"]);
  });

  it("shows a cashier nothing", () => {
    expect(truthsLayoutForRole(layout, "CASHIER")).toEqual([]);
    expect(truthsLayoutForRole(layout, null)).toEqual([]);
  });
});

describe("windows", () => {
  const now = new Date(2026, 8, 23, 15, 0); // Wed 23 Sep 2026

  it("turns period windows into date ranges", () => {
    expect(windowRange("today", now)!.from).toEqual(new Date(2026, 8, 23));
    expect(windowRange("week", now)!.from).toEqual(new Date(2026, 8, 21)); // Monday
    expect(windowRange("month", now)!.from).toEqual(new Date(2026, 8, 1));
    expect(windowRange("quarter", now)!.from).toEqual(new Date(2026, 6, 1));
    expect(windowRange("last7", now)!.from).toEqual(new Date(2026, 8, 17));
    expect(windowRange("now", now)).toBeNull();
  });

  it("reads day and week counts", () => {
    expect(windowDays("last90")).toBe(90);
    expect(windowDays("month")).toBeNull();
    expect(windowWeeks("last12w")).toBe(12);
    expect(windowWeeks("last90")).toBeNull();
  });

  it("offers only widgets not yet placed", () => {
    const left = addableWidgets(DEFAULT_TRUTHS_LAYOUT).map((w) => w.id);
    expect(left).toContain("busiest-hours");
    expect(left).not.toContain("sales-summary");
  });
});
