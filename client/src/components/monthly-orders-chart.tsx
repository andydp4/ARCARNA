import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { ChartCard } from "@/components/chart-card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/** ARC-045: "12M"/"6M" used to be static, `aria-hidden` spans — decorative, not a control. Now a real toggle over the server's own `?months=` param (server/routes/analytics.ts already accepted it). */
const WINDOWS = { "12M": 12, "6M": 6 } as const;
type WindowLabel = keyof typeof WINDOWS;

export default function MonthlyOrdersChart() {
  const [windowLabel, setWindowLabel] = useState<WindowLabel>("12M");
  const months = WINDOWS[windowLabel];
  const {
    data: monthlySummary = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["/api/analytics/monthly-summary", months],
    queryFn: async () => {
      const res = await apiFetch(`/api/analytics/monthly-summary?months=${months}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load monthly summary");
      return res.json();
    },
  });

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const chartData = (monthlySummary as any[])?.map((month: any) => ({
    month: monthNames[month.month - 1] || "",
    orders: month.totalOrders || 0,
  })) || [];

  return (
    <ChartCard
      title="Monthly Orders"
      question="How is order volume trending month to month?"
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
              data-testid={`button-orders-${label.toLowerCase()}`}
            >
              {label}
            </button>
          ))}
        </div>
      }
      interpretation="Order count per month from the monthly summary. Compare months to spot seasonality and growth."
      action={{ label: "Open Truths for a custom range", href: "/insights" }}
    >
      {isError ? (
        <ErrorState
          title="Couldn't load monthly orders"
          body="This chart's data failed to load. Try again."
          onRetry={() => refetch()}
          data-testid="monthly-orders-error"
        />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="h-56 w-full min-h-[220px] sm:h-64 sm:min-h-[256px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="month"
                tick={{ fill: "var(--muted-foreground)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)" }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  color: "var(--popover-foreground)",
                }}
                formatter={(value: any) => [`${value} orders`, "Orders"]}
              />
              <Bar
                dataKey="orders"
                fill="var(--truth-blue-bright)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
