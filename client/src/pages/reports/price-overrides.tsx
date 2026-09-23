/**
 * Price overrides Evidence (v1.2 Phase 4, PRC-09).
 *
 * Every sale line below its minimum or below cost, with the reason given at
 * the till, broken down by cashier, by product and by reason. Managers see
 * cashiers', admins see managers' too, the owner sees all; the server cuts
 * the rows, this page lays them out. Repeat patterns raise a Signal to admins.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getJson } from "@/lib/queryClient";

type Group = {
  key: string;
  name: string;
  lines: number;
  orders: number;
  underList: number;
  underCost: number;
  belowCostLines: number;
  unconfirmedOrders: number;
  discountGiven: number;
  refundsWithinHours: number;
};

type Response = {
  period: { from: string; to: string };
  refundWindowHours: number;
  totals: Omit<Group, "key" | "name">;
  byCashier: Group[];
  byProduct: Group[];
  byReason: Group[];
};

function money(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n || 0);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function GroupTable({ rows, label, hours, testId }: { rows: Group[]; label: string; hours: number; testId: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No price overrides in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <Table data-testid={testId}>
        <TableHeader>
          <TableRow>
            <TableHead>{label}</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead className="text-right">£ under list</TableHead>
            <TableHead className="text-right">Below cost</TableHead>
            <TableHead className="text-right">£ under cost</TableHead>
            <TableHead className="text-right">Unconfirmed</TableHead>
            <TableHead className="text-right">Discount given</TableHead>
            <TableHead className="text-right">Refunds within {hours}h</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} data-testid={`${testId}-row-${r.key}`}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-right">{r.lines}</TableCell>
              <TableCell className="text-right">{money(r.underList)}</TableCell>
              <TableCell className="text-right">{r.belowCostLines}</TableCell>
              <TableCell className="text-right">{r.underCost > 0 ? money(r.underCost) : "—"}</TableCell>
              <TableCell className="text-right">{r.unconfirmedOrders}</TableCell>
              <TableCell className="text-right">{r.discountGiven > 0 ? money(r.discountGiven) : "—"}</TableCell>
              <TableCell className="text-right">{r.refundsWithinHours}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function PriceOverridesPage() {
  const [from, setFrom] = useState(() => isoDaysAgo(13));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const params = new URLSearchParams({ from, to }).toString();
  const { data, isLoading, isError } = useQuery<Response>({
    queryKey: ["/api/evidence/price-overrides", params],
    queryFn: () => getJson(`/api/evidence/price-overrides?${params}`),
  });
  const hours = data?.refundWindowHours ?? 24;
  const t = data?.totals;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <PageHeader
        icon={AlertTriangle}
        title="Price overrides"
        question="Who sold below the minimum or below cost, on what, and why?"
        explanation="Every sale line below its minimum price or below cost, with the reason given at the till. Unconfirmed means the sale arrived without a reason. Refunds counts refunds on those sales by the same person within the hours an admin set."
      />

      <Card className="border-0 shadow-none lm-card">
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor="po-from">From</Label>
            <Input id="po-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-[44px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="po-to">To</Label>
            <Input id="po-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-[44px]" />
          </div>
        </CardContent>
      </Card>

      {isError && <p className="text-sm text-destructive">Could not load Price overrides. Try again.</p>}

      {t && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Lines</p><p className="text-2xl font-semibold" data-testid="text-po-lines">{t.lines}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">£ under list</p><p className="text-2xl font-semibold">{money(t.underList)}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">£ under cost</p><p className="text-2xl font-semibold">{money(t.underCost)}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Unconfirmed orders</p><p className="text-2xl font-semibold">{t.unconfirmedOrders}</p></CardContent></Card>
        </div>
      )}

      {(
        [
          ["By cashier", "Person", "byCashier", "Who rang the sale."],
          ["By product", "Product", "byProduct", "Biggest £ under list first."],
          ["By reason", "Reason", "byReason", "The reason given at Pay."],
        ] as const
      ).map(([title, label, key, desc]) => (
        <Card key={key} className="lm-card border-0 shadow-none">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <GroupTable rows={data?.[key] ?? []} label={label} hours={hours} testId={`table-po-${key}`} />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
