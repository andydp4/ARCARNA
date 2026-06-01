import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Minus, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  absoluteDelta,
  pctDelta,
  type DailyKpiResponse,
  type DayKpi,
} from "@shared/analytics/kpi";

function money(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}

type DeltaProps = {
  label: string;
  today: number;
  baseline: number | null;
  format?: (n: number) => string;
};

function DeltaRow({ label, today, baseline, format = (n) => String(n) }: DeltaProps) {
  if (baseline === null) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">—</span>
      </div>
    );
  }

  const pct = pctDelta(today, baseline);
  const abs = absoluteDelta(today, baseline);
  const positive = abs > 0;
  const negative = abs < 0;
  const Icon = positive ? ArrowUp : negative ? ArrowDown : Minus;
  const colorClass = positive
    ? "text-emerald-600 dark:text-emerald-400"
    : negative
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div className={`flex items-center gap-1 font-medium ${colorClass}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{formatPct(pct)}</span>
        <span className="text-xs opacity-80">({abs >= 0 ? "+" : ""}{format(abs)})</span>
      </div>
    </div>
  );
}

function TodayMetrics({ kpi }: { kpi: DayKpi }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Revenue</p>
        <p className="text-2xl sm:text-3xl font-bold">{money(kpi.revenue)}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Transactions</p>
          <p className="text-lg font-semibold">{kpi.txns}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">AOV</p>
          <p className="text-lg font-semibold">{money(kpi.aov)}</p>
        </div>
      </div>
      {kpi.refundsTotal > 0 && (
        <p className="text-xs text-muted-foreground">Refunds: {money(kpi.refundsTotal)}</p>
      )}
    </div>
  );
}

function ComparisonColumn({
  title,
  today,
  baseline,
}: {
  title: string;
  today: DayKpi;
  baseline: DayKpi | null;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <DeltaRow label="Revenue" today={today.revenue} baseline={baseline?.revenue ?? null} format={money} />
      <DeltaRow label="Transactions" today={today.txns} baseline={baseline?.txns ?? null} />
      <DeltaRow label="AOV" today={today.aov} baseline={baseline?.aov ?? null} format={money} />
    </div>
  );
}

export function DailyKpiCard() {
  const { data, isLoading, isFetching } = useQuery<DailyKpiResponse>({
    queryKey: ["/api/analytics/kpi/daily"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div
        className="mb-6 animate-pulse h-40 bg-muted rounded-lg"
        data-testid="daily-kpi-loading"
      />
    );
  }

  if (!data) return null;

  return (
    <section className="mb-6 sm:mb-8" data-testid="daily-kpi-card">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-primary" />
          Today&apos;s KPIs
        </h2>
        {isFetching && !isLoading && (
          <span className="text-xs text-muted-foreground">Updating…</span>
        )}
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-normal">
            {data.date} · refreshes every 60s
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:border-r md:border-border/60 md:pr-4">
              <p className="text-sm font-semibold mb-3">Today</p>
              <TodayMetrics kpi={data.today} />
            </div>
            <ComparisonColumn title="vs last week" today={data.today} baseline={data.lastWeek} />
            <ComparisonColumn
              title="vs same weekday (12mo avg)"
              today={data.today}
              baseline={data.sameWeekdayLtmAvg}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
