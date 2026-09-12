import { useEffect, useState } from "react";

/**
 * The board's heartbeat: one clock for every card on the screen.
 *
 * Each card counts up or down, so the naive version is a timer per card —
 * thirty orders, thirty intervals, thirty independent re-renders a second, and
 * clocks that drift a fraction apart from each other. One ticker at the top of
 * the board is cheaper and, more importantly, means every card on the screen
 * agrees about what time it is.
 *
 * `serverOffsetMs` is the door the brief leaves open for N3a. The board read
 * will return `serverNow`, and the clocks are meant to tick against it
 * ("Clocks tick against serverNow", Decisions locked) rather than against a
 * tablet whose clock may be minutes out — a tablet running fast would paint a
 * lane of red cards that are not late. Until that endpoint exists the offset
 * is 0 and this is the device clock, which is what v0 has; when it arrives,
 * N3a passes the measured difference and nothing else changes.
 *
 * The ticker stops while the page is hidden: a board on a counter is left open
 * all day, and a timer waking a suspended tab every second buys nothing.
 * `visibilitychange` re-reads the clock immediately on return, so the first
 * painted frame after waking is already correct rather than a second stale.
 */
export interface OpsTickerOptions {
  /** How often the clocks move. One second — the cards show seconds. */
  intervalMs?: number;
  /** `serverNow − Date.now()` once a server clock is available (N3a). */
  serverOffsetMs?: number;
  /** Held false while the board is not mounted or a test pins the clock. */
  enabled?: boolean;
}

export function useOpsTicker({
  intervalMs = 1_000,
  serverOffsetMs = 0,
  enabled = true,
}: OpsTickerOptions = {}): Date {
  const [now, setNow] = useState<Date>(() => new Date(Date.now() + serverOffsetMs));

  useEffect(() => {
    if (!enabled) return;

    const tick = () => setNow(new Date(Date.now() + serverOffsetMs));
    tick();

    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs, serverOffsetMs]);

  return now;
}
