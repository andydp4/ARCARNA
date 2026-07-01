import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, Plus, Pencil, UserX, UserCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, getJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  COMMISSION_RATE_PRESETS,
  SHIFT_INACTIVITY_OPTIONS,
  type OrgSetup,
} from "@shared/setup";

type CashierProfile = {
  id: string;
  cashierCode: string;
  displayName: string;
  pinCode: string | null;
  defaultCommissionRate: string | null;
  isActive: boolean;
};

const SHIFT_INACTIVITY_LABELS: Record<(typeof SHIFT_INACTIVITY_OPTIONS)[number], string> = {
  "1_hour": "1 hour",
  "12_hours": "12 hours",
  "1_day": "1 day",
  never: "Never",
};

function emptyForm() {
  return { id: "", cashierCode: "", displayName: "", defaultCommissionRate: "" };
}

export function CashierCommissionSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const { data: org, isLoading: orgLoading } = useQuery<OrgSetup>({
    queryKey: ["/api/org/setup"],
  });

  const { data: cashiers = [], isLoading: cashiersLoading } = useQuery<CashierProfile[]>({
    queryKey: ["/api/cashiers", "all"],
    queryFn: () => getJson("/api/cashiers?includeInactive=true"),
  });

  const [commissionEnabled, setCommissionEnabled] = useState(false);
  const [requireShift, setRequireShift] = useState(false);
  const [defaultRate, setDefaultRate] = useState("10");
  const [autoClose, setAutoClose] = useState<(typeof SHIFT_INACTIVITY_OPTIONS)[number]>("never");

  useEffect(() => {
    if (!org) return;
    setCommissionEnabled(org.cashierCommissionEnabled ?? false);
    setRequireShift(org.requireCashierForSale ?? false);
    setDefaultRate(String(org.defaultCashierCommissionRate ?? "10"));
    setAutoClose((org.shiftInactivityCloseAfter as (typeof SHIFT_INACTIVITY_OPTIONS)[number]) ?? "never");
  }, [org]);

  const saveSettings = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      await apiRequest("PATCH", "/api/org/setup", patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/setup"] });
      toast({ title: "Commission settings updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update settings", description: error.message, variant: "destructive" });
    },
  });

  const saveCashier = useMutation({
    mutationFn: async () => {
      const payload = {
        cashierCode: form.cashierCode.trim(),
        displayName: form.displayName.trim(),
        defaultCommissionRate: form.defaultCommissionRate.trim() ? Number(form.defaultCommissionRate) : null,
      };
      if (form.id) {
        await apiRequest("PATCH", `/api/cashiers/${form.id}`, payload);
      } else {
        await apiRequest("POST", "/api/cashiers", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashiers", "all"] });
      toast({ title: form.id ? "Cashier updated" : "Cashier added" });
      setDialogOpen(false);
      setForm(emptyForm());
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save cashier", description: error.message, variant: "destructive" });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      if (isActive) {
        await apiRequest("PATCH", `/api/cashiers/${id}`, { isActive: true });
      } else {
        await apiRequest("DELETE", `/api/cashiers/${id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashiers", "all"] });
    },
  });

  const openEdit = (cashier: CashierProfile) => {
    setForm({
      id: cashier.id,
      cashierCode: cashier.cashierCode,
      displayName: cashier.displayName,
      defaultCommissionRate: cashier.defaultCommissionRate ?? "",
    });
    setDialogOpen(true);
  };

  const openAdd = () => {
    setForm(emptyForm());
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-none lm-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" /> Commission settings
          </CardTitle>
          <CardDescription>
            Cashier commission is paid from net sales profit, after stock cost, order expenses and
            allocated overheads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable cashier commission</p>
              <p className="text-xs text-muted-foreground">Track cashier shifts and shift profit.</p>
            </div>
            <Switch
              checked={commissionEnabled}
              onCheckedChange={(v) => {
                setCommissionEnabled(v);
                saveSettings.mutate({ cashierCommissionEnabled: v });
              }}
              data-testid="settings-cashier-commission-enabled"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Default commission rate</Label>
              <Select
                value={defaultRate}
                onValueChange={(v) => {
                  setDefaultRate(v);
                  saveSettings.mutate({ defaultCashierCommissionRate: v });
                }}
              >
                <SelectTrigger className="min-h-[44px]" data-testid="settings-commission-rate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMISSION_RATE_PRESETS.map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>{rate}%</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Auto-close inactive shift after</Label>
              <Select
                value={autoClose}
                onValueChange={(v) => {
                  setAutoClose(v as (typeof SHIFT_INACTIVITY_OPTIONS)[number]);
                  saveSettings.mutate({ shiftInactivityCloseAfter: v });
                }}
              >
                <SelectTrigger className="min-h-[44px]" data-testid="settings-shift-auto-close">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIFT_INACTIVITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>{SHIFT_INACTIVITY_LABELS[opt]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Require active cashier shift before sale</p>
              <p className="text-xs text-muted-foreground">Block checkout until a cashier starts a shift.</p>
            </div>
            <Switch
              checked={requireShift}
              onCheckedChange={(v) => {
                setRequireShift(v);
                saveSettings.mutate({ requireCashierForSale: v });
              }}
              data-testid="settings-require-cashier-for-sale"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-none lm-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Cashier profiles</CardTitle>
            <CardDescription>Business-owned cashier codes used to start shifts and earn commission.</CardDescription>
          </div>
          <Button onClick={openAdd} className="min-h-[44px]" data-testid="button-add-cashier">
            <Plus className="mr-1 h-4 w-4" /> Add cashier
          </Button>
        </CardHeader>
        <CardContent>
          {cashiersLoading || orgLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : cashiers.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm font-medium">No cashier profiles yet.</p>
              <p className="text-sm text-muted-foreground">
                Add your first cashier to start tracking shifts and commission.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Commission override</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashiers.map((cashier) => (
                  <TableRow key={cashier.id} data-testid={`row-cashier-${cashier.cashierCode}`}>
                    <TableCell className="font-mono">{cashier.cashierCode}</TableCell>
                    <TableCell>{cashier.displayName}</TableCell>
                    <TableCell>
                      {cashier.defaultCommissionRate != null ? `${cashier.defaultCommissionRate}%` : "Default"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={cashier.isActive ? "secondary" : "outline"}>
                        {cashier.isActive ? "Active" : "Deactivated"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="min-h-[44px] min-w-[44px]"
                        onClick={() => openEdit(cashier)}
                        aria-label={`Edit ${cashier.displayName}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="min-h-[44px] min-w-[44px]"
                        onClick={() => toggleActive.mutate({ id: cashier.id, isActive: !cashier.isActive })}
                        aria-label={cashier.isActive ? `Deactivate ${cashier.displayName}` : `Reactivate ${cashier.displayName}`}
                      >
                        {cashier.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit cashier" : "Add cashier"}</DialogTitle>
            <DialogDescription>Cashier codes must be unique, e.g. 001, 002, 003.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cashier code</Label>
              <Input
                value={form.cashierCode}
                onChange={(e) => setForm({ ...form, cashierCode: e.target.value })}
                disabled={!!form.id}
                className="min-h-[44px]"
                data-testid="input-cashier-code"
              />
            </div>
            <div className="space-y-2">
              <Label>Display name</Label>
              <Input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="min-h-[44px]"
                data-testid="input-cashier-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Commission override (optional)</Label>
              <Input
                value={form.defaultCommissionRate}
                placeholder="Uses default rate"
                onChange={(e) => setForm({ ...form, defaultCommissionRate: e.target.value })}
                className="min-h-[44px]"
                data-testid="input-cashier-rate"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="min-h-[44px]">
              Cancel
            </Button>
            <Button
              onClick={() => saveCashier.mutate()}
              disabled={!form.cashierCode.trim() || !form.displayName.trim() || saveCashier.isPending}
              className="min-h-[44px]"
              data-testid="button-save-cashier"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
