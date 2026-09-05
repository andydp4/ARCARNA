import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { absoluteDelta, pctDelta, type DayKpi } from "@shared/analytics/kpi";
import { CONTROL_CENTRE_QUERY_KEY, money, type ControlCentreSnapshot } from "@/lib/controlCentre";
import { Skeleton } from "@/components/ui/skeleton";

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}

function DeltaRow({
  label,
  today,
  baseline,
  format = (n: number) => String(n),
}: {
  label: string;
  today: number;
  baseline: number | null;
  format?: (n: number) => string;
}) {
  if (baseline === null) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-metal-muted">{label}</span>
        <span className="text-metal-muted">—</span>
      </div>
    );
  }
  const pct = pctDelta(today, baseline);
  const abs = absoluteDelta(today, baseline);
  const positive = abs > 0;
  const negative = abs < 0;
  const Icon = positive ? ArrowUp : negative ? ArrowDown : Minus;
  const colorClass = positive ? "text-success" : negative ? "text-danger" : "text-metal-muted";

  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-metal-muted">{label}</span>
      <div className={`flex items-center gap-1 font-medium ${colorClass}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{formatPct(pct)}</span>
        <span className="text-xs opacity-80">
          ({abs >= 0 ? "+" : ""}
          {format(abs)})
        </span>
      </div>
    </div>
  );
}

function ComparisonColumn({ title, today, baseline }: { title: string; today: DayKpi; baseline: DayKpi | null }) {
  return (
    <div className="lm-card-muted rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-metal-warm-white">{title}</h3>
      <DeltaRow label="Revenue" today={today.revenue} baseline={baseline?.revenue ?? null} format={money} />
      <DeltaRow label="Transactions" today={today.txns} baseline={baseline?.txns ?? null} />
      <DeltaRow label="AOV" today={today.aov} baseline={baseline?.aov ?? null} format={money} />
    </div>
  );
}

/**
 * A trend line drawn from the 7-day figure the API already computes. Plain
 * inline SVG rather than a charting library — seven points does not justify
 * the dependency, and this is the one place on the page where "up or down at
 * a glance" matters more than precision.
 */
function TrendSparkline({ points }: { points: { date: string; revenue: number }[] }) {
  if (points.length < 2) return null;
  const width = 240;
  const height = 40;
  const values = points.map((p) => p.revenue);
  const max = Math.max(...values, 0.01);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / (points.length - 1);

  const coords = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const trendUp = last >= prev;

  return (
    <div className="flex items-center gap-2">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0"
        role="img"
        aria-label="Revenue trend over the last 7 trading days"
      >
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke={trendUp ? "var(--success)" : "var(--danger)"}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-xs text-metal-muted whitespace-nowrap">7 trading days</span>
    </div>
  );
}

export function ControlCentreToday() {
  const { data, isLoading, isFetching } = useQuery<ControlCentreSnapshot>({
    queryKey: CONTROL_CENTRE_QUERY_KEY,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <Skeleton className="h-64 rounded-xl" data-testid="control-centre-today-loading" />;
  }
  if (!data) return null;

  return (
    <section className="lm-card rounded-xl p-5 sm:p-6" data-testid="control-centre-today">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-sm text-metal-muted">
          {data.tradingDay} · trading day · refreshes every 60s
        </p>
        {isFetching && <span className="text-xs text-metal-muted">Updating…</span>}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:border-r md:border-[hsl(210,15%,78%/0.10)] md:pr-6">
          <p className="text-sm font-semibold text-metal-warm-white mb-3">Today so far</p>
          <p className="text-xs uppercase tracking-wide text-metal-muted">Revenue</p>
          <p className="text-3xl font-bold text-metal-warm-white tabular-nums">{money(data.today.revenue)}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-metal-muted">Transactions</p>
              <p className="text-lg font-semibold text-metal-warm-white">{data.today.txns}</p>
            </div>
            <div>
              <p className="text-xs text-metal-muted">AOV</p>
              <p className="text-lg font-semibold text-metal-warm-white">{money(data.today.aov)}</p>
            </div>
          </div>
          {data.today.refundsTotal > 0 && (
            <p className="mt-2 text-xs text-metal-muted">Refunds: {money(data.today.refundsTotal)}</p>
          )}
          <div className="mt-4">
            <TrendSparkline points={data.revenueTrend} />
          </div>
        </div>
        <ComparisonColumn title="vs last week" today={data.today} baseline={data.vsLastWeek} />
        <ComparisonColumn title="vs same weekday (12mo avg)" today={data.today} baseline={data.vsSameWeekdayAvg} />
      </div>
    </section>
  );
}
