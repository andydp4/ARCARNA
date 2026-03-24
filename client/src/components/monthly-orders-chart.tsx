import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Monthly Orders
            </h3>
            <CardDescription>
              Order count per month from the monthly summary API.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2" aria-hidden="true">
            <span className="rounded-lg bg-secondary/10 px-3 py-1 text-xs font-medium text-secondary" data-testid="button-orders-12m">
              12M
            </span>
            <span className="rounded-lg px-3 py-1 text-xs font-medium text-muted-foreground" data-testid="button-orders-6m">
              6M
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
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 91%)" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "hsl(215 16% 47%)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "hsl(215 16% 47%)" }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(222 47% 11%)",
                    border: "none",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  formatter={(value: any) => [`${value} orders`, "Orders"]}
                />
                <Bar
                  dataKey="orders"
                  fill="hsl(160 84% 39%)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
