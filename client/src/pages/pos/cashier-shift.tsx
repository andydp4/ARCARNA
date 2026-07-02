import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, LogOut } from "lucide-react";
import { apiRequest, getJson, queryClient as globalQueryClient } from "@/lib/queryClient";
import {
  getActiveCashierId,
  setActiveCashierId,
  setActiveCashierShiftId,
  setActiveCashierShiftReplayToken,
} from "@/lib/orgScope";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

type CashierProfile = {
  id: string;
  cashierCode: string;
  displayName: string;
  isActive: boolean;
};

type CashierShift = {
  id: string;
  cashierId: string;
  status: string;
  offlineReplayToken?: string;
};

type CashierShiftBalanceSheet = {
  grossSales: number;
  cashSales: number;
  cardSales: number;
  creditSales: number;
  unpaidCreditSales: number;
  stockCost: number;
  orderExpenses: number;
  globalExpenseAllocation: number;
  refunds: number;
  netSalesProfit: number;
  commissionRate: number;
  commissionAmount: number;
  businessRetainedProfit: number;
};

function money(n: number | string): string {
  const value = typeof n === "string" ? parseFloat(n) : n;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value || 0);
}

/** Shows the active cashier/shift badge, and start/end shift controls, when
 * cashier commission tracking is enabled for the org. Renders nothing otherwise. */
export function CashierShiftBadge() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cashierId, setCashierId] = useState<string | null>(() => getActiveCashierId());
  const [startOpen, setStartOpen] = useState(false);
  const [selectedCashier, setSelectedCashier] = useState("");
  const [closedSummary, setClosedSummary] = useState<{ shift: CashierShift; summary: CashierShiftBalanceSheet } | null>(null);
  const [paymentNotes, setPaymentNotes] = useState("");

  const { data: settings } = useQuery<{ cashierCommissionEnabled?: boolean; requireCashierForSale?: boolean }>({
    queryKey: ["/api/settings"],
  });

  const enabled = !!settings?.cashierCommissionEnabled;

  const { data: cashiers = [] } = useQuery<CashierProfile[]>({
    queryKey: ["/api/cashiers"],
    queryFn: () => getJson("/api/cashiers"),
    enabled,
  });

  const { data: current } = useQuery<{ shift: CashierShift | null }>({
    queryKey: ["/api/cashier-shifts/current", cashierId],
    queryFn: () => getJson(`/api/cashier-shifts/current/${cashierId}`),
    enabled: enabled && !!cashierId,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!cashierId || !current) return;
    if (current.shift) {
      setActiveCashierShiftId(current.shift.id);
      setActiveCashierShiftReplayToken(current.shift.offlineReplayToken ?? null);
    }
  }, [cashierId, current]);

  useEffect(() => {
    if (!enabled) return;
    const openStartDialog = () => setStartOpen(true);
    window.addEventListener("arcarna:cashier-shift-required", openStartDialog);
    return () => window.removeEventListener("arcarna:cashier-shift-required", openStartDialog);
  }, [enabled]);

  const startShift = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/cashier-shifts/start", { cashierId: selectedCashier });
      return res.json() as Promise<CashierShift>;
    },
    onSuccess: (shift) => {
      setActiveCashierId(shift.cashierId);
      setActiveCashierShiftId(shift.id);
      setActiveCashierShiftReplayToken(shift.offlineReplayToken ?? null);
      setCashierId(shift.cashierId);
      setStartOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/cashier-shifts/current"] });
      toast({ title: "Cashier shift started" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not start shift", description: error.message, variant: "destructive" });
    },
  });

  const endShift = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/cashier-shifts/${current?.shift?.id}/end`, {});
      return res.json() as Promise<{ shift: CashierShift; summary: CashierShiftBalanceSheet }>;
    },
    onSuccess: (data) => {
      setActiveCashierId(null);
      setActiveCashierShiftId(null);
      setActiveCashierShiftReplayToken(null);
      setCashierId(null);
      setClosedSummary(data);
      globalQueryClient.invalidateQueries({ queryKey: ["/api/cashier-shifts/current"] });
      globalQueryClient.invalidateQueries({ queryKey: ["/api/cashier-analytics"] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not end shift", description: error.message, variant: "destructive" });
    },
  });

  const confirmPayment = useMutation({
    mutationFn: async () => {
      if (!closedSummary) return;
      await apiRequest("POST", "/api/cashier-commission/payments", {
        cashierId: closedSummary.shift.cashierId,
        shiftId: closedSummary.shift.id,
        amountPaid: closedSummary.summary.commissionAmount,
        notes: paymentNotes || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Commission payment confirmed" });
      setClosedSummary(null);
      setPaymentNotes("");
    },
    onError: (error: Error) => {
      toast({ title: "Could not confirm payment", description: error.message, variant: "destructive" });
    },
  });

  if (!enabled) return null;

  const activeCashier = cashiers.find((c) => c.id === cashierId);
  const canConfirmPayment = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "MANAGER";

  return (
    <>
      {current?.shift ? (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="min-h-[32px] px-3" data-testid="badge-cashier-shift">
            <Wallet className="mr-1.5 h-3.5 w-3.5" />
            Cashier {activeCashier?.cashierCode ?? ""} · Shift open
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            onClick={() => endShift.mutate()}
            disabled={endShift.isPending}
            data-testid="button-end-cashier-shift"
          >
            <LogOut className="mr-1 h-4 w-4" /> End shift
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px]"
          onClick={() => setStartOpen(true)}
          data-testid="button-start-cashier-shift"
        >
          <Wallet className="mr-1 h-4 w-4" /> Start cashier shift
        </Button>
      )}

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start cashier shift</DialogTitle>
            <DialogDescription>Select your cashier code to begin tracking commission.</DialogDescription>
          </DialogHeader>
          {cashiers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No cashier profiles yet. Add your first cashier in Settings → Cashiers.
            </p>
          ) : (
            <div className="space-y-2 py-2">
              <Label>Cashier</Label>
              <Select value={selectedCashier} onValueChange={setSelectedCashier}>
                <SelectTrigger className="min-h-[44px]" data-testid="select-cashier-code">
                  <SelectValue placeholder="Select cashier code" />
                </SelectTrigger>
                <SelectContent>
                  {cashiers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.cashierCode} — {c.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full min-h-[44px]"
              disabled={!selectedCashier || startShift.isPending}
              onClick={() => startShift.mutate()}
              data-testid="button-confirm-start-shift"
            >
              Start shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!closedSummary} onOpenChange={(open) => !open && setClosedSummary(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Shift closed</DialogTitle>
            <DialogDescription>Shift profit summary and commission.</DialogDescription>
          </DialogHeader>
          {closedSummary && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Cash sales</span>
                <span className="text-right">{money(closedSummary.summary.cashSales)}</span>
                <span className="text-muted-foreground">Card sales</span>
                <span className="text-right">{money(closedSummary.summary.cardSales)}</span>
                <span className="text-muted-foreground">Credit/tick sales</span>
                <span className="text-right">{money(closedSummary.summary.creditSales)}</span>
                <span className="text-muted-foreground">Stock cost</span>
                <span className="text-right">-{money(closedSummary.summary.stockCost)}</span>
                <span className="text-muted-foreground">Order expenses</span>
                <span className="text-right">-{money(closedSummary.summary.orderExpenses)}</span>
                <span className="text-muted-foreground">Allocated overheads</span>
                <span className="text-right">-{money(closedSummary.summary.globalExpenseAllocation)}</span>
                <span className="text-muted-foreground">Refunds</span>
                <span className="text-right">-{money(closedSummary.summary.refunds)}</span>
                <span className="font-medium border-t pt-1">Net sales profit</span>
                <span className="text-right font-medium border-t pt-1">{money(closedSummary.summary.netSalesProfit)}</span>
                <span className="text-muted-foreground">Commission rate</span>
                <span className="text-right">{closedSummary.summary.commissionRate}%</span>
                <span className="font-medium">Cashier commission</span>
                <span className="text-right font-medium">{money(closedSummary.summary.commissionAmount)}</span>
                <span className="text-muted-foreground">Business retained profit</span>
                <span className="text-right">{money(closedSummary.summary.businessRetainedProfit)}</span>
              </div>
              {canConfirmPayment && closedSummary.summary.commissionAmount > 0 && (
                <div className="space-y-2 pt-3 border-t">
                  <Label>Notes (optional)</Label>
                  <Textarea value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} rows={2} />
                  <Button
                    className="w-full min-h-[44px]"
                    onClick={() => confirmPayment.mutate()}
                    disabled={confirmPayment.isPending}
                    data-testid="button-confirm-commission-payment"
                  >
                    Confirm commission paid — {money(closedSummary.summary.commissionAmount)}
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-[44px]" onClick={() => setClosedSummary(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
