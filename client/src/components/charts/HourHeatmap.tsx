import type { HourOfDayBucket } from "@shared/analytics/hourOfDay";
import { dowLabel, formatHourOfDayTooltip } from "@shared/analytics/hourOfDay";

type Props = {
  buckets: HourOfDayBucket[];
};

function cellColor(avgRevenue: number, max: number): string {
  // Single-hue Truth Blue ramp: dark (low) → bright (high) revenue.
  if (max <= 0 || avgRevenue <= 0) return "var(--muted)";
  const t = Math.min(1, avgRevenue / max);
  return `hsl(208 90% ${30 + t * 34}%)`;
}

export function HourHeatmap({ buckets }: Props) {
  const maxRevenue = Math.max(...buckets.map((b) => b.avgRevenue), 1);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="overflow-x-auto">
      <div
        className="inline-grid gap-1 text-xs"
        style={{ gridTemplateColumns: `auto repeat(24, minmax(1.75rem, 1fr))` }}
      >
        <div />
        {hours.map((hour) => (
          <div key={hour} className="text-center font-medium text-muted-foreground pb-1">
            {hour}
          </div>
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
          <div key={`row-${dow}`} className="contents">
            <div className="flex items-center font-medium text-muted-foreground pr-2 whitespace-nowrap">
              {dowLabel(dow)}
            </div>
            {hours.map((hour) => {
              const cell = buckets.find((b) => b.dow === dow && b.hour === hour);
              const avg = cell?.avgRevenue ?? 0;
              const txns = cell?.txns ?? 0;
              return (
                <div
                  key={`${dow}-${hour}`}
                  title={formatHourOfDayTooltip(dow, hour, avg, txns)}
                  className="aspect-square rounded-sm border border-border/40 min-h-6 motion-safe:transition-colors"
                  style={{ backgroundColor: cellColor(avg, maxRevenue) }}
                  aria-label={formatHourOfDayTooltip(dow, hour, avg, txns)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Rows = weekday, columns = hour (org timezone). Colour = average weekly revenue.
      </p>
    </div>
  );
}
