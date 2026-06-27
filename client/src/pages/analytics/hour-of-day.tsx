import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { ChartCard } from "@/components/chart-card";
import { HourHeatmap } from "@/components/charts/HourHeatmap";
import type { HourOfDayBucket } from "@shared/analytics/hourOfDay";
import { Skeleton } from "@/components/Skeleton";
import { Clock } from "lucide-react";

type HourOfDayResponse = {
  buckets: HourOfDayBucket[];
  weeks: number;
  timezone: string;
};

export default function HourOfDayAnalyticsPage() {
  const { data, isLoading } = useQuery<HourOfDayResponse>({
    queryKey: ["/api/analytics/hour-of-day"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/hour-of-day?weeks=12", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load hour-of-day analytics");
      return res.json();
    },
  });

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Clock className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hour-of-day sales</h1>
          <p className="text-muted-foreground text-sm">
            Average revenue by weekday and hour over the last {data?.weeks ?? 12} weeks
            {data?.timezone ? ` (${data.timezone})` : ""}.
          </p>
        </div>
      </div>

      <ChartCard
        title="Sales heatmap"
        question="When are you busiest?"
        interpretation="Rows = weekday, columns = hour (org timezone); brighter = higher average revenue. Staff and stock the bright cells."
        action={{ label: "Plan staffing in Shifts", href: "/shifts" }}
      >
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <HourHeatmap buckets={data?.buckets ?? []} />
        )}
      </ChartCard>
    </div>
  );
}
