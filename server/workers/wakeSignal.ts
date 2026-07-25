/**
 * Worker wake signal — decoupled kick between the event bus and the worker runner.
 *
 * The worker runner used to poll the database on a fixed timer (every few hundred
 * ms), which kept Neon's compute permanently active and prevented scale-to-zero
 * even when the system was completely idle. It now runs an adaptive backoff loop
 * that goes dormant when there is no work. `wakeWorkers()` lets `publishEvent`
 * nudge the loop back to active polling the moment a new event is written, so
 * jobs are still picked up promptly.
 *
 * This module imports nothing so both `eventBus` and `workers/index` can depend on
 * it without creating an import cycle.
 */

type Waker = () => void;

let waker: Waker | null = null;

/** Registered by the worker runner on start; cleared on stop. */
export function setWorkerWaker(fn: Waker | null): void {
  waker = fn;
}

/** Best-effort nudge to the worker runner. No-op when the runner is not active. */
export function wakeWorkers(): void {
  try {
    waker?.();
  } catch {
    // Never let a wake nudge break the caller (e.g. an order transaction).
  }
}
