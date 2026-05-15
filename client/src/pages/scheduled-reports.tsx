import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, History } from "lucide-react";

type ScheduledReport = {
  id: string;
  name: string;
  reportType: string;
  frequency: string;
  deliveryMethods: unknown;
  isEnabled: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export default function ScheduledReportsPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    reportType: "business_health_snapshot",
    frequency: "daily",
    notificationCenter: true,
    downloadHistory: true,
    emailPlaceholder: false,
    isEnabled: 0,
  });

  const { data: reports = [], isLoading } = useQuery<ScheduledReport[]>({
    queryKey: ["/api/scheduled-reports"],
  });

  const { data: runs } = useQuery<{ items: unknown[] }>({
    queryKey: ["/api/scheduled-reports", historyId, "runs"],
    enabled: !!historyId,
    queryFn: async () => {
      const res = await fetch(`/api/scheduled-reports/${historyId}/runs`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const deliveryMethods: string[] = [];
      if (form.notificationCenter) deliveryMethods.push("notification_center");
      if (form.downloadHistory) deliveryMethods.push("download_history");
      if (form.emailPlaceholder) deliveryMethods.push("email_placeholder");
      if (deliveryMethods.length === 0) deliveryMethods.push("notification_center");
      return apiRequest("POST", "/api/scheduled-reports", {
        name: form.name,
        reportType: form.reportType,
        frequency: form.frequency,
        deliveryMethods,
        isEnabled: form.isEnabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-reports"] });
      setDialogOpen(false);
      toast({ title: "Scheduled report created" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (r: ScheduledReport) => {
      return apiRequest("PUT", `/api/scheduled-reports/${r.id}`, { isEnabled: r.isEnabled ? 0 : 1 });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/scheduled-reports"] }),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Scheduled reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Worker-driven snapshots. Delivery to notification center and run history — no outbound email.
          </p>
        </div>
        <Button
          onClick={() => {
            setForm({
              name: "",
              reportType: "business_health_snapshot",
              frequency: "daily",
              notificationCenter: true,
              downloadHistory: true,
              emailPlaceholder: false,
              isEnabled: 0,
            });
            setDialogOpen(true);
          }}
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          New schedule
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Schedules</CardTitle>
          <CardDescription>Idempotent per period via executionKey</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && reports.length === 0 && (
            <p className="text-sm text-muted-foreground">No scheduled reports.</p>
          )}
          {reports.map((r) => (
            <div
              key={r.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border rounded-lg p-3"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.reportType} · {r.frequency}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Next: {r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : "—"} · Last:{" "}
                  {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "—"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={r.isEnabled ? "default" : "secondary"}>
                  {r.isEnabled ? "Enabled" : "Disabled"}
                </Badge>
                <Switch checked={!!r.isEnabled} onCheckedChange={() => toggleMutation.mutate(r)} />
                <Button variant="outline" size="icon" onClick={() => setHistoryId(r.id)}>
                  <History className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!historyId} onOpenChange={(o) => !o && setHistoryId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run history</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[320px]">
            <ul className="space-y-2 text-sm">
              {(runs?.items ?? []).map((run: any) => (
                <li key={run.id} className="border rounded p-2">
                  <p className="font-medium">{run.status}</p>
                  <p className="text-xs text-muted-foreground">{run.executionKey}</p>
                  {run.errorMessage && <p className="text-xs text-destructive mt-1">{run.errorMessage}</p>}
                </li>
              ))}
              {historyId && (runs?.items?.length ?? 0) === 0 && (
                <p className="text-muted-foreground">No runs yet.</p>
              )}
            </ul>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New scheduled report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Report type</Label>
              <Select value={form.reportType} onValueChange={(v) => setForm({ ...form, reportType: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="revenue_summary">revenue_summary</SelectItem>
                  <SelectItem value="order_summary">order_summary</SelectItem>
                  <SelectItem value="inventory_health">inventory_health</SelectItem>
                  <SelectItem value="smart_stock_summary">smart_stock_summary</SelectItem>
                  <SelectItem value="business_health_snapshot">business_health_snapshot</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">daily</SelectItem>
                  <SelectItem value="weekly">weekly</SelectItem>
                  <SelectItem value="monthly">monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Delivery</Label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.notificationCenter}
                  onCheckedChange={(c) => setForm({ ...form, notificationCenter: !!c })}
                />
                Notification center
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.downloadHistory}
                  onCheckedChange={(c) => setForm({ ...form, downloadHistory: !!c })}
                />
                Download history (snapshot in runs)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.emailPlaceholder}
                  onCheckedChange={(c) => setForm({ ...form, emailPlaceholder: !!c })}
                />
                Email placeholder (no send)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!form.isEnabled}
                onCheckedChange={(c) => setForm({ ...form, isEnabled: c ? 1 : 0 })}
              />
              <span className="text-sm">Enable immediately</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
