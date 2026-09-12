import { AlertTriangle } from "lucide-react";
import type { OpsStaleness } from "@/hooks/useOpsBoard";

/**
 * "The board is not up to date." Extracted verbatim from `OpsBoard.tsx` (N1)
 * into its own file per this package's touch list — the banner's own logic
 * has not changed, only where it lives, so N5b and any future package that
 * needs to test or extend it does not have to reach inside `OpsBoard.tsx` to
 * find it.
 *
 * A board whose cards are minutes old still LOOKS authoritative — the service
 * worker will even answer a failed read from cache with a 200 (finding G11)
 * — so the only safe thing while `staleness.isStale` is true is to say so and
 * hold every write until the board catches up (`operations.tsx`'s
 * `blockedReason`, threaded into every card action this package wires).
 */
export interface OpsStaleBannerProps {
  staleness: OpsStaleness;
}

export function OpsStaleBanner({ staleness }: OpsStaleBannerProps) {
  if (!staleness.isStale) return null;
  return (
    <div
      role="alert"
      data-testid="ops-stale-banner"
      className="flex items-start gap-2 rounded-lg border border-ops-delayed bg-card p-3 text-sm text-foreground"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ops-delayed" aria-hidden />
      <span>
        <span className="font-semibold">The board is not up to date.</span> {staleness.reason} Actions are held
        until it refreshes.
      </span>
    </div>
  );
}
