import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Main insights content below the sticky header: period card, KPI grid, tabs, chart + tables */
export function InsightsPageSkeleton() {
  return (
    <div className="space-y-8">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full max-w-xl mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full" />
            </div>
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Skeleton className="h-11 w-full sm:w-[140px]" />
              <Skeleton className="h-11 w-full sm:w-[180px]" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-border/60 bg-card shadow-sm">
            <CardHeader className="pb-3">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-9 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Skeleton className="h-4 w-full max-w-md" />

      <div className="space-y-6">
        <div className="grid h-auto w-full grid-cols-2 gap-1.5 rounded-xl bg-muted/45 p-1.5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full min-h-[240px] sm:h-[320px] rounded-lg border border-border/80 bg-muted/30">
              <Skeleton className="h-full w-full rounded-md" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function InvoicesPageSkeleton() {
  return (
    <div className="w-full">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-10 space-y-2 border-b border-border/60 pb-7">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-border/60 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4 rounded" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-3 w-36" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mb-8 border-border/60 bg-muted/[0.04] shadow-sm">
          <CardContent className="flex flex-col gap-4 p-4 sm:p-5 sm:pt-6 lg:flex-row lg:items-end">
            <div className="flex min-w-0 flex-1 flex-wrap gap-3">
              <Skeleton className="h-11 min-w-[200px] flex-1 sm:max-w-xs" />
              <Skeleton className="h-11 w-full sm:w-[140px]" />
              <Skeleton className="h-11 w-full sm:w-[160px]" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-11 w-40" />
              <Skeleton className="h-11 w-36" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-2 h-4 w-full max-w-xl" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="overflow-hidden rounded-lg border border-border/80">
              <Table>
                <TableHeader>
                  <TableRow>
                    {["Invoice #", "Customer", "Issued", "Due", "Total", "Status", "Payment", "PDF"].map((h) => (
                      <TableHead key={h} className="whitespace-nowrap">
                        <Skeleton className="h-4 w-16" />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 6 }).map((_, r) => (
                    <TableRow key={r}>
                      {Array.from({ length: 8 }).map((_, c) => (
                        <TableCell key={c}>
                          <Skeleton className="h-5 w-full min-w-[4rem]" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function ExpensesPageSkeleton() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-9 w-56" />
        <div className="flex gap-2">
          <Skeleton className="h-11 w-36" />
          <Skeleton className="h-11 w-32" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-4 rounded" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border/80">
            <Table>
              <TableHeader>
                <TableRow>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <TableHead key={i}>
                      <Skeleton className="h-4 w-20" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, r) => (
                  <TableRow key={r}>
                    {Array.from({ length: 8 }).map((_, c) => (
                      <TableCell key={c}>
                        <Skeleton className="h-5 w-full min-w-[3rem]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
