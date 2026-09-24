/**
 * What a tour step points at: an element's `data-testid`, matched exactly or,
 * for per-row controls (`button-contact-<id>`, `run-stop-<code>`), as a
 * prefix so the step lands on the first one.
 */
export interface TourTarget {
  testId: string;
  /** "prefix" matches the first element whose test id starts with `testId`. */
  match?: "exact" | "prefix";
  /**
   * Where to point instead when the target is not laid out (v1.2.1 UI-17):
   * a page that shows a table on a desktop and cards on a phone names both,
   * so the step is not dropped on one of them.
   */
  alt?: readonly TourTarget[];
}

export function tourTargetSelector(target: TourTarget): string {
  const id = target.testId.replace(/["\\]/g, "\\$&");
  return target.match === "prefix" ? `[data-testid^="${id}"]` : `[data-testid="${id}"]`;
}

/**
 * The first matching element that is actually laid out. A page often renders
 * a control twice (phone cards and a desktop table, one hidden by CSS); a
 * hidden copy has no box to spotlight, so it is skipped.
 */
export function findTourTarget(target: TourTarget, root: ParentNode = document): Element | null {
  for (const el of Array.from(root.querySelectorAll(tourTargetSelector(target)))) {
    if (el.getClientRects().length > 0) return el;
  }
  for (const alt of target.alt ?? []) {
    const el = findTourTarget(alt, root);
    if (el) return el;
  }
  return null;
}
