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
import Landing from "@/pages/landing";
import Home from "@/pages/home";
import POS from "@/pages/pos";
import Inventory from "@/pages/inventory";
import Insights from "@/pages/insights";
import Locations from "@/pages/locations";
import Loyalty from "@/pages/loyalty";
import Promotions from "@/pages/promotions";
import PromotionLiftPage from "@/pages/promotions/lift";
import { ExpensesPage } from "@/pages/expenses";
import { ExpenseReportsPage } from "@/pages/expense-reports";
import Customers from "@/pages/customers";
import ProductManagement from "@/pages/product-management";
import Settings from "@/pages/settings";
import ReceiptSettingsPage from "@/pages/settings/receipts";
import LoyaltySettingsPage from "@/pages/settings/loyalty";
import DeveloperSettingsPage from "@/pages/settings/developer";
import TickList from "@/pages/tick-list";
import Invoices from "@/pages/invoices";
import Orders from "@/pages/orders";
import OrderRefundPage from "@/pages/orders/refund";
import ShiftsPage from "@/pages/shifts";
import GiftCardsPage from "@/pages/gift-cards";
import RfmAnalyticsPage from "@/pages/analytics/rfm";
import HourOfDayAnalyticsPage from "@/pages/analytics/hour-of-day";
import ChannelAttributionPage from "@/pages/analytics/channels";
import StockTurnAnalyticsPage from "@/pages/analytics/stock-turn";
import UserAccess from "@/pages/user-access";
import PendingApproval from "@/pages/pending-approval";
import Onboarding from "@/pages/onboarding";
import OnboardingWizard from "@/pages/onboarding-wizard";
import NoAccess from "@/pages/no-access";
import SetupWizard from "@/pages/setup-wizard";
import SetupBlocked from "@/pages/setup-blocked";
import WorkerLogs from "@/pages/worker-logs";
import RulesPage from "@/pages/rules";
import AuditLogsPage from "@/pages/audit-logs";
import ScheduledReportsPage from "@/pages/scheduled-reports";
import CashierPayrollPage from "@/pages/cashier-payroll";
import PurchaseDraftsPage from "@/pages/purchase-drafts";
import { useAuth } from "@/hooks/useAuth";
import { AuthProviders } from "@/components/AuthProviders";
import SignInPage from "@/pages/sign-in";
import SignOutPage from "@/pages/sign-out";
import { CommandPalette } from "@/components/CommandPalette";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <WouterRouter base={APP_BASE}>
    <CommandPalette />
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
