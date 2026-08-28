import { useAuth } from "@/hooks/useAuth";
import { resolveApiUrl } from "@/lib/appPaths";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import AnalyticsDashboard from "@/components/analytics-dashboard";
import { ControlCentreGreeting } from "@/components/dashboard/ControlCentreGreeting";
import { ControlCentreToday } from "@/components/dashboard/ControlCentreToday";
import { QuickActionCard } from "@/components/dashboard/QuickActionCard";
import { OperationsSnapshot } from "@/components/dashboard/OperationsSnapshot";
import { ControlCentreBackdrop } from "@/components/dashboard/ControlCentreBackdrop";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { NextMoves } from "@/components/dashboard/NextMoves";
import { BusinessSignals } from "@/components/dashboard/BusinessSignals";
import { BestReports } from "@/components/dashboard/BestReports";
import { OnboardingResumeBanner } from "@/components/OnboardingResumeBanner";
import { ActivityTimeline } from "@/components/activity-timeline";
import { Skeleton } from "@/components/Skeleton";
import { PageHeader } from "@/components/PageHeader";
import { ChevronDown } from "lucide-react";
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

/**
 * A collapsed section. <details>/<summary> rather than state plus a button: it
 * is open/closed without JavaScript, keyboard-operable for free, and announces
 * its expanded state to a screen reader without any aria- plumbing to keep in
 * sync.
 */
function Disclosure({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <details className="group mt-8 border-t border-border pt-6" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xl font-semibold text-metal-warm-white marker:hidden [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="pt-6">{children}</div>
    </details>
  );
}

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
    /* `isolate` is load-bearing, not decoration. ControlCentreBackdrop sits at
       -z-10, and Layout's root carries an opaque bg-background; without a
       stacking context here the backdrop paints behind that background and is
       invisible. Removing `isolate` silently hides it. */
    <div className="relative isolate w-full overflow-x-clip">
      <ControlCentreBackdrop />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* The hero zone. ControlCentreBackdrop reserves a 420px band for the
            sphere; this wrapper guarantees the page's content clears it with
            room rather than an opaque card starting partway down and hiding
            most of the animation — which is what a KPI card sitting right
            under the header used to do. min-height (not a fixed height) so a
            long onboarding banner or wrapped header text still fits; the flex
            column with a trailing greeting line keeps the visible sphere
            uncluttered near its centre regardless of how tall the header
            turns out to be. */}
        <div className="flex min-h-[440px] flex-col justify-between">
          <div>
            <PageHeader
              title="Control Centre"
              question="How is your business doing today?"
              explanation="Today's takings, profit signal, and what needs your attention."
            />
            <OnboardingResumeBanner />
          </div>
          <ControlCentreGreeting />
        </div>

        <div className="mt-2">
          <ControlCentreToday />
        </div>

        <div className="mt-6">
          <OperationsSnapshot />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RecentOrders />
          <div className="flex flex-col gap-6">
            <NextMoves />
            <BusinessSignals />
          </div>
        </div>

        <div className="mt-6">
          <BestReports />
        </div>

        {/* Promoted out of a disclosure — the primary way to act on this page,
            so it should not need a click just to appear. */}
        <section className="mt-8" data-testid="section-quick-actions">
          <h2 className="mb-4 text-xl font-semibold text-metal-warm-white sm:text-2xl">Quick actions</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
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
        </section>

        <Disclosure title="Recent activity" testId="section-recent-activity">
          <ActivityTimeline limit={15} />
        </Disclosure>

        <Disclosure title="Truths overview" testId="section-truths-overview">
          <AnalyticsDashboard />
        </Disclosure>
      </div>
    </div>
  );
}
