import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavigationProvider } from "@/contexts/NavigationContext";
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
import { ExpensesPage } from "@/pages/expenses";
import { ExpenseReportsPage } from "@/pages/expense-reports";
import Customers from "@/pages/customers";
import ProductManagement from "@/pages/product-management";
import Settings from "@/pages/settings";
import TickList from "@/pages/tick-list";
import Invoices from "@/pages/invoices";
import Orders from "@/pages/orders";
import { useAuth } from "@/hooks/useAuth";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      {isLoading || !isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <Layout>
          <Route path="/" component={Home} />
          <Route path="/pos" component={POS} />
          <Route path="/orders" component={Orders} />
          <Route path="/inventory" component={Inventory} />
          <Route path="/products" component={ProductManagement} />
          <Route path="/insights" component={Insights} />
          <Route path="/reports" component={Insights} />
          <Route path="/analytics" component={Insights} />
          <Route path="/locations" component={Locations} />
          <Route path="/customers" component={Customers} />
          <Route path="/loyalty" component={Loyalty} />
          <Route path="/promotions" component={Promotions} />
          <Route path="/expenses" component={ExpensesPage} />
          <Route path="/expense-reports" component={ExpenseReportsPage} />
          <Route path="/invoices" component={Invoices} />
          <Route path="/settings" component={Settings} />
          <Route path="/tick-list" component={TickList} />
        </Layout>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineIndicator } from "@/components/offline-indicator";

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <NavigationProvider>
          <TooltipProvider>
            <Toaster />
            <OfflineIndicator />
            <Router />
          </TooltipProvider>
        </NavigationProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
