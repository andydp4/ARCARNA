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
import { RequireRole } from "@/components/RequireRole";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/useAuth";
import { AuthProviders } from "@/components/AuthProviders";
import { CommandPalette } from "@/components/CommandPalette";
import {
  WmSuppliesHomePage,
  WmSuppliesOrderPage,
  WmSuppliesOrderSuccessPage,
} from "@/features/wm-supplies/WmSuppliesPublicSite";

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
const WmSuppliesWebsiteSettingsPage = lazy(() => import("@/pages/settings/wm-supplies-website"));
const DeveloperSettingsPage = lazy(() => import("@/pages/settings/developer"));
const TickList = lazy(() => import("@/pages/tick-list"));
const Invoices = lazy(() => import("@/pages/invoices"));
const Orders = lazy(() => import("@/pages/orders"));
const OrderRefundPage = lazy(() => import("@/pages/orders/refund"));
const ShiftsPage = lazy(() => import("@/pages/shifts"));
const GiftCardsPage = lazy(() => import("@/pages/gift-cards"));
const ReportsHub = lazy(() => import("@/pages/reports/index"));
const ResellerPartnersPage = lazy(() => import("@/pages/reseller-partners"));
const DailySalesReport = lazy(() => import("@/pages/reports/daily-sales"));
const CurrentStockReport = lazy(() => import("@/pages/reports/current-stock"));
const WeeklySalesReport = lazy(() => import("@/pages/reports/weekly-sales"));
const WeeklyMarginReport = lazy(() => import("@/pages/reports/weekly-margin"));
const LapseRetentionReport = lazy(() => import("@/pages/reports/lapse-retention"));
const ClvReport = lazy(() => import("@/pages/reports/clv"));
const StockRunwayReport = lazy(() => import("@/pages/reports/stock-runway"));
const RfmReport = lazy(() => import("@/pages/reports/rfm"));
const ChurnRiskReport = lazy(() => import("@/pages/reports/churn-risk"));
const AffinityReport = lazy(() => import("@/pages/reports/affinity"));
const OrderStatusReport = lazy(() => import("@/pages/reports/order-status"));
const DelayLogReport = lazy(() => import("@/pages/reports/delay-log"));
const StaffKpiReport = lazy(() => import("@/pages/reports/staff-kpi"));
const SatisfactionReport = lazy(() => import("@/pages/reports/satisfaction"));
const ResellerCreditReport = lazy(() => import("@/pages/reports/reseller-credit"));
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
  const { isAuthenticated, isLoading, error: authError, user } = useAuth();
  const isCustomerOnly = user?.role === "CUSTOMER";
  const isWmSuppliesCustomerSite = import.meta.env.VITE_WM_SUPPLIES_CUSTOMER_SITE === "1";

  if (isWmSuppliesCustomerSite) {
    return (
      <WouterRouter base={APP_BASE}>
      <Switch>
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-out" component={SignOutPage} />
        <Route path="/order" component={WmSuppliesOrderPage} />
        <Route path="/order/success" component={WmSuppliesOrderSuccessPage} />
        <Route path="/pending-approval" component={PendingApproval} />
        <Route path="/no-access" component={NoAccess} />
        <Route path="/" component={WmSuppliesHomePage} />
        <Route component={NotFound} />
      </Switch>
      </WouterRouter>
    );
  }

  return (
    <WouterRouter base={APP_BASE}>
    <CommandPalette />
    <Suspense fallback={<RouteLoadingFallback />}>
    <Switch>
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/sign-out" component={SignOutPage} />
      <Route path="/order" component={WmSuppliesOrderPage} />
      <Route path="/order/success" component={WmSuppliesOrderSuccessPage} />
      <Route path="/pending-approval" component={PendingApproval} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/onboarding/wizard" component={OnboardingWizard} />
      <Route path="/no-access" component={NoAccess} />
      <Route path="/setup-wizard" component={SetupWizard} />
      <Route path="/setup-blocked" component={SetupBlocked} />
      {/* Arcarna's own front door. #131 replaced this with the WM Supplies
          storefront, so a signed-out visitor to the Arcarna domain was met by
          the shop's padlock gate instead of the Arcarna sign-in. The customer
          site serves that page from its own branch above, on its own domain
          and its own process — it does not belong here.

          A signed-in CUSTOMER is the one exception: they are a website
          customer with nothing to do in Arcarna, so the shop is the right
          place to put them. */}
      {isCustomerOnly ? (
        <Route path="/" component={WmSuppliesHomePage} />
      ) : isLoading || !isAuthenticated ? (
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
          <Route path="/gift-cards">
            <RequireRole href="/gift-cards"><GiftCardsPage /></RequireRole>
          </Route>
          <Route path="/inventory">
            <RequireRole href="/inventory"><Inventory /></RequireRole>
          </Route>
          <Route path="/products">
            <RequireRole href="/products"><ProductManagement /></RequireRole>
          </Route>
          <Route path="/insights">
            <RequireRole href="/insights"><Insights /></RequireRole>
          </Route>
          <Route path="/reports">
            <RequireRole href="/reports"><ReportsHub /></RequireRole>
          </Route>
          <Route path="/reseller-partners">
            <RequireRole href="/reseller-partners"><ResellerPartnersPage /></RequireRole>
          </Route>
          {/* The individual report pages below are reached only through
              /reports (Reports Hub, gated above) — they carry no nav item and
              no server-side per-report role check of their own
              (server/routes/reports.ts), so a direct URL visit is gated the
              same as the hub itself rather than left open. */}
          <Route path="/reports/daily-sales">
            <RequireRole href="/reports"><DailySalesReport /></RequireRole>
          </Route>
          <Route path="/reports/current-stock">
            <RequireRole href="/reports"><CurrentStockReport /></RequireRole>
          </Route>
          <Route path="/reports/weekly-sales">
            <RequireRole href="/reports"><WeeklySalesReport /></RequireRole>
          </Route>
          <Route path="/reports/weekly-margin">
            <RequireRole href="/reports"><WeeklyMarginReport /></RequireRole>
          </Route>
          <Route path="/reports/lapse-retention">
            <RequireRole href="/reports"><LapseRetentionReport /></RequireRole>
          </Route>
          <Route path="/reports/clv">
            <RequireRole href="/reports"><ClvReport /></RequireRole>
          </Route>
          <Route path="/reports/stock-runway">
            <RequireRole href="/reports"><StockRunwayReport /></RequireRole>
          </Route>
          <Route path="/reports/rfm">
            <RequireRole href="/reports"><RfmReport /></RequireRole>
          </Route>
          <Route path="/reports/churn-risk">
            <RequireRole href="/reports"><ChurnRiskReport /></RequireRole>
          </Route>
          <Route path="/reports/affinity">
            <RequireRole href="/reports"><AffinityReport /></RequireRole>
          </Route>
          <Route path="/reports/order-status">
            <RequireRole href="/reports"><OrderStatusReport /></RequireRole>
          </Route>
          <Route path="/reports/delay-log">
            <RequireRole href="/reports"><DelayLogReport /></RequireRole>
          </Route>
          <Route path="/reports/staff-kpi">
            <RequireRole href="/reports"><StaffKpiReport /></RequireRole>
          </Route>
          <Route path="/reports/satisfaction">
            <RequireRole href="/reports"><SatisfactionReport /></RequireRole>
          </Route>
          <Route path="/reports/reseller-credit">
            <RequireRole href="/reports"><ResellerCreditReport /></RequireRole>
          </Route>
          <Route path="/analytics"><Redirect to="/insights" /></Route>
          <Route path="/analytics/rfm">
            <RequireRole href="/analytics/rfm"><RfmAnalyticsPage /></RequireRole>
          </Route>
          <Route path="/analytics/hour-of-day">
            <RequireRole href="/analytics/hour-of-day"><HourOfDayAnalyticsPage /></RequireRole>
          </Route>
          <Route path="/analytics/channels">
            <RequireRole href="/analytics/channels"><ChannelAttributionPage /></RequireRole>
          </Route>
          <Route path="/analytics/stock-turn">
            <RequireRole href="/analytics/stock-turn"><StockTurnAnalyticsPage /></RequireRole>
          </Route>
          <Route path="/locations">
            <RequireRole href="/locations"><Locations /></RequireRole>
          </Route>
          <Route path="/customers">
            <RequireRole href="/customers"><Customers /></RequireRole>
          </Route>
          <Route path="/loyalty">
            <RequireRole href="/loyalty"><Loyalty /></RequireRole>
          </Route>
          <Route path="/promotions">
            <RequireRole href="/promotions"><Promotions /></RequireRole>
          </Route>
          <Route path="/promotions/:id/lift">
            <RequireRole href="/promotions/:id/lift"><PromotionLiftPage /></RequireRole>
          </Route>
          <Route path="/expenses">
            <RequireRole href="/expenses"><ExpensesPage /></RequireRole>
          </Route>
          <Route path="/expense-reports">
            <RequireRole href="/expense-reports"><ExpenseReportsPage /></RequireRole>
          </Route>
          <Route path="/invoices" component={Invoices} />
          <Route path="/settings" component={Settings} />
          <Route path="/settings/receipts">
            <RequireRole href="/settings/receipts"><ReceiptSettingsPage /></RequireRole>
          </Route>
          <Route path="/settings/loyalty">
            <RequireRole href="/settings/loyalty"><LoyaltySettingsPage /></RequireRole>
          </Route>
          <Route path="/settings/developer">
            <RequireRole href="/settings/developer"><DeveloperSettingsPage /></RequireRole>
          </Route>
          <Route path="/settings/wm-supplies-website" component={WmSuppliesWebsiteSettingsPage} />
          <Route path="/admin/wm-supplies/website" component={WmSuppliesWebsiteSettingsPage} />
          <Route path="/tick-list" component={TickList} />
          <Route path="/user-access">
            <RequireRole href="/user-access"><UserAccess /></RequireRole>
          </Route>
          <Route path="/worker-logs">
            <RequireRole href="/worker-logs"><WorkerLogs /></RequireRole>
          </Route>
          <Route path="/audit-logs">
            <RequireRole href="/audit-logs"><AuditLogsPage /></RequireRole>
          </Route>
          <Route path="/rules">
            <RequireRole href="/rules"><RulesPage /></RequireRole>
          </Route>
          <Route path="/scheduled-reports">
            <RequireRole href="/scheduled-reports"><ScheduledReportsPage /></RequireRole>
          </Route>
          <Route path="/cashier-payroll">
            <RequireRole href="/cashier-payroll"><CashierPayrollPage /></RequireRole>
          </Route>
          <Route path="/purchase-drafts">
            <RequireRole href="/purchase-drafts"><PurchaseDraftsPage /></RequireRole>
          </Route>
        </Layout>
        </AccessGate>
      )}
      {/* While auth is unresolved the router has not yet been given the
          authenticated routes, so every real page falls through to here.
          Saying "this route does not exist" about a page that does is worse
          than saying nothing — wait, then answer.

          An errored auth query counts as unresolved. A 401 is not an error:
          it comes back as a null user, which is a real answer and lands on
          the public site. An error means we could not ask — a 429 from the
          rate limiter, a 5xx, a dropped connection — and not knowing who you
          are is never grounds for telling you your page does not exist. */}
      <Route component={isLoading || authError ? RouteLoadingFallback : NotFound} />
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
