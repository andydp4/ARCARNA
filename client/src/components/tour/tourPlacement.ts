/**
 * Where a tour's callout goes (v1.2.1 UI-07). Pure, so it is tested without a
 * browser.
 *
 * The callout used to be placed with a fixed height estimate of 160px, so a
 * longer body (a taller callout) ran past the bottom of the viewport and its
 * "Got it" button was clipped. The real height, measured once the callout
 * has rendered, is used when known; the estimate is only the first guess.
 */

export type Side = "bottom" | "top" | "left" | "right";

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const CALLOUT_WIDTH = 320;
export const CALLOUT_HEIGHT_ESTIMATE = 160;
export const CALLOUT_GAP = 12;
export const VIEWPORT_MARGIN = 16;

export function placeCallout(input: {
  highlight: Box;
  preferredSide: Side;
  viewport: { width: number; height: number };
  /** The callout's rendered height, when it has been measured. */
  calloutHeight?: number | null;
}): { top: number; left: number; side: Side } {
  const { highlight, viewport } = input;
  const width = Math.min(CALLOUT_WIDTH, viewport.width - 2 * VIEWPORT_MARGIN);
  const height = input.calloutHeight && input.calloutHeight > 0 ? input.calloutHeight : CALLOUT_HEIGHT_ESTIMATE;

  const spaceBelow = viewport.height - (highlight.top + highlight.height);
  const spaceAbove = highlight.top;
  const spaceRight = viewport.width - (highlight.left + highlight.width);
  const spaceLeft = highlight.left;

  let side = input.preferredSide;
  if (side === "bottom" && spaceBelow < height && spaceAbove > spaceBelow) side = "top";
  if (side === "top" && spaceAbove < height && spaceBelow > spaceAbove) side = "bottom";
  if (side === "right" && spaceRight < width && spaceLeft > spaceRight) side = "left";
  if (side === "left" && spaceLeft < width && spaceRight > spaceLeft) side = "right";

  let top: number;
  let left: number;
  if (side === "bottom" || side === "top") {
    top = side === "bottom" ? highlight.top + highlight.height + CALLOUT_GAP : highlight.top - CALLOUT_GAP - height;
    left = highlight.left + highlight.width / 2 - width / 2;
  } else {
    left = side === "right" ? highlight.left + highlight.width + CALLOUT_GAP : highlight.left - CALLOUT_GAP - width;
    top = highlight.top + highlight.height / 2 - height / 2;
  }
  left = Math.min(Math.max(left, VIEWPORT_MARGIN), viewport.width - width - VIEWPORT_MARGIN);
  // Bottom edge first, then the top: a callout taller than the viewport keeps
  // its top (title) on screen and scrolls inside itself (see max-height).
  top = Math.min(top, viewport.height - height - VIEWPORT_MARGIN);
  top = Math.max(top, VIEWPORT_MARGIN);
  return { top, left, side };
}
