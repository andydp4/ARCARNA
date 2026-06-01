import type { ReactNode } from "react";
import { Link } from "wouter";
import { Home, DollarSign, ShoppingCart, Users, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { DeckLayer } from "./DeckLayer";
import { HullPanel } from "./HullPanel";

type SummaryStats = {
  revenue: number;
  orders: number;
  customers: number;
  avgOrder: number;
};

type SpatialInsightsShellProps = {
  children: ReactNode;
  summaryStats: SummaryStats;
  dateFrom: Date;
  dateTo: Date;
};

function SatelliteKpi({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
}) {
  return (
    <div className="satellite-panel rounded-md px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-metal-muted">{label}</p>
          <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-metal-warm-white">
            {value}
          </p>
        </div>
        <Icon className="h-4 w-4 shrink-0 text-metal-brushed" aria-hidden />
      </div>
    </div>
  );
}

export function SpatialInsightsShell({
  children,
  summaryStats,
  dateFrom,
  dateTo,
}: SpatialInsightsShellProps) {
  const homeButton = (
    <Button
      asChild
      variant="ghost"
      className="min-h-[44px] text-metal-warm-white hover:bg-metal-charcoal/60 hover:text-metal-warm-white"
      data-testid="link-home"
    >
      <Link href="/">
        <Home className="h-4 w-4 sm:mr-2" />
        <span className="sr-only sm:not-sr-only">Dashboard</span>
      </Link>
    </Button>
  );

  return (
    <div className="liquid-metal relative min-h-screen overflow-x-hidden">
      <DeckLayer className="fixed inset-0" />

      <div className="relative z-10 mx-auto max-w-[90rem] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,13rem)] lg:gap-6">
          {/* Left satellites — KPI strip on desktop */}
          <aside className="order-2 flex flex-col gap-3 lg:order-1 lg:pt-14">
            <SatelliteKpi
              label="Revenue"
              value={`$${summaryStats.revenue.toFixed(2)}`}
              icon={DollarSign}
            />
            <SatelliteKpi
              label="Orders"
              value={String(summaryStats.orders)}
              icon={ShoppingCart}
            />
            <SatelliteKpi
              label="Customers"
              value={String(summaryStats.customers)}
              icon={Users}
            />
            <SatelliteKpi
              label="Avg order"
              value={`$${summaryStats.avgOrder.toFixed(2)}`}
              icon={TrendingUp}
            />
          </aside>

          {/* Core hull */}
          <div className="order-1 min-w-0 lg:order-2">
            <HullPanel
              title="Business insights"
              subtitle="Operational core — pick a period, explore revenue and inventory, export when ready."
              showLogo
              headerSlot={homeButton}
            >
              <div className="insights-spatial-core min-w-0">{children}</div>
            </HullPanel>
          </div>

          {/* Right satellites — period + status */}
          <aside className="order-3 flex flex-col gap-3 lg:pt-14">
            <div className="satellite-panel rounded-md px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-metal-muted">
                Report period
              </p>
              <p className="mt-2 text-sm leading-snug text-metal-warm-white">
                {format(dateFrom, "PP")}
              </p>
              <p className="text-xs text-metal-muted">to</p>
              <p className="text-sm leading-snug text-metal-warm-white">{format(dateTo, "PP")}</p>
            </div>
            <div className="satellite-panel rounded-md px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-metal-muted">
                Deck status
              </p>
              <ul className="mt-2 space-y-1.5 text-xs text-metal-muted">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-metal-emerald" aria-hidden />
                  Live report data
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-metal-electric-blue" aria-hidden />
                  Spatial workspace
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
