import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { InsightCard } from "@/components/insight-card";
import DailyRevenueChart from "./daily-revenue-chart";
import MonthlyOrdersChart from "./monthly-orders-chart";
import TopCustomersTable from "./top-customers-table";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, ShoppingBag, TrendingUp } from "lucide-react";

/**
 * The trend half of the Control Centre: 30-day totals, charts, top customers.
 *
 * Three things used to live here and no longer do:
 *
 *   - Its own "Analytics Dashboard" <h2> and intro paragraph, nested inside
 *     home.tsx's own header and section heading. Three heading levels and two
 *     page intros stood between opening the page and reading a number.
 *   - A second Quick Actions block duplicating home.tsx's, whose four buttons
 *     had no onClick and never did anything.
 *   - A "Recent Orders" panel hardcoded to "No recent orders available", with no
 *     query behind it. Real recent orders are now in dashboard/RecentOrders.
 *
 * Section framing belongs to whoever renders this, not to this component.
 */
export default function AnalyticsDashboard() {
  const { data: monthlySummary = [], isLoading: isLoadingMonthly } = useQuery<any[]>({
    queryKey: ["/api/analytics/monthly-summary"],
  });

  const totalRevenue = Array.isArray(monthlySummary)
    ? monthlySummary.reduce(
        (sum: number, month: any) => sum + parseFloat(month.totalRevenue || "0"),
        0,
      )
    : 0;
  const totalOrders = Array.isArray(monthlySummary)
    ? monthlySummary.reduce((sum: number, month: any) => sum + (month.totalOrders || 0), 0)
    : 0;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Last 30 days. For a chosen date range, charts, and CSV/PDF exports, open{" "}
        <Link
          href="/insights"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Truths
        </Link>
        .
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
        {isLoadingMonthly ? (
          <>
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </>
        ) : (
          <>
            <InsightCard
              type="truth"
              icon={DollarSign}
              title="Total Revenue"
              value={`£${totalRevenue.toLocaleString()}`}
              footer="Last 30 days"
            />
            <InsightCard
              type="truth"
              icon={ShoppingBag}
              title="Total Orders"
              value={totalOrders.toLocaleString()}
              footer="Last 30 days"
            />
            <InsightCard
              type="truth"
              icon={TrendingUp}
              title="Avg Order Value"
              value={`£${avgOrderValue.toFixed(2)}`}
              footer="Last 30 days"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
        <DailyRevenueChart />
        <MonthlyOrdersChart />
      </div>

      <TopCustomersTable />
    </div>
  );
}
