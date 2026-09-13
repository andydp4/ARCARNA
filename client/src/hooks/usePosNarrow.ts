import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Below this rendered width the order form uses its phone structure: the
 * cart summary and totals sit under the lines instead of beside them, and a
 * sticky bottom bar carries the primary action instead of a rail button.
 *
 * Deliberately a plain number, not one of `@tailwindcss/container-queries`'
 * named sizes (`@md` = 28rem/448px, `@lg` = 32rem/512px by default) — this
 * hook and the form's own `@[640px]:` container-query classes both read this
 * exact figure, so the two mechanisms that decide "is there room for two
 * columns" (which subtree mounts, and how wide it is) can never disagree the
 * way the old viewport-media-query classes and the JS `isMobile` branches
 * could (finding G18).
 */
const POS_NARROW_BREAKPOINT = 640;

/**
 * Is the order form's own rendered width narrow — measured on the form's
 * `@container` root via `ResizeObserver`, not on the browser viewport
 * (`useIsMobile`). A form embedded in the Operations Centre's 42% pane is
 * narrow at every width that pane can have (the brief's "Form embedding": a
 * 400–540 px pane gets the phone structure); a form filling the whole Order
 * tab on a phone is narrow because the screen itself is. Standalone
 * behaviour is identical to before because the container then equals the
 * viewport.
 *
 * Starts `true` (the phone structure) until the first measurement, same
 * spirit as `operations.tsx`'s `useMainWidth` returning 0 for "not yet
 * known" — a form that is about to find out it has room for two columns
 * must not flash the wide layout for one frame before it knows that.
 */
export function usePosNarrow(): [(node: HTMLElement | null) => void, boolean] {
  const [narrow, setNarrow] = useState(true);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    setNarrow(node.getBoundingClientRect().width < POS_NARROW_BREAKPOINT);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setNarrow(entry.contentRect.width < POS_NARROW_BREAKPOINT);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, narrow];
}
