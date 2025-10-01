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
import Reports from "@/pages/reports";
import Locations from "@/pages/locations";
import Loyalty from "@/pages/loyalty";
import Promotions from "@/pages/promotions";
import { ExpensesPage } from "@/pages/expenses";
import { ExpenseReportsPage } from "@/pages/expense-reports";
import Customers from "@/pages/customers";
import ProductManagement from "@/pages/product-management";
import Settings from "@/pages/settings";
import TickList from "@/pages/tick-list";
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
          <Route path="/inventory" component={Inventory} />
          <Route path="/products" component={ProductManagement} />
          <Route path="/reports" component={Reports} />
          <Route path="/locations" component={Locations} />
          <Route path="/customers" component={Customers} />
          <Route path="/loyalty" component={Loyalty} />
          <Route path="/promotions" component={Promotions} />
          <Route path="/expenses" component={ExpensesPage} />
          <Route path="/expense-reports" component={ExpenseReportsPage} />
          <Route path="/invoices" component={Home} />
          <Route path="/analytics" component={Home} />
          <Route path="/settings" component={Settings} />
          <Route path="/tick-list" component={TickList} />
        </Layout>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </NavigationProvider>
    </QueryClientProvider>
  );
}

export default App;
