import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, DollarSign, ShoppingCart, Users, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

type BusinessHealth = {
  revenueToday: number;
  revenueRange: number;
  orderCountToday: number;
  orderCountRange: number;
  averageOrderValue: number;
  highRiskStockCount: number;
  deadStockCount: number;
  pendingApprovals: number;
  workerHealth: { status: string; deadLetter: number; queued: number };
  topProduct: { name: string; unitsSold: number } | null;
  newCustomers: number;
  rangeDays: number;
};

function money(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export function BusinessHealthSection() {
  const { data, isLoading } = useQuery<BusinessHealth>({
    queryKey: ["/api/business-health"],
    refetchInterval: 120000,
  });

  if (isLoading) {
    return (
      <div className="mb-8 animate-pulse h-32 bg-muted rounded-lg" data-testid="business-health-loading" />
    );
  }

  if (!data) return null;

  const workerOk = data.workerHealth.status === "healthy";

  return (
    <section className="mb-8" data-testid="business-health-section">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          Business health
        </h2>
        <Badge variant={workerOk ? "secondary" : "destructive"}>
          Workers: {data.workerHealth.status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Revenue today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{money(data.revenueToday)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Revenue ({data.rangeDays}d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{money(data.revenueRange)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <ShoppingCart className="h-3 w-3" /> Orders today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{data.orderCountToday}</p>
            <p className="text-xs text-muted-foreground">AOV {money(data.averageOrderValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" /> New customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{data.newCustomers}</p>
            <p className="text-xs text-muted-foreground">Last {data.rangeDays} days</p>
          </CardContent>
        </Card>
      </div>

      {(data.highRiskStockCount > 0 || data.deadStockCount > 0 || data.pendingApprovals > 0) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Risk highlights
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 text-sm">
            {data.highRiskStockCount > 0 && (
              <Link href="/inventory" className="underline-offset-4 hover:underline">
                {data.highRiskStockCount} high-risk stock item(s)
              </Link>
            )}
            {data.deadStockCount > 0 && (
              <Link href="/inventory" className="underline-offset-4 hover:underline">
                {data.deadStockCount} dead stock item(s)
              </Link>
            )}
            {data.pendingApprovals > 0 && (
              <Link href="/user-access" className="underline-offset-4 hover:underline">
                {data.pendingApprovals} pending approval(s)
              </Link>
            )}
            {data.workerHealth.deadLetter > 0 && (
              <span className="text-destructive">{data.workerHealth.deadLetter} dead letter(s)</span>
            )}
          </CardContent>
        </Card>
      )}

      {data.topProduct && (
        <p className="text-sm text-muted-foreground mt-3 flex items-center gap-1">
          <Package className="h-4 w-4" />
          Top product (30d): <strong className="text-foreground">{data.topProduct.name}</strong> (
          {data.topProduct.unitsSold} units)
        </p>
      )}
    </section>
  );
}
