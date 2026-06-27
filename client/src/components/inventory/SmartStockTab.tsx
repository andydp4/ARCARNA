import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, AlertTriangle, Package, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";

type SmartStockResponse = {
  windowDays: number;
  items: {
    productId: string;
    sku: string;
    name: string;
    stock: number;
    unitsSoldWindow: number;
    velocityPerDay: number;
    daysToDepletionLabel: string;
    deadStock: boolean;
    reorderNote: string | null;
    riskLevel: string;
    anomalyNegativeStock: boolean;
  }[];
  summary: {
    highRiskCount: number;
    deadStockCount: number;
    negativeStockCount: number;
    bestSellers: { name: string; sku: string; unitsSold: number }[];
    slowestSellers: { name: string; sku: string; unitsSold: number }[];
  };
};

function riskBadge(level: string) {
  const v =
    level === "critical"
      ? "destructive"
      : level === "high"
        ? "destructive"
        : level === "medium"
          ? "secondary"
          : "outline";
  return <Badge variant={v as "destructive" | "secondary" | "outline"}>{level}</Badge>;
}

export function SmartStockTab() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery<SmartStockResponse>({
    queryKey: ["/api/inventory/smart-stock?windowDays=30"],
  });

  if (isLoading) {
    return <p className="text-center py-12 text-muted-foreground">Loading smart stock intelligence…</p>;
  }

  if (!data?.items?.length) {
    return (
      <EmptyState
        icon={Package}
        title="No products to analyse yet"
        body="Add products to your catalogue to see velocity, reorder suggestions, and risk scores."
        cta={{ label: "Add products", href: "/products" }}
      />
    );
  }

  const filtered = data.items.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.sku.toLowerCase().includes(search.toLowerCase()),
  );

  const recommendations = data.items.filter((i) => i.reorderNote).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">High risk</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-600">{data.summary.highRiskCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Dead stock</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.summary.deadStockCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Negative stock</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">{data.summary.negativeStockCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Window</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.windowDays}d</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Best sellers
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {data.summary.bestSellers.length === 0 ? (
              <p className="text-muted-foreground">No sales in window</p>
            ) : (
              data.summary.bestSellers.map((b) => (
                <p key={b.sku}>
                  {b.name} <span className="text-muted-foreground">({b.unitsSold} sold)</span>
                </p>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-amber-600" />
              Slowest movers
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {data.summary.slowestSellers.map((b) => (
              <p key={b.sku}>
                {b.name} <span className="text-muted-foreground">({b.unitsSold} sold)</span>
              </p>
            ))}
          </CardContent>
        </Card>
      </div>

      {recommendations.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Recommendations
            </CardTitle>
            <CardDescription>Based on completed orders in the last {data.windowDays} days</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {recommendations.map((r) => (
              <div key={r.productId} className="flex gap-2 items-start">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-muted-foreground">{r.reorderNote}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Input
        placeholder="Search products…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md min-h-[44px]"
        data-testid="smart-stock-search"
      />

      <div className="hidden md:block border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Sold ({data.windowDays}d)</TableHead>
              <TableHead>Velocity/day</TableHead>
              <TableHead>Depletion</TableHead>
              <TableHead>Risk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={row.productId} data-testid={`smart-stock-row-${row.productId}`}>
                <TableCell>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">{row.sku}</p>
                </TableCell>
                <TableCell className={row.anomalyNegativeStock ? "text-destructive font-medium" : ""}>
                  {row.stock}
                </TableCell>
                <TableCell>{row.unitsSoldWindow}</TableCell>
                <TableCell>{row.velocityPerDay}</TableCell>
                <TableCell>{row.daysToDepletionLabel}</TableCell>
                <TableCell>{riskBadge(row.riskLevel)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="md:hidden space-y-3">
        {filtered.map((row) => (
          <Card key={row.productId}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">{row.sku}</p>
                </div>
                {riskBadge(row.riskLevel)}
              </div>
              <p className="text-sm">
                Stock: {row.stock} · Sold: {row.unitsSoldWindow} · {row.daysToDepletionLabel}
              </p>
              {row.reorderNote && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{row.reorderNote}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
