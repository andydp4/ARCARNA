import { useEffect, useState } from "react";

/**
 * The board's one live region.
 *
 * Everything on the board moves: clocks tick, cards re-sort, counts change.
 * If any of that were announced, a screen-reader user would hear an unbroken
 * stream of nothing useful — so the rule from the brief is that exactly one
 * visually-hidden `role="status"` exists for the whole page and everything
 * else is silent ("One visually-hidden board-level role=status announcer
 * receives a single debounced sentence ... nothing else on the board is
 * live").
 *
 * Debounced for the same reason: completing three cards in five seconds should
 * say one thing, not interrupt itself twice.
 */
export function OpsAnnouncer({ message, delayMs = 400 }: { message: string; delayMs?: number }) {
  const [announced, setAnnounced] = useState("");

  useEffect(() => {
    if (!message) {
      setAnnounced("");
      return;
    }
    const timer = setTimeout(() => setAnnounced(message), delayMs);
    return () => clearTimeout(timer);
  }, [message, delayMs]);

  return (
    <div role="status" aria-live="polite" className="sr-only" data-testid="ops-announcer">
      {announced}
    </div>
  );
}
