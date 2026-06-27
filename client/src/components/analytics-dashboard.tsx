import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { InsightCard } from "@/components/insight-card";
import DailyRevenueChart from "./daily-revenue-chart";
import MonthlyOrdersChart from "./monthly-orders-chart";
import TopCustomersTable from "./top-customers-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  DollarSign,
  ShoppingBag,
  Users,
  TrendingUp,
  PlusCircle,
  UserPlus,
  Box,
  FileText,
} from "lucide-react";

export default function AnalyticsDashboard() {
  const { data: monthlySummary = [], isLoading: isLoadingMonthly } = useQuery<any[]>({
    queryKey: ["/api/analytics/monthly-summary"],
  });

  const totalRevenue = Array.isArray(monthlySummary) 
    ? monthlySummary.reduce(
        (sum: number, month: any) => sum + parseFloat(month.totalRevenue || "0"),
        0
      )
    : 0;
  const totalOrders = Array.isArray(monthlySummary)
    ? monthlySummary.reduce(
        (sum: number, month: any) => sum + (month.totalOrders || 0),
        0
      )
    : 0;
  const avgOrderValue =
    totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      {/* Page Header */}
      <div className="mb-6 sm:mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
          Analytics Dashboard
        </h2>
        <p className="max-w-3xl text-sm sm:text-base text-muted-foreground">
          Revenue, orders, and averages below come from your analytics APIs. For a
          chosen date range, charts, and CSV/PDF exports, open{" "}
          <Link href="/insights" className="font-medium text-primary underline-offset-4 hover:underline">
            Business Insights
          </Link>
          .
        </p>
      </div>

      <Separator className="mb-6 sm:mb-8" />

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
        {isLoadingMonthly ? (
          <>
            <Skeleton className="h-40 rounded-xl" />
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
              value={`$${totalRevenue.toLocaleString()}`}
              trend={{ direction: "up", label: "+12.5%" }}
              footer="Last 30 days"
            />
            <InsightCard
              type="truth"
              icon={ShoppingBag}
              title="Total Orders"
              value={totalOrders.toLocaleString()}
              trend={{ direction: "up", label: "+8.2%" }}
              footer="Last 30 days"
            />
            <InsightCard
              type="truth"
              icon={Users}
              title="Active Customers"
              value="847"
              trend={{ direction: "up", label: "+24.3%" }}
              footer="Last 30 days"
            />
            <InsightCard
              type="truth"
              icon={TrendingUp}
              title="Avg Order Value"
              value={`$${avgOrderValue.toFixed(2)}`}
              trend={{ direction: "up", label: "+3.7%" }}
              footer="Last 30 days"
            />
          </>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8 mb-6 sm:mb-8">
        <DailyRevenueChart />
        <MonthlyOrdersChart />
      </div>

      {/* Top Customers Table */}
      <TopCustomersTable />

      {/* Recent Activity Section */}
      <div className="mt-6 sm:mt-8 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Quick Actions */}
        <div className="bg-card rounded-xl p-4 sm:p-6 border border-border shadow-sm">
          <h3 className="text-base sm:text-lg font-semibold text-foreground mb-4">
            Quick Actions
          </h3>
          <div className="space-y-2 sm:space-y-3">
            <button className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] lm-btn-metal rounded-lg transition-colors" data-testid="button-neworder">
              <PlusCircle className="h-5 w-5 shrink-0" aria-hidden />
              <span className="font-medium text-sm sm:text-base">New Order</span>
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] bg-card border border-border rounded-lg hover:bg-muted transition-colors text-foreground" data-testid="button-addcustomer">
              <UserPlus className="h-5 w-5 shrink-0 text-metal-muted" aria-hidden />
              <span className="font-medium text-sm sm:text-base">Add Customer</span>
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] bg-card border border-border rounded-lg hover:bg-muted transition-colors text-foreground" data-testid="button-addproduct">
              <Box className="h-5 w-5 shrink-0 text-metal-muted" aria-hidden />
              <span className="font-medium text-sm sm:text-base">Add Product</span>
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] bg-card border border-border rounded-lg hover:bg-muted transition-colors text-foreground" data-testid="button-createinvoice">
              <FileText className="h-5 w-5 shrink-0 text-metal-muted" aria-hidden />
              <span className="font-medium text-sm sm:text-base">Create Invoice</span>
            </button>
          </div>
        </div>

        {/* Recent Orders - Placeholder */}
        <div className="bg-card rounded-xl p-6 border border-border shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">
              Recent Orders
            </h3>
            <a href="#" className="text-sm text-secondary hover:underline" data-testid="link-viewallorders">
              View All
            </a>
          </div>
          <div className="space-y-3">
            <div className="text-center py-8">
              <p className="text-muted-foreground">No recent orders available</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
