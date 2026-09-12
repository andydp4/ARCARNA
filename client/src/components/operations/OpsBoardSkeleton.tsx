import { Skeleton } from "@/components/ui/skeleton";

/**
 * What the board looks like before the first read comes back.
 *
 * Shaped like the real thing — two lanes, cards with a band, a chip and a
 * clock — so the layout does not jump when the data lands. Only ever shown on
 * a cold load: once a board has been read, a refetch keeps the previous cards
 * on screen and the staleness banner says how old they are, because a board
 * that blanks every ten seconds is worse than one that is ten seconds old.
 */
export function OpsBoardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="ops-board-skeleton" aria-hidden>
      {["collection", "delivery"].map((lane) => (
        <section key={lane} className="rounded-xl border border-border bg-background p-3">
          <Skeleton className="mb-3 h-6 w-40" />
          <div className="space-y-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="overflow-hidden rounded-lg border border-border bg-card">
                <Skeleton className="h-1.5 w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Skeleton className="h-6 w-28" />
                    <Skeleton className="h-7 w-16" />
                  </div>
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-11 w-full" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
