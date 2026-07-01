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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/appPaths";
import { apiRequest, getJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type CashierMetric = {
  cashierId: string;
  cashierCode: string;
  cashierName: string;
  totalSales: number;
  netSalesProfit: number;
  commissionEarned: number;
  commissionPaid: number;
  commissionUnpaid: number;
  shiftCount: number;
  shiftDurationHours: number;
  salesPerHour: number;
  profitPerHour: number;
  orderCount: number;
  averageOrderValue: number;
};

type CashierAnalytics = {
  metrics: CashierMetric[];
  leaderboards: Record<string, CashierMetric[]>;
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
  cashierCode: string;
  cashierName: string;
  closedAt: string;
  netSalesProfit: string;
  commissionAmount: string;
  amountPaid: number;
  amountUnpaid: number;
  paidStatus: "paid" | "partial" | "unpaid";
};

function money(n: number | string): string {
  const value = typeof n === "string" ? parseFloat(n) : n;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value || 0);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function CashierPayrollPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [cashierFilter, setCashierFilter] = useState<string>("all");

  const params = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("from", from);
    qs.set("to", to);
    if (cashierFilter !== "all") qs.set("cashierId", cashierFilter);
    return qs.toString();
  }, [from, to, cashierFilter]);

  const { data: analytics, isLoading: analyticsLoading } = useQuery<CashierAnalytics>({
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
        explanation="Shift profit, commission earned and payment status by cashier."
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
            <Label>Cashier</Label>
            <Select value={cashierFilter} onValueChange={setCashierFilter}>
              <SelectTrigger className="min-h-[44px] w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cashiers</SelectItem>
                {metrics.map((m) => (
                  <SelectItem key={m.cashierId} value={m.cashierId}>{m.cashierCode} — {m.cashierName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={exportCsv} className="min-h-[44px]" data-testid="button-export-payroll-csv">
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
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
          <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5" /> Cashier performance</CardTitle>
          <CardDescription>Sales, profit and commission by cashier for the selected period.</CardDescription>
        </CardHeader>
        <CardContent>
          {analyticsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : metrics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cashier shifts in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Net profit</TableHead>
                  <TableHead>Commission earned</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Unpaid</TableHead>
                  <TableHead>Sales/hr</TableHead>
                  <TableHead>Orders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.map((m) => (
                  <TableRow key={m.cashierId} data-testid={`row-cashier-metric-${m.cashierCode}`}>
                    <TableCell className="font-medium">{m.cashierCode} · {m.cashierName}</TableCell>
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
                    <TableCell>{money(m.salesPerHour)}</TableCell>
                    <TableCell>{m.orderCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Shift closed</TableHead>
                  <TableHead>Net profit</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissionRows.map((row) => (
                  <TableRow key={row.shiftId} data-testid={`row-commission-${row.shiftId}`}>
                    <TableCell>{row.cashierCode} · {row.cashierName}</TableCell>
                    <TableCell>{new Date(row.closedAt).toLocaleString()}</TableCell>
                    <TableCell>{money(row.netSalesProfit)}</TableCell>
                    <TableCell>{money(row.commissionAmount)}</TableCell>
                    <TableCell>
                      <Badge variant={row.paidStatus === "paid" ? "secondary" : row.paidStatus === "partial" ? "outline" : "destructive"}>
                        {row.paidStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.amountUnpaid > 0 && (
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
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
