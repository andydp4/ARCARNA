import { lazy, Suspense } from "react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { APP_BASE } from "@/lib/appPaths";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { OrgProvider } from "@/contexts/OrgContext";
import { AccessGate } from "@/components/AccessGate";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/useAuth";
import { AuthProviders } from "@/components/AuthProviders";
import { CommandPalette } from "@/components/CommandPalette";

// Route-level code splitting: each page ships as its own chunk, fetched on
// first navigation, instead of one ~1.5MB bundle loaded up front.
const Landing = lazy(() => import("@/pages/landing"));
const Home = lazy(() => import("@/pages/home"));
const POS = lazy(() => import("@/pages/pos"));
const Inventory = lazy(() => import("@/pages/inventory"));
const Insights = lazy(() => import("@/pages/insights"));
const Locations = lazy(() => import("@/pages/locations"));
const Loyalty = lazy(() => import("@/pages/loyalty"));
const Promotions = lazy(() => import("@/pages/promotions"));
const PromotionLiftPage = lazy(() => import("@/pages/promotions/lift"));
const ExpensesPage = lazy(() => import("@/pages/expenses").then((m) => ({ default: m.ExpensesPage })));
const ExpenseReportsPage = lazy(() => import("@/pages/expense-reports").then((m) => ({ default: m.ExpenseReportsPage })));
const Customers = lazy(() => import("@/pages/customers"));
const ProductManagement = lazy(() => import("@/pages/product-management"));
const Settings = lazy(() => import("@/pages/settings"));
const ReceiptSettingsPage = lazy(() => import("@/pages/settings/receipts"));
const LoyaltySettingsPage = lazy(() => import("@/pages/settings/loyalty"));
const DeveloperSettingsPage = lazy(() => import("@/pages/settings/developer"));
const TickList = lazy(() => import("@/pages/tick-list"));
const Invoices = lazy(() => import("@/pages/invoices"));
const Orders = lazy(() => import("@/pages/orders"));
const OrderRefundPage = lazy(() => import("@/pages/orders/refund"));
const ShiftsPage = lazy(() => import("@/pages/shifts"));
const GiftCardsPage = lazy(() => import("@/pages/gift-cards"));
const RfmAnalyticsPage = lazy(() => import("@/pages/analytics/rfm"));
const HourOfDayAnalyticsPage = lazy(() => import("@/pages/analytics/hour-of-day"));
const ChannelAttributionPage = lazy(() => import("@/pages/analytics/channels"));
const StockTurnAnalyticsPage = lazy(() => import("@/pages/analytics/stock-turn"));
const UserAccess = lazy(() => import("@/pages/user-access"));
const PendingApproval = lazy(() => import("@/pages/pending-approval"));
const Onboarding = lazy(() => import("@/pages/onboarding"));
const OnboardingWizard = lazy(() => import("@/pages/onboarding-wizard"));
const NoAccess = lazy(() => import("@/pages/no-access"));
const SetupWizard = lazy(() => import("@/pages/setup-wizard"));
const SetupBlocked = lazy(() => import("@/pages/setup-blocked"));
const WorkerLogs = lazy(() => import("@/pages/worker-logs"));
const RulesPage = lazy(() => import("@/pages/rules"));
const AuditLogsPage = lazy(() => import("@/pages/audit-logs"));
const ScheduledReportsPage = lazy(() => import("@/pages/scheduled-reports"));
const CashierPayrollPage = lazy(() => import("@/pages/cashier-payroll"));
const PurchaseDraftsPage = lazy(() => import("@/pages/purchase-drafts"));
const SignInPage = lazy(() => import("@/pages/sign-in"));
const SignOutPage = lazy(() => import("@/pages/sign-out"));

function RouteLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
    </div>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <WouterRouter base={APP_BASE}>
    <CommandPalette />
    <Suspense fallback={<RouteLoadingFallback />}>
    <Switch>
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/sign-out" component={SignOutPage} />
      <Route path="/pending-approval" component={PendingApproval} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/onboarding/wizard" component={OnboardingWizard} />
      <Route path="/no-access" component={NoAccess} />
      <Route path="/setup-wizard" component={SetupWizard} />
      <Route path="/setup-blocked" component={SetupBlocked} />
      {isLoading || !isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <AccessGate>
        <Layout>
          <Route path="/" component={Home} />
          <Route path="/create-order" component={POS} />
          <Route path="/pos"><Redirect to="/create-order" /></Route>
          <Route path="/open-orders" component={Orders} />
          <Route path="/orders"><Redirect to="/open-orders" /></Route>
          <Route path="/open-orders/:id/refund" component={OrderRefundPage} />
          <Route path="/orders/:id/refund">
            {(params) => <Redirect to={`/open-orders/${params.id}/refund`} />}
          </Route>
          <Route path="/shifts" component={ShiftsPage} />
          <Route path="/gift-cards" component={GiftCardsPage} />
          <Route path="/inventory" component={Inventory} />
          <Route path="/products" component={ProductManagement} />
          <Route path="/insights" component={Insights} />
          <Route path="/reports"><Redirect to="/insights" /></Route>
          <Route path="/analytics"><Redirect to="/insights" /></Route>
          <Route path="/analytics/rfm" component={RfmAnalyticsPage} />
          <Route path="/analytics/hour-of-day" component={HourOfDayAnalyticsPage} />
          <Route path="/analytics/channels" component={ChannelAttributionPage} />
          <Route path="/analytics/stock-turn" component={StockTurnAnalyticsPage} />
          <Route path="/locations" component={Locations} />
          <Route path="/customers" component={Customers} />
          <Route path="/loyalty" component={Loyalty} />
          <Route path="/promotions" component={Promotions} />
          <Route path="/promotions/:id/lift" component={PromotionLiftPage} />
          <Route path="/expenses" component={ExpensesPage} />
          <Route path="/expense-reports" component={ExpenseReportsPage} />
          <Route path="/invoices" component={Invoices} />
          <Route path="/settings" component={Settings} />
          <Route path="/settings/receipts" component={ReceiptSettingsPage} />
          <Route path="/settings/loyalty" component={LoyaltySettingsPage} />
          <Route path="/settings/developer" component={DeveloperSettingsPage} />
          <Route path="/tick-list" component={TickList} />
          <Route path="/user-access" component={UserAccess} />
          <Route path="/worker-logs" component={WorkerLogs} />
          <Route path="/audit-logs" component={AuditLogsPage} />
          <Route path="/rules" component={RulesPage} />
          <Route path="/scheduled-reports" component={ScheduledReportsPage} />
          <Route path="/cashier-payroll" component={CashierPayrollPage} />
          <Route path="/purchase-drafts" component={PurchaseDraftsPage} />
        </Layout>
        </AccessGate>
      )}
      <Route component={NotFound} />
    </Switch>
    </Suspense>
    </WouterRouter>
  );
}

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineIndicator } from "@/components/offline-indicator";

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProviders>
        <NavigationProvider>
          <OrgProvider>
          <TooltipProvider>
            <Toaster />
            <OfflineIndicator />
            <Router />
          </TooltipProvider>
          </OrgProvider>
        </NavigationProvider>
        </AuthProviders>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
