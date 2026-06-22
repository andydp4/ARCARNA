import { useAuth } from "@/hooks/useAuth";
import { resolveApiUrl } from "@/lib/appPaths";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import AnalyticsDashboard from "@/components/analytics-dashboard";
import { BusinessHealthSection } from "@/components/BusinessHealthSection";
import { DailyKpiCard } from "@/components/dashboard/DailyKpiCard";
import { QuickActionCard } from "@/components/dashboard/QuickActionCard";
import { OnboardingResumeBanner } from "@/components/OnboardingResumeBanner";
import { ActivityTimeline } from "@/components/activity-timeline";
import { Skeleton } from "@/components/Skeleton";

const QUICK_ACTIONS = [
  { href: "/create-order", icon: "fas fa-cash-register", title: "Create Order", description: "Process sales & orders", testId: "quick-action-pos" },
  { href: "/products", icon: "fas fa-plus-circle", title: "Add Product", description: "Create a new catalog item", testId: "quick-action-add-product" },
  { href: "/inventory", icon: "fas fa-boxes", title: "Inventory", description: "Manage products & stock", testId: "quick-action-inventory" },
  { href: "/customers", icon: "fas fa-users", title: "Customers", description: "Manage customer database", testId: "quick-action-customers" },
  { href: "/loyalty", icon: "fas fa-award", title: "Loyalty", description: "Rewards & tiers", testId: "quick-action-loyalty" },
  { href: "/reports", icon: "fas fa-chart-line", title: "Reports", description: "Analytics & insights", testId: "quick-action-reports" },
  { href: "/expenses", icon: "fas fa-wallet", title: "Expenses", description: "Track business costs", testId: "quick-action-expenses" },
  { href: "/expense-reports", icon: "fas fa-chart-pie", title: "Profit Analysis", description: "Financial reports", testId: "quick-action-profit" },
  { href: "/promotions", icon: "fas fa-gift", title: "Promotions", description: "Sales & discounts", testId: "quick-action-promotions" },
  { href: "/locations", icon: "fas fa-map-marker-alt", title: "Locations", description: "Multi-store management", testId: "quick-action-locations" },
] as const;

export default function Home() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = resolveApiUrl("/api/login");
      }, 500);
    }
  }, [isAuthenticated, isLoading, toast]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <Skeleton variant="card" count={2} />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <OnboardingResumeBanner />
        <DailyKpiCard />
        <BusinessHealthSection />

        <div className="mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-semibold text-metal-warm-white mb-4 sm:mb-6">
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {QUICK_ACTIONS.map((action) => (
              <QuickActionCard
                key={action.href}
                href={action.href}
                iconClass={action.icon}
                title={action.title}
                description={action.description}
                testId={action.testId}
              />
            ))}
          </div>
        </div>

        <div className="mt-12 mb-8">
          <h2 className="text-2xl font-semibold text-metal-warm-white mb-4">Recent activity</h2>
          <ActivityTimeline limit={15} />
        </div>

        <div className="mt-12">
          <h2 className="text-2xl font-semibold text-metal-warm-white mb-6">Analytics Overview</h2>
          <AnalyticsDashboard />
        </div>
      </div>
    </div>
  );
}
