import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { ChartCard } from "@/components/chart-card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/** ARC-045: "30D"/"7D" used to be static, `aria-hidden` spans that changed nothing on click — decorative pills styled to look like a live toggle. Now a real control over the server's own `?days=` param (server/routes/analytics.ts already accepted it; nothing read it from here). */
const WINDOWS = { "30D": 30, "7D": 7 } as const;
type WindowLabel = keyof typeof WINDOWS;

export default function DailyRevenueChart() {
  const [windowLabel, setWindowLabel] = useState<WindowLabel>("30D");
  const days = WINDOWS[windowLabel];
  const {
    data: dailyRevenue = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["/api/analytics/daily-revenue", days],
    queryFn: async () => {
      const res = await apiFetch(`/api/analytics/daily-revenue?days=${days}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load daily revenue");
      return res.json();
    },
  });

  const chartData = (dailyRevenue as any[])?.map((day: any) => ({
    date: new Date(day.date).toLocaleDateString("en-GB", {
      month: "short",
      day: "numeric",
    }),
    revenue: parseFloat(day.totalRevenue || "0"),
  })) || [];

  return (
    <ChartCard
      title="Daily Revenue"
      question="How is revenue trending day to day?"
      aside={
        <div className="flex shrink-0 gap-2">
          {(Object.keys(WINDOWS) as WindowLabel[]).map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setWindowLabel(label)}
              aria-pressed={windowLabel === label}
              className={
                windowLabel === label
                  ? "rounded-lg bg-truth-subtle px-3 py-1 text-xs font-medium text-truth-bright"
                  : "rounded-lg px-3 py-1 text-xs font-medium text-metal-muted hover:text-metal-warm-white"
              }
              data-testid={`button-revenue-${label.toLowerCase()}`}
            >
              {label}
            </button>
          ))}
        </div>
      }
      interpretation="One line per day; totals match the daily revenue endpoint (not a custom range). Watch for sustained dips or spikes."
      action={{ label: "Open Truths at a glance", href: "/truths" }}
    >
      {isError ? (
        <ErrorState
          title="Couldn't load daily revenue"
          body="This chart's data failed to load. Try again."
          onRetry={() => refetch()}
          data-testid="daily-revenue-error"
        />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="h-56 w-full min-h-[220px] sm:h-64 sm:min-h-[256px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--muted-foreground)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)" }}
                tickLine={false}
                tickFormatter={(value) => `£${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  color: "var(--popover-foreground)",
                }}
                formatter={(value: any) => [`£${value.toLocaleString("en-GB")}`, "Revenue"]}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="var(--truth-blue-bright)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
