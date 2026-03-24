import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Matches stats row + filter card + one status group with three order rows */
export function OrdersPageSkeleton() {
  return (
    <div className="w-full">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-8 space-y-2 border-b border-border/60 pb-6">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-border/60 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4 rounded" />
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mb-8 border-border/60 shadow-sm">
          <CardContent className="space-y-4 p-4 sm:p-5 sm:pt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-11 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-11 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-3 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-6 w-28 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-2" role="list">
                {Array.from({ length: 3 }).map((_, j) => (
                  <li
                    key={j}
                    className="flex min-h-[132px] flex-col gap-3 rounded-lg border border-border/60 border-l-4 border-l-muted bg-card p-4 sm:min-h-[100px] sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex gap-2">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                      <div className="flex gap-2">
                        <Skeleton className="h-7 w-24" />
                        <Skeleton className="h-6 w-20 rounded-full" />
                      </div>
                      <Skeleton className="h-3 w-48" />
                    </div>
                    <div className="flex gap-2 border-t pt-3 sm:border-t-0 sm:pt-0">
                      <Skeleton className="h-11 flex-1 sm:w-[88px]" />
                      <Skeleton className="h-11 w-11 shrink-0" />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
