import { describe, expect, it } from "vitest";
import { placeCallout, VIEWPORT_MARGIN } from "../tourPlacement";

describe("placeCallout (v1.2.1 UI-07)", () => {
  const viewport = { width: 1440, height: 900 };

  it("keeps a tall callout inside the viewport (Truths 'See this again', 202px, low on a 900px screen)", () => {
    // The Replay tour link sits near the bottom of the menu.
    const highlight = { top: 760, left: 8, width: 240, height: 44 };
    const { top } = placeCallout({ highlight, preferredSide: "right", viewport, calloutHeight: 202 });
    expect(top + 202).toBeLessThanOrEqual(viewport.height - VIEWPORT_MARGIN);
  });

  it("flips a bottom callout above its target using the measured height, not the estimate", () => {
    const highlight = { top: 600, left: 400, width: 200, height: 40 };
    // 260px below the target: enough for the 160px estimate, not for 280px.
    const placed = placeCallout({ highlight, preferredSide: "bottom", viewport, calloutHeight: 280 });
    expect(placed.side).toBe("top");
    expect(placed.top + 280).toBeLessThanOrEqual(highlight.top);
  });

  it("fits a phone's width", () => {
    const placed = placeCallout({
      highlight: { top: 100, left: 10, width: 40, height: 40 },
      preferredSide: "right",
      viewport: { width: 320, height: 640 },
      calloutHeight: 180,
    });
    expect(placed.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });
});
