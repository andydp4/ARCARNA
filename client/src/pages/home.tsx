import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import AnalyticsDashboard from "@/components/analytics-dashboard";

export default function Home() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();

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

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  const userName = user?.firstName && user?.lastName 
    ? `${user.firstName} ${user.lastName}`
    : user?.email || "User";
  
  const userInitials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.email ? user.email.substring(0, 2).toUpperCase()
    : "U";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary border-b border-slate-700 sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo & Title */}
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-10 h-10 bg-accent rounded-lg">
                <i className="fas fa-cash-register text-xl text-white"></i>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Midnight EPOS</h1>
                <p className="text-xs text-slate-400">Real-time Analytics</p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              <a
                href="/"
                className="px-4 py-2 text-white bg-slate-700 rounded-lg font-medium text-sm"
                data-testid="link-analytics"
              >
                <i className="fas fa-chart-line mr-2"></i>Analytics
              </a>
              <a
                href="/reports"
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="link-reports"
              >
                <i className="fas fa-file-chart-line mr-2"></i>Reports
              </a>
              <a
                href="/pos"
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="link-pos"
              >
                <i className="fas fa-cash-register mr-2"></i>POS Terminal
              </a>
              <a
                href="/locations"
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="link-locations"
              >
                <i className="fas fa-map-marker-alt mr-2"></i>Locations
              </a>
              <a
                href="/inventory"
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="link-inventory"
              >
                <i className="fas fa-boxes mr-2"></i>Inventory
              </a>
              <a
                href="/loyalty"
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="link-loyalty"
              >
                <i className="fas fa-award mr-2"></i>Loyalty
              </a>
              <a
                href="/promotions"
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="link-promotions"
              >
                <i className="fas fa-gift mr-2"></i>Promotions
              </a>
              <a
                href="/expenses"
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="link-expenses"
              >
                <i className="fas fa-wallet mr-2"></i>Expenses
              </a>
              <a
                href="/expense-reports"
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="link-expense-reports"
              >
                <i className="fas fa-chart-pie mr-2"></i>Profit Analysis
              </a>
              <a
                href="#"
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="link-invoices"
              >
                <i className="fas fa-file-invoice mr-2"></i>Invoices
              </a>
            </nav>

            {/* User Menu */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-medium text-white" data-testid="text-username">
                  {userName}
                </p>
                <p className="text-xs text-slate-400" data-testid="text-userrole">
                  Administrator
                </p>
              </div>
              <div className="w-10 h-10 bg-gradient-to-br from-secondary to-accent rounded-full flex items-center justify-center text-white font-semibold shadow-lg">
                <span data-testid="text-userinitials">{userInitials}</span>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg font-medium text-sm transition-colors"
                data-testid="button-logout"
              >
                <i className="fas fa-sign-out-alt mr-2"></i>Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnalyticsDashboard />
      </main>

      {/* Footer */}
      <footer className="bg-card border-t border-border mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © 2024 Midnight EPOS. All rights reserved.
            </p>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">
                Documentation
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                Support
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                Privacy
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                Terms
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
