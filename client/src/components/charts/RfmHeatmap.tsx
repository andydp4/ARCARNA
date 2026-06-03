import type { RfmHeatmapCell } from "@shared/analytics/rfm";

type Props = {
  cells: RfmHeatmapCell[];
  onSelect?: (r: number, f: number) => void;
};

function cellColor(avgMonetary: number, max: number): string {
  if (max <= 0 || avgMonetary <= 0) return "hsl(var(--muted))";
  const t = Math.min(1, avgMonetary / max);
  return `hsl(210 80% ${35 + t * 35}%)`;
}

export function RfmHeatmap({ cells, onSelect }: Props) {
  const maxMonetary = Math.max(...cells.map((c) => c.avgMonetary), 1);

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid grid-cols-[auto_repeat(5,minmax(2.5rem,1fr))] gap-1 text-xs">
        <div />
        {[1, 2, 3, 4, 5].map((f) => (
          <div key={f} className="text-center font-medium text-muted-foreground pb-1">
            F{f}
          </div>
        ))}
        {[5, 4, 3, 2, 1].map((r) => (
          <div key={`row-${r}`} className="contents">
            <div className="flex items-center font-medium text-muted-foreground pr-2">
              R{r}
            </div>
            {[1, 2, 3, 4, 5].map((f) => {
              const cell = cells.find((c) => c.r === r && c.f === f);
              const count = cell?.count ?? 0;
              const avg = cell?.avgMonetary ?? 0;
              return (
                <button
                  key={`${r}-${f}`}
                  type="button"
                  title={`R${r} F${f}: ${count} customers, avg spend £${avg.toFixed(0)}`}
                  className="aspect-square rounded-md border border-border/50 flex flex-col items-center justify-center min-h-10 transition-opacity hover:opacity-80"
                  style={{ backgroundColor: cellColor(avg, maxMonetary) }}
                  onClick={() => onSelect?.(r, f)}
                >
                  <span className="font-semibold text-white drop-shadow-sm">{count}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">Recency (rows) × Frequency (columns). Colour = average spend.</p>
    </div>
  );
}
