import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Daily Revenue
            </h3>
            <CardDescription>
              One line per day; totals match the daily revenue endpoint (not a custom range).
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2" aria-hidden="true">
            <span className="rounded-lg bg-secondary/10 px-3 py-1 text-xs font-medium text-secondary" data-testid="button-revenue-30d">
              30D
            </span>
            <span className="rounded-lg px-3 py-1 text-xs font-medium text-muted-foreground" data-testid="button-revenue-7d">
              7D
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="h-56 w-full min-h-[220px] sm:h-64 sm:min-h-[256px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 91%)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "hsl(215 16% 47%)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "hsl(215 16% 47%)" }}
                  tickLine={false}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(222 47% 11%)",
                    border: "none",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  formatter={(value: any) => [`$${value.toLocaleString()}`, "Revenue"]}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="hsl(217 91% 60%)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
