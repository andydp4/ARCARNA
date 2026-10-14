import type { ProductRankingMetric } from "@shared/analytics/productPerformance";

export function ProductRankingControl({ value, onChange }: {
  value: ProductRankingMetric;
  onChange: (metric: ProductRankingMetric) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Rank by
      <select aria-label="Rank products by" value={value}
        onChange={(event) => onChange(event.target.value as ProductRankingMetric)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
        <option value="revenue">Revenue</option>
        <option value="grossProfit">Gross profit</option>
        <option value="quantity">Quantity sold</option>
      </select>
    </label>
  );
}

export function ProductProfitNote() {
  return <p className="text-xs text-muted-foreground">
    After sale discounts and refunds; delivery fees excluded. Gross profit uses sale costs,
    on the same basis as Weekly Margin, before overheads. Older sales use current costs.
    Products with missing costs are excluded from the profit ranking.
  </p>;
}
