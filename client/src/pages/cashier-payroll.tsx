import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, Download, Trophy } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { ResponsiveTable, ResponsiveCardRow } from "@/components/ui/responsive-table";
import { apiFetch } from "@/lib/appPaths";
import { apiRequest, getJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { EXPORT_MIN_ROLE, isAtLeast } from "@shared/accessPolicy";

/** One row per person (STF-FN3); `key` is their user id, or `code:<id>` for old code-only history. */
type PayrollMetric = {
  key: string;
  name: string;
  totalSales: number;
  netSalesProfit: number;
  commissionEarned: number;
  commissionPaid: number;
  commissionUnpaid: number;
  shiftCount: number;
  activeHours: number;
  salesPerActiveHour: number;
  orderCount: number;
  averageOrderValue: number;
};

type CashierAnalytics = {
  metrics: PayrollMetric[];
  shiftStatus: {
    open: number;
    closed: number;
    autoClosed: number;
    manualClosed: number;
    shiftsWithUnpaidCommission: number;
  };
};

type CashierCommissionRow = {
  shiftId: string;
  cashierId: string;
  userId?: string | null;
  cashierCode: string;
  cashierName: string;
  closedAt: string;
  netSalesProfit: string;
  commissionAmount: string;
  /** Some lines had no known cost and were left out of commission (Q5). */
  hasIncompleteCostData?: boolean;
  amountPaid: number;
  amountUnpaid: number;
  paidStatus: "paid" | "partial" | "unpaid";
};

function money(n: number | string): string {
  const value = typeof n === "string" ? parseFloat(n) : n;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value || 0);
}

/**
 * Owner Q5: a sale line with no known cost is left out of commission rather
 * than counted as pure profit. Shown so the missing cost gets set.
 */
function CostMissingBadge() {
  return (
    <Badge
      variant="outline"
      className="ml-2"
      title="Some items on this shift had no cost set, so they were left out of commission. Set their cost on the product."
      data-testid="badge-cost-missing"
    >
      cost missing
    </Badge>
  );
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function CashierPayrollPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [staffFilter, setStaffFilter] = useState<string>("all");
  const { user } = useAuth();
  // Exports are admin only and logged (Q12).
  const canExport = isAtLeast(user?.role, EXPORT_MIN_ROLE);
  // Nobody confirms their own commission payment; the server refuses it too.
  const canConfirm = (row: CashierCommissionRow) => row.amountUnpaid > 0 && (!row.userId || row.userId !== user?.id);

  const params = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("from", from);
    qs.set("to", to);
    return qs.toString();
  }, [from, to]);

  const analyticsParams = useMemo(() => {
    const qs = new URLSearchParams(params);
    if (staffFilter !== "all") qs.set("staffId", staffFilter);
    return qs.toString();
  }, [params, staffFilter]);

  const { data: analytics, isLoading: analyticsLoading } = useQuery<CashierAnalytics>({
    queryKey: ["/api/cashier-analytics", analyticsParams],
    queryFn: () => getJson(`/api/cashier-analytics?${analyticsParams}`),
  });
  // The picker lists everyone in the period, so it keeps its options while a
  // single person is selected.
  const { data: everyone } = useQuery<CashierAnalytics>({
    queryKey: ["/api/cashier-analytics", params],
    queryFn: () => getJson(`/api/cashier-analytics?${params}`),
  });

  const { data: commissionRows = [], isLoading: commissionLoading } = useQuery<CashierCommissionRow[]>({
    queryKey: ["/api/cashier-commission", params],
    queryFn: () => getJson(`/api/cashier-commission?${params}`),
  });

  const confirmPayment = useMutation({
    mutationFn: async (row: CashierCommissionRow) => {
      await apiRequest("POST", "/api/cashier-commission/payments", {
        cashierId: row.cashierId,
        shiftId: row.shiftId,
        amountPaid: row.amountUnpaid,
      });
    },
    onSuccess: () => {
      toast({ title: "Commission payment confirmed" });
      queryClient.invalidateQueries({ queryKey: ["/api/cashier-commission"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashier-analytics"] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not confirm payment", description: error.message, variant: "destructive" });
    },
  });

  const exportCsv = async () => {
    const res = await apiFetch(`/api/cashier-analytics/export.csv?${params}`);
    if (!res.ok) {
      toast({ title: "Export failed", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cashier-payroll-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const metrics = analytics?.metrics ?? [];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <PageHeader
        icon={Wallet}
        title="Cashier Payroll"
        question="Who earned what, and has it been paid?"
        explanation="Shift profit, commission earned and payment status, one row per person."
      />

      <Card className="border-0 shadow-none lm-card">
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-[44px]" />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-[44px]" />
          </div>
          <div className="space-y-2">
            <Label>Person</Label>
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="min-h-[44px] w-48" data-testid="select-payroll-person">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {(everyone?.metrics ?? []).map((m) => (
                  <SelectItem key={m.key} value={m.key}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canExport && (
            <Button variant="outline" onClick={exportCsv} className="min-h-[44px]" data-testid="button-export-payroll-csv">
              <Download className="mr-1.5 h-4 w-4" /> Export CSV
            </Button>
          )}
        </CardContent>
      </Card>

      {analytics && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Open shifts</p><p className="text-2xl font-semibold">{analytics.shiftStatus.open}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Closed (manual)</p><p className="text-2xl font-semibold">{analytics.shiftStatus.manualClosed}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Auto-closed</p><p className="text-2xl font-semibold">{analytics.shiftStatus.autoClosed}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Total closed</p><p className="text-2xl font-semibold">{analytics.shiftStatus.closed}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Unpaid commission</p><p className="text-2xl font-semibold">{analytics.shiftStatus.shiftsWithUnpaidCommission}</p></CardContent></Card>
        </div>
      )}

      <Card className="border-0 shadow-none lm-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5" /> By person</CardTitle>
          <CardDescription>
            Sales, profit and commission per person for the selected trading days. Active hours run from the first to
            the last thing each person did on a shift, not to when the shift was closed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analyticsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : metrics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shifts in this period.</p>
          ) : (
            <ResponsiveTable
              rows={metrics}
              getRowKey={(m) => m.key}
              head={
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Net profit</TableHead>
                  <TableHead>Commission earned</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Unpaid</TableHead>
                  <TableHead>Active hours</TableHead>
                  <TableHead>Sales per active hour</TableHead>
                  <TableHead>Orders</TableHead>
                </TableRow>
              }
              renderCard={(m) => (
                <Card className="lm-card border-0 shadow-none" data-testid={`card-payroll-person-${m.key}`}>
                  <CardContent className="pt-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="font-medium">{m.name}</p>
                      {m.commissionUnpaid > 0 && (
                        <Badge variant="destructive">{money(m.commissionUnpaid)} unpaid</Badge>
                      )}
                    </div>
                    <div className="space-y-1 border-t pt-2">
                      <ResponsiveCardRow label="Sales">{money(m.totalSales)}</ResponsiveCardRow>
                      <ResponsiveCardRow label="Net profit">{money(m.netSalesProfit)}</ResponsiveCardRow>
                      <ResponsiveCardRow label="Commission earned">{money(m.commissionEarned)}</ResponsiveCardRow>
                      <ResponsiveCardRow label="Paid">{money(m.commissionPaid)}</ResponsiveCardRow>
                      <ResponsiveCardRow label="Active hours">{m.activeHours.toFixed(1)}</ResponsiveCardRow>
                      <ResponsiveCardRow label="Sales per active hour">{money(m.salesPerActiveHour)}</ResponsiveCardRow>
                      <ResponsiveCardRow label="Orders">{m.orderCount}</ResponsiveCardRow>
                    </div>
                  </CardContent>
                </Card>
              )}
            >
              {metrics.map((m) => (
                <TableRow key={m.key} data-testid={`row-payroll-person-${m.key}`}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{money(m.totalSales)}</TableCell>
                  <TableCell>{money(m.netSalesProfit)}</TableCell>
                  <TableCell>{money(m.commissionEarned)}</TableCell>
                  <TableCell>{money(m.commissionPaid)}</TableCell>
                  <TableCell>
                    {m.commissionUnpaid > 0 ? (
                      <Badge variant="destructive">{money(m.commissionUnpaid)}</Badge>
                    ) : (
                      money(0)
                    )}
                  </TableCell>
                  <TableCell>{m.activeHours.toFixed(1)}</TableCell>
                  <TableCell>{money(m.salesPerActiveHour)}</TableCell>
                  <TableCell>{m.orderCount}</TableCell>
                </TableRow>
              ))}
            </ResponsiveTable>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-none lm-card">
        <CardHeader>
          <CardTitle>Commission payment log</CardTitle>
          <CardDescription>Per-shift commission and payment status. Confirm payment once a cashier has been paid.</CardDescription>
        </CardHeader>
        <CardContent>
          {commissionLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : commissionRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No closed shifts with commission in this period.</p>
          ) : (
            <ResponsiveTable
              rows={commissionRows}
              getRowKey={(row) => row.shiftId}
              head={
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Shift closed</TableHead>
                  <TableHead>Net profit</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              }
              renderCard={(row) => (
                <Card className="lm-card border-0 shadow-none" data-testid={`card-commission-${row.shiftId}`}>
                  <CardContent className="pt-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{row.cashierCode} · {row.cashierName}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(row.closedAt).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant={row.paidStatus === "paid" ? "secondary" : row.paidStatus === "partial" ? "outline" : "destructive"}>
                        {row.paidStatus}
                      </Badge>
                    </div>
                    <div className="space-y-1 border-t pt-2">
                      <ResponsiveCardRow label="Net profit">{money(row.netSalesProfit)}</ResponsiveCardRow>
                      <ResponsiveCardRow label="Commission">
                        {money(row.commissionAmount)}
                        {row.hasIncompleteCostData && <CostMissingBadge />}
                      </ResponsiveCardRow>
                    </div>
                    {canConfirm(row) && (
                      <Button
                        size="sm"
                        className="mt-3 min-h-[44px] w-full"
                        disabled={confirmPayment.isPending}
                        onClick={() => confirmPayment.mutate(row)}
                        data-testid={`button-confirm-payment-${row.shiftId}`}
                      >
                        Confirm paid — {money(row.amountUnpaid)}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            >
              {commissionRows.map((row) => (
                <TableRow key={row.shiftId} data-testid={`row-commission-${row.shiftId}`}>
                  <TableCell>{row.cashierCode} · {row.cashierName}</TableCell>
                  <TableCell>{new Date(row.closedAt).toLocaleString()}</TableCell>
                  <TableCell>{money(row.netSalesProfit)}</TableCell>
                  <TableCell>
                    {money(row.commissionAmount)}
                    {row.hasIncompleteCostData && <CostMissingBadge />}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.paidStatus === "paid" ? "secondary" : row.paidStatus === "partial" ? "outline" : "destructive"}>
                      {row.paidStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canConfirm(row) && (
                      <Button
                        size="sm"
                        className="min-h-[44px]"
                        disabled={confirmPayment.isPending}
                        onClick={() => confirmPayment.mutate(row)}
                        data-testid={`button-confirm-payment-${row.shiftId}`}
                      >
                        Confirm paid — {money(row.amountUnpaid)}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </ResponsiveTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
