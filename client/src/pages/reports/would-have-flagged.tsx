/**
 * "Would have flagged" (v1.2 Phase 2, PRC-03, CMP-03).
 *
 * Every sale below its minimum price or below known cost is recorded silently
 * by the order engine — the till shows nothing yet. This is where admins and
 * the owner see what would have been flagged, by product and by person, with
 * how far under list and under cost it went. The server refuses anyone below
 * admin; the in-page check only saves them a failed request.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getJson } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { canSeeWouldHaveFlagged } from "@shared/accessPolicy";

type Group = {
  key: string;
  name: string;
  lines: number;
  units: number;
  belowMinimum: number;
  belowCost: number;
  underList: number;
  underCost: number;
};

type Response = {
  period: { from: string; to: string };
  totals: Omit<Group, "key" | "name">;
  byProduct: Group[];
  byPerson: Group[];
};

function money(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n || 0);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function GroupTable({ rows, label, testId }: { rows: Group[]; label: string; testId: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing would have been flagged in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table data-testid={testId}>
        <TableHeader>
          <TableRow>
            <TableHead>{label}</TableHead>
            <TableHead className="text-right">Sales lines</TableHead>
            <TableHead className="text-right">Below minimum</TableHead>
            <TableHead className="text-right">Below cost</TableHead>
            <TableHead className="text-right">£ under list</TableHead>
            <TableHead className="text-right">£ under cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} data-testid={`${testId}-row-${r.key}`}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-right">{r.lines}</TableCell>
              <TableCell className="text-right">{r.belowMinimum}</TableCell>
              <TableCell className="text-right">{r.belowCost}</TableCell>
              <TableCell className="text-right">{money(r.underList)}</TableCell>
              <TableCell className="text-right">{r.underCost > 0 ? money(r.underCost) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function WouldHaveFlaggedPage() {
  const { user } = useAuth();
  const allowed = canSeeWouldHaveFlagged((user as { role?: string } | undefined)?.role);
  // Two weeks by default: the silent period before the till starts warning.
  const [from, setFrom] = useState(() => isoDaysAgo(13));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const params = new URLSearchParams({ from, to }).toString();

  const { data, isLoading, isError } = useQuery<Response>({
    queryKey: ["/api/price-exceptions/would-have-flagged", params],
    queryFn: () => getJson(`/api/price-exceptions/would-have-flagged?${params}`),
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Alert data-testid="alert-would-have-flagged-admin-only">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Admins only</AlertTitle>
          <AlertDescription>"Would have flagged" is for admins and the owner.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const totals = data?.totals;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <PageHeader
        icon={ShieldAlert}
        title="Would have flagged"
        question="Which sales went below the minimum price or below cost?"
        explanation="Recorded silently on every till sale, manager edit, API order and voice draft — the till shows no warning yet and no sale was stopped. Website orders sell at list and are not checked."
      />

      <Card className="border-0 shadow-none lm-card">
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor="whf-from">From</Label>
            <Input id="whf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-[44px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="whf-to">To</Label>
            <Input id="whf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-[44px]" />
          </div>
        </CardContent>
      </Card>

      {isError && <p className="text-sm text-destructive">Could not load Would have flagged. Try again.</p>}

      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Sales lines</p><p className="text-2xl font-semibold" data-testid="text-whf-lines">{totals.lines}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Below cost</p><p className="text-2xl font-semibold">{totals.belowCost}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">£ under list</p><p className="text-2xl font-semibold" data-testid="text-whf-under-list">{money(totals.underList)}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">£ under cost</p><p className="text-2xl font-semibold" data-testid="text-whf-under-cost">{money(totals.underCost)}</p></CardContent></Card>
        </div>
      )}

      <Card className="lm-card border-0 shadow-none">
        <CardHeader>
          <CardTitle>By product</CardTitle>
          <CardDescription>Biggest £ under list first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <GroupTable rows={data?.byProduct ?? []} label="Product" testId="table-whf-product" />}
        </CardContent>
      </Card>

      <Card className="lm-card border-0 shadow-none">
        <CardHeader>
          <CardTitle>By person</CardTitle>
          <CardDescription>Who set the price: the person on the till, or the manager who edited the order.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <GroupTable rows={data?.byPerson ?? []} label="Person" testId="table-whf-person" />}
        </CardContent>
      </Card>
    </div>
  );
}
