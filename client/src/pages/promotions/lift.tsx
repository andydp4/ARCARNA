import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/Skeleton";
import { PromoLiftChart } from "@/components/charts/PromoLiftChart";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import type { PromoLiftPercent, PromoWindowMetrics } from "@shared/analytics/promoLift";

type LiftResponse = {
  promo: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    usageCount: number;
  };
  baselineWeeks: number;
  promoWindow: PromoWindowMetrics;
  baselineWindow: PromoWindowMetrics;
  lift: PromoLiftPercent;
};

function formatLift(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}

function liftClass(value: number | null): string {
  if (value === null || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

export default function PromotionLiftPage() {
  const [, params] = useRoute("/promotions/:id/lift");
  const promoId = params?.id ?? "";
  const [baselineWeeks, setBaselineWeeks] = useState(4);
  const [weeksInput, setWeeksInput] = useState("4");

  const { data, isLoading, refetch, isFetching } = useQuery<LiftResponse>({
    queryKey: ["/api/analytics/promotions", promoId, "lift", baselineWeeks],
    enabled: Boolean(promoId),
    queryFn: async () => {
      const res = await apiFetch(
        `/api/analytics/promotions/${promoId}/lift?baselineWeeks=${baselineWeeks}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load promotion lift");
      return res.json();
    },
  });

  const applyBaseline = () => {
    const n = Math.min(12, Math.max(1, parseInt(weeksInput, 10) || 4));
    setBaselineWeeks(n);
    setWeeksInput(String(n));
    void refetch();
  };

  if (!promoId) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-muted-foreground">Invalid promotion.</p>
        <Link href="/promotions">
          <Button variant="link" className="mt-2 px-0">
            Back to promotions
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/promotions">
          <Button variant="ghost" size="icon" aria-label="Back to promotions">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <TrendingUp className="h-8 w-8 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {isLoading ? "Promotion lift" : data?.promo.name ?? "Promotion lift"}
          </h1>
          {data && (
            <p className="text-sm text-muted-foreground">
              {format(new Date(data.promo.startDate), "MMM d, yyyy")} –{" "}
              {format(new Date(data.promo.endDate), "MMM d, yyyy")} · {data.promo.usageCount}{" "}
              redemptions
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Baseline window</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="baseline-weeks">Weeks before promo start</Label>
            <Input
              id="baseline-weeks"
              type="number"
              min={1}
              max={12}
              value={weeksInput}
              onChange={(e) => setWeeksInput(e.target.value)}
              className="w-28"
              data-testid="input-baseline-weeks"
            />
          </div>
          <Button onClick={applyBaseline} disabled={isFetching} data-testid="button-apply-baseline">
            Recalculate
          </Button>
          <p className="text-sm text-muted-foreground">
            Compares org completed orders during the promo dates vs the equal-length period
            immediately before start.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton count={3} variant="card" />
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Revenue lift
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${liftClass(data.lift.revenueLiftPct)}`}>
                  {formatLift(data.lift.revenueLiftPct)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ${data.promoWindow.revenue} vs ${data.baselineWindow.revenue} baseline
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">AOV lift</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${liftClass(data.lift.aovLiftPct)}`}>
                  {formatLift(data.lift.aovLiftPct)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ${data.promoWindow.aov} vs ${data.baselineWindow.aov} baseline
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  New customer share lift
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${liftClass(data.lift.newCustomerLiftPct)}`}>
                  {formatLift(data.lift.newCustomerLiftPct)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(data.promoWindow.newCustomerShare * 100).toFixed(1)}% vs{" "}
                  {(data.baselineWindow.newCustomerShare * 100).toFixed(1)}% baseline
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Baseline vs promo period</CardTitle>
            </CardHeader>
            <CardContent>
              <PromoLiftChart
                promoWindow={data.promoWindow}
                baselineWindow={data.baselineWindow}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-muted-foreground">Promotion not found.</p>
      )}
    </div>
  );
}
