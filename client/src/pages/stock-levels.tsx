import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Search } from "lucide-react";
import { PageHeader, LM_CARD } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { ErrorState } from "@/components/ErrorState";
import type { FlagLevel } from "@/lib/reportBrand";
import type { StockLevelRow, StockLevelStatus } from "@shared/stockLevels";

const STATUS_LABEL: Record<StockLevelStatus, string> = {
  out: "Out of stock",
  low: "Running low",
  ok: "In stock",
};

/** Same traffic-light meaning as everywhere else stock is judged (red/amber/green). */
const STATUS_FLAG: Record<StockLevelStatus, FlagLevel> = {
  out: "red",
  low: "amber",
  ok: "green",
};

function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Stock Centre › Stock levels (v1.2 Phase 3): the cashier's read-only view.
 * Counts at this till's location and nothing else — no cost, no price edits,
 * no adjustments. The server builds each row from an allow-list
 * (shared/stockLevels.ts), so there is no cost in the response to hide.
 */
export default function StockLevelsPage() {
  const [query, setQuery] = useState("");
  const { data = [], isLoading, isError, refetch } = useQuery<StockLevelRow[]>({
    queryKey: ["/api/stock-levels"],
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || (r.barcode ?? "").includes(q),
    );
  }, [data, query]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={Boxes}
        title="Stock levels"
        question="Have we got it on the shelf?"
        explanation="How many of each product this location has. Read-only: a manager adjusts stock in Stock Truths."
      />
      <div className="relative max-w-md">
        <Label htmlFor="stock-levels-search" className="sr-only">
          Search products
        </Label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="stock-levels-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, code or barcode"
          className="pl-9"
          data-testid="stock-levels-search"
        />
      </div>
      {isError ? (
        <ErrorState title="Couldn't load stock levels" onRetry={() => void refetch()} />
      ) : (
        <Card className={LM_CARD}>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                {query ? "No products match that search." : "No products yet."}
              </p>
            ) : (
              <ul className="divide-y divide-border" data-testid="stock-levels-list">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`stock-level-${r.id}`}>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-metal-warm-white">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.sku}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <FlagBadge level={STATUS_FLAG[r.status]}>{STATUS_LABEL[r.status]}</FlagBadge>
                      <span className="w-14 text-right text-lg font-semibold tabular-nums text-metal-warm-white">
                        {formatCount(r.stock)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
