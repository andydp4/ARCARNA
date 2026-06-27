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
import { PageHeader } from "@/components/PageHeader";
import {
  ShoppingCart,
  PlusCircle,
  Boxes,
  Users,
  Award,
  TrendingUp,
  Wallet,
  PieChart,
  Gift,
  MapPin,
} from "lucide-react";

const QUICK_ACTIONS = [
  { href: "/create-order", icon: ShoppingCart, title: "Create Order", description: "Process sales & orders", testId: "quick-action-pos" },
  { href: "/products", icon: PlusCircle, title: "Add Product", description: "Create a new catalog item", testId: "quick-action-add-product" },
  { href: "/inventory", icon: Boxes, title: "Inventory", description: "Manage products & stock", testId: "quick-action-inventory" },
  { href: "/customers", icon: Users, title: "Customers", description: "Manage customer database", testId: "quick-action-customers" },
  { href: "/loyalty", icon: Award, title: "Loyalty", description: "Rewards & tiers", testId: "quick-action-loyalty" },
  { href: "/reports", icon: TrendingUp, title: "Evidence", description: "Charts & trends", testId: "quick-action-reports" },
  { href: "/expenses", icon: Wallet, title: "Expenses", description: "Track business costs", testId: "quick-action-expenses" },
  { href: "/expense-reports", icon: PieChart, title: "Profit Analysis", description: "Margins & profit", testId: "quick-action-profit" },
  { href: "/promotions", icon: Gift, title: "Promotions", description: "Sales & discounts", testId: "quick-action-promotions" },
  { href: "/locations", icon: MapPin, title: "Locations", description: "Multi-store management", testId: "quick-action-locations" },
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
        <PageHeader
          title="Control Centre"
          question="How is your business doing today?"
          explanation="Today's takings, profit signal, and what needs your attention."
        />
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
                icon={action.icon}
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
