import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
            <p className="text-sm text-muted-foreground">
              Last 30 days performance
            </p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 text-xs font-medium text-secondary bg-secondary/10 rounded-lg" data-testid="button-revenue-30d">
              30D
            </button>
            <button className="px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted rounded-lg" data-testid="button-revenue-7d">
              7D
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="h-64">
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
