import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function MonthlyOrdersChart() {
  const { data: monthlySummary, isLoading } = useQuery({
    queryKey: ["/api/analytics/monthly-summary"],
  });

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const chartData = monthlySummary?.map((month: any) => ({
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
            <p className="text-sm text-muted-foreground">
              Last 12 months volume
            </p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 text-xs font-medium text-secondary bg-secondary/10 rounded-lg" data-testid="button-orders-12m">
              12M
            </button>
            <button className="px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted rounded-lg" data-testid="button-orders-6m">
              6M
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
