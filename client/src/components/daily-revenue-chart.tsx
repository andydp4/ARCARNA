import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard } from "@/components/chart-card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function DailyRevenueChart() {
  const { data: dailyRevenue = [], isLoading } = useQuery({
    queryKey: ["/api/analytics/daily-revenue"],
  });

  const chartData = (dailyRevenue as any[])?.map((day: any) => ({
    date: new Date(day.date).toLocaleDateString("en-US", {
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
        <div className="flex shrink-0 gap-2" aria-hidden="true">
          <span className="rounded-lg bg-truth-subtle px-3 py-1 text-xs font-medium text-truth-bright" data-testid="button-revenue-30d">
            30D
          </span>
          <span className="rounded-lg px-3 py-1 text-xs font-medium text-metal-muted" data-testid="button-revenue-7d">
            7D
          </span>
        </div>
      }
      interpretation="One line per day; totals match the daily revenue endpoint (not a custom range). Watch for sustained dips or spikes."
      action={{ label: "Open Truths for a custom range", href: "/insights" }}
    >
      {isLoading ? (
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
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  color: "var(--popover-foreground)",
                }}
                formatter={(value: any) => [`$${value.toLocaleString()}`, "Revenue"]}
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
