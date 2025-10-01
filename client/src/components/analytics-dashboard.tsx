import { useQuery } from "@tanstack/react-query";
import MetricCard from "./metric-card";
import DailyRevenueChart from "./daily-revenue-chart";
import MonthlyOrdersChart from "./monthly-orders-chart";
import TopCustomersTable from "./top-customers-table";
import { Skeleton } from "@/components/ui/skeleton";

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
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-foreground mb-2">
          Analytics Dashboard
        </h2>
        <p className="text-muted-foreground">
          Real-time insights into your business performance
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {isLoadingMonthly ? (
          <>
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </>
        ) : (
          <>
            <MetricCard
              title="Total Revenue"
              value={`$${totalRevenue.toLocaleString()}`}
              change="+12.5%"
              icon="dollar-sign"
              iconColor="secondary"
              subtitle="Last 30 days"
            />
            <MetricCard
              title="Total Orders"
              value={totalOrders.toLocaleString()}
              change="+8.2%"
              icon="shopping-bag"
              iconColor="accent"
              subtitle="Last 30 days"
            />
            <MetricCard
              title="Active Customers"
              value="847"
              change="+24.3%"
              icon="users"
              iconColor="purple-500"
              subtitle="Last 30 days"
            />
            <MetricCard
              title="Avg Order Value"
              value={`$${avgOrderValue.toFixed(2)}`}
              change="+3.7%"
              icon="chart-line"
              iconColor="orange-500"
              subtitle="Last 30 days"
            />
          </>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <DailyRevenueChart />
        <MonthlyOrdersChart />
      </div>

      {/* Top Customers Table */}
      <TopCustomersTable />

      {/* Recent Activity Section */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="bg-card rounded-xl p-6 border border-border shadow-sm">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Quick Actions
          </h3>
          <div className="space-y-3">
            <button className="w-full flex items-center gap-3 px-4 py-3 bg-secondary text-white rounded-lg hover:bg-blue-600 transition-colors" data-testid="button-neworder">
              <i className="fas fa-plus-circle text-xl"></i>
              <span className="font-medium">New Order</span>
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-lg hover:bg-muted transition-colors text-foreground" data-testid="button-addcustomer">
              <i className="fas fa-user-plus text-xl text-accent"></i>
              <span className="font-medium">Add Customer</span>
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-lg hover:bg-muted transition-colors text-foreground" data-testid="button-addproduct">
              <i className="fas fa-box text-xl text-orange-500"></i>
              <span className="font-medium">Add Product</span>
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-lg hover:bg-muted transition-colors text-foreground" data-testid="button-createinvoice">
              <i className="fas fa-file-invoice text-xl text-purple-500"></i>
              <span className="font-medium">Create Invoice</span>
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
