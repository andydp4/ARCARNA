import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import { Link } from "wouter";
import AnalyticsDashboard from "@/components/analytics-dashboard";

export default function Home() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-secondary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Quick Actions Grid */}
        <div className="mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-4 sm:mb-6">Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* POS Terminal */}
            <Link 
              href="/pos"
              className="group"
              data-testid="quick-action-pos"
            >
              <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-4 sm:p-6 transition-all duration-200 transform hover:scale-105 min-h-[140px] flex flex-col justify-center">
                <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-blue-500/10 rounded-lg mb-3 sm:mb-4">
                  <i className="fas fa-cash-register text-xl sm:text-2xl text-blue-500"></i>
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-foreground mb-1 sm:mb-2">POS Terminal</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">Process sales & orders</p>
              </div>
            </Link>

            {/* Add product */}
            <Link
              href="/products"
              className="group"
              data-testid="quick-action-add-product"
            >
              <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-4 sm:p-6 transition-all duration-200 transform hover:scale-105 min-h-[140px] flex flex-col justify-center">
                <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-violet-500/10 rounded-lg mb-3 sm:mb-4">
                  <i className="fas fa-plus-circle text-xl sm:text-2xl text-violet-500"></i>
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-foreground mb-1 sm:mb-2">Add Product</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">Create a new catalog item</p>
              </div>
            </Link>

            {/* Inventory */}
            <Link 
              href="/inventory"
              className="group"
              data-testid="quick-action-inventory"
            >
              <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-6 transition-all duration-200 transform hover:scale-105">
                <div className="flex items-center justify-center w-12 h-12 bg-green-500/10 rounded-lg mb-4">
                  <i className="fas fa-boxes text-2xl text-green-500"></i>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Inventory</h3>
                <p className="text-sm text-muted-foreground">Manage products & stock</p>
              </div>
            </Link>

            {/* Customers */}
            <Link 
              href="/customers"
              className="group"
              data-testid="quick-action-customers"
            >
              <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-6 transition-all duration-200 transform hover:scale-105">
                <div className="flex items-center justify-center w-12 h-12 bg-pink-500/10 rounded-lg mb-4">
                  <i className="fas fa-users text-2xl text-pink-500"></i>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Customers</h3>
                <p className="text-sm text-muted-foreground">Manage customer database</p>
              </div>
            </Link>

            {/* Loyalty */}
            <Link 
              href="/loyalty"
              className="group"
              data-testid="quick-action-loyalty"
            >
              <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-6 transition-all duration-200 transform hover:scale-105">
                <div className="flex items-center justify-center w-12 h-12 bg-cyan-500/10 rounded-lg mb-4">
                  <i className="fas fa-award text-2xl text-cyan-500"></i>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Loyalty</h3>
                <p className="text-sm text-muted-foreground">Rewards & tiers</p>
              </div>
            </Link>

            {/* Reports */}
            <Link 
              href="/reports"
              className="group"
              data-testid="quick-action-reports"
            >
              <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-6 transition-all duration-200 transform hover:scale-105">
                <div className="flex items-center justify-center w-12 h-12 bg-purple-500/10 rounded-lg mb-4">
                  <i className="fas fa-chart-line text-2xl text-purple-500"></i>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Reports</h3>
                <p className="text-sm text-muted-foreground">Analytics & insights</p>
              </div>
            </Link>

            {/* Expenses */}
            <Link 
              href="/expenses"
              className="group"
              data-testid="quick-action-expenses"
            >
              <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-6 transition-all duration-200 transform hover:scale-105">
                <div className="flex items-center justify-center w-12 h-12 bg-red-500/10 rounded-lg mb-4">
                  <i className="fas fa-wallet text-2xl text-red-500"></i>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Expenses</h3>
                <p className="text-sm text-muted-foreground">Track business costs</p>
              </div>
            </Link>

            {/* Profit Analysis */}
            <Link 
              href="/expense-reports"
              className="group"
              data-testid="quick-action-profit"
            >
                <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-6 transition-all duration-200 transform hover:scale-105">
                  <div className="flex items-center justify-center w-12 h-12 bg-indigo-500/10 rounded-lg mb-4">
                    <i className="fas fa-chart-pie text-2xl text-indigo-500"></i>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">Profit Analysis</h3>
                  <p className="text-sm text-muted-foreground">Financial reports</p>
                </div>
            </Link>

            {/* Promotions */}
            <Link 
              href="/promotions"
              className="group"
              data-testid="quick-action-promotions"
            >
              <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-6 transition-all duration-200 transform hover:scale-105">
                <div className="flex items-center justify-center w-12 h-12 bg-yellow-500/10 rounded-lg mb-4">
                  <i className="fas fa-gift text-2xl text-yellow-500"></i>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Promotions</h3>
                <p className="text-sm text-muted-foreground">Sales & discounts</p>
              </div>
            </Link>

            {/* Locations */}
            <Link 
              href="/locations"
              className="group"
              data-testid="quick-action-locations"
            >
              <div className="bg-card hover:bg-accent/10 border border-border hover:border-accent rounded-lg p-6 transition-all duration-200 transform hover:scale-105">
                <div className="flex items-center justify-center w-12 h-12 bg-orange-500/10 rounded-lg mb-4">
                  <i className="fas fa-map-marker-alt text-2xl text-orange-500"></i>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Locations</h3>
                <p className="text-sm text-muted-foreground">Multi-store management</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Analytics Dashboard */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">Analytics Overview</h2>
          <AnalyticsDashboard />
        </div>
      </div>
    </div>
  );
}