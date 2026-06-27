import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard } from "@/components/chart-card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function MonthlyOrdersChart() {
  const { data: monthlySummary = [], isLoading } = useQuery({
    queryKey: ["/api/analytics/monthly-summary"],
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
        <div className="flex shrink-0 gap-2" aria-hidden="true">
          <span className="rounded-lg bg-truth-subtle px-3 py-1 text-xs font-medium text-truth-bright" data-testid="button-orders-12m">
            12M
          </span>
          <span className="rounded-lg px-3 py-1 text-xs font-medium text-metal-muted" data-testid="button-orders-6m">
            6M
          </span>
        </div>
      }
      interpretation="Order count per month from the monthly summary. Compare months to spot seasonality and growth."
      action={{ label: "Open Truths for a custom range", href: "/insights" }}
    >
      {isLoading ? (
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
