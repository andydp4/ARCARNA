import { describe, expect, it } from "vitest";
import { centreTourSteps, centresTitle } from "../CentreTour";
import { visibleCentres } from "../../nav-items";

/** Test ids that live inside the menu, which on a phone is a closed sheet. */
const INSIDE_MENU = ["nav-centre-menu", "nav-main-list", "nav-main-menu", "nav-pin", "nav-replay-tour"];
const CENTRES = ["control", "stock", "truths", "customer", "finance", "settings"] as const;

describe("Centre tours on a phone (v1.2.1 UI-05)", () => {
  for (const centre of CENTRES) {
    it(`${centre}: points at nothing inside the closed menu sheet and keeps more than one step`, () => {
      const steps = centreTourSteps(centre, { phone: true, centreCount: 7 });
      expect(steps.length).toBeGreaterThanOrEqual(3);
      for (const s of steps) expect(INSIDE_MENU).not.toContain(s.testId);
      // The page header and the always-visible menu button.
      expect(steps.map((s) => s.testId)).toEqual(["button-nav-toggle", "page-header", "button-nav-toggle"]);
      expect(steps.some((s) => /hover/i.test(s.body))).toBe(false);
    });
  }

  it("keeps the desktop steps as they were", () => {
    expect(centreTourSteps("stock", { phone: false, centreCount: 7 }).map((s) => s.testId)).toEqual([
      "nav-centre-menu",
      "nav-main-menu",
      "page-header",
      "nav-pin",
      "nav-replay-tour",
    ]);
  });
});

describe("the Control Centre tour counts the viewer's own Centres (v1.2.1 UI-06)", () => {
  it("tells a cashier about five Centres and a manager about seven", () => {
    const title = (role: string) =>
      centreTourSteps("control", { phone: false, centreCount: visibleCentres(role).length })[0].title;
    expect(title("CASHIER")).toBe("Five Centres");
    expect(title("MANAGER")).toBe("Seven Centres");
    expect(title("ADMIN")).toBe("Seven Centres");
  });

  it("says one Centre, not one Centres", () => {
    expect(centresTitle(1)).toBe("One Centre");
  });
});
