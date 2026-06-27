import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/Skeleton";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import type { StockTurnCategoryRow, StockTurnStatus } from "@shared/analytics/stockTurn";

type StockTurnResponse = {
  categories: StockTurnCategoryRow[];
  windowDays: number;
};

const STATUS_STYLES: Record<StockTurnStatus, string> = {
  healthy: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  watch: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  slow: "bg-red-500/15 text-red-700 dark:text-red-300",
};

type SortKey = keyof Pick<
  StockTurnCategoryRow,
  "category" | "unitsSold" | "avgStock" | "daysOfStock" | "turnRate"
>;

export default function StockTurnAnalyticsPage() {
  const [sortKey, setSortKey] = useState<SortKey>("daysOfStock");
  const [sortAsc, setSortAsc] = useState(false);

  const { data, isLoading } = useQuery<StockTurnResponse>({
    queryKey: ["/api/analytics/stock-turn"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/stock-turn?windowDays=90", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load stock turn");
      return res.json();
    },
  });

  const sorted = [...(data?.categories ?? [])].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" && typeof bv === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const na = Number(av);
    const nb = Number(bv);
    return sortAsc ? na - nb : nb - na;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === "category");
    }
  };

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-6">
      <PageHeader
        icon={Layers}
        title="Stock Turn"
        question="What sells fast, and what sits?"
        explanation={`Category-level turn and days of stock (last ${data?.windowDays ?? 90} days). Slow movers flagged above 90 days.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>By category</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products with stock or sales data.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("category")}>
                    Category
                  </TableHead>
                  <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("unitsSold")}>
                    Units sold
                  </TableHead>
                  <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("avgStock")}>
                    Avg stock
                  </TableHead>
                  <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("daysOfStock")}>
                    Days of stock
                  </TableHead>
                  <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("turnRate")}>
                    Turn rate
                  </TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium">{row.category}</TableCell>
                    <TableCell className="text-right">{row.unitsSold}</TableCell>
                    <TableCell className="text-right">{row.avgStock}</TableCell>
                    <TableCell className="text-right">
                      {row.daysOfStock >= 999 ? "—" : row.daysOfStock}
                    </TableCell>
                    <TableCell className="text-right">{row.turnRate}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLES[row.status]} variant="secondary">
                        {row.status === "slow" ? "Slow mover" : row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
