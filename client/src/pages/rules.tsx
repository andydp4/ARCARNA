import { useState } from "react";
import { apiFetch } from "@/lib/appPaths";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, History } from "lucide-react";

type AutomationRule = {
  id: string;
  name: string;
  triggerEventType: string;
  conditionJson: unknown;
  actionJson: unknown;
  priority: number;
  isEnabled: number;
  executionCount: number;
  lastTriggeredAt: string | null;
};

const defaultCondition = `{
  "logic": "and",
  "checks": [
    { "field": "order.total", "op": "gte", "value": 50 }
  ]
}`;

const defaultAction = `{
  "type": "in_app_notification",
  "title": "High value order",
  "message": "An order met your automation rule.",
  "severity": "info"
}`;

export default function RulesPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyRule, setHistoryRule] = useState<AutomationRule | null>(null);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [form, setForm] = useState({
    name: "",
    triggerEventType: "OrderCreated",
    priority: 100,
    isEnabled: 0,
    conditionJson: defaultCondition,
    actionJson: defaultAction,
  });

  const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ["/api/rules"],
  });

  const { data: executions } = useQuery<{ items: unknown[] }>({
    queryKey: ["/api/rules", historyRule?.id, "executions"],
    enabled: !!historyRule,
    queryFn: async () => {
      const res = await apiFetch(`/api/rules/${historyRule!.id}/executions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load executions");
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      let condition: unknown;
      let action: unknown;
      try {
        condition = JSON.parse(form.conditionJson || "{}");
        action = JSON.parse(form.actionJson || "{}");
      } catch {
        throw new Error("Invalid JSON");
      }
      const body = {
        name: form.name,
        triggerEventType: form.triggerEventType,
        priority: form.priority,
        isEnabled: form.isEnabled,
        conditionJson: condition,
        actionJson: action,
      };
      if (editing) {
        return apiRequest("PUT", `/api/rules/${editing.id}`, body);
      }
      return apiRequest("POST", "/api/rules", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      setDialogOpen(false);
      setEditing(null);
      toast({ title: "Saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: "",
      triggerEventType: "OrderCreated",
      priority: 100,
      isEnabled: 0,
      conditionJson: defaultCondition,
      actionJson: defaultAction,
    });
    setDialogOpen(true);
  };

  const openEdit = (r: AutomationRule) => {
    setEditing(r);
    setForm({
      name: r.name,
      triggerEventType: r.triggerEventType,
      priority: r.priority,
      isEnabled: r.isEnabled,
      conditionJson: JSON.stringify(r.conditionJson ?? {}, null, 2),
      actionJson: JSON.stringify(r.actionJson ?? {}, null, 2),
    });
    setDialogOpen(true);
  };

  const toggleMutation = useMutation({
    mutationFn: async (r: AutomationRule) => {
      return apiRequest("PUT", `/api/rules/${r.id}`, { isEnabled: r.isEnabled ? 0 : 1 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
    },
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Automation rules</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Event-driven rules (disabled by default). Actions never emit order events — no recursion.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-1" data-testid="rules-add">
          <Plus className="h-4 w-4" />
          New rule
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>Triggers: OrderCreated, PaymentCaptured, OrderStatusChanged</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && rules.length === 0 && (
            <p className="text-sm text-muted-foreground">No rules yet. Create one to get started.</p>
          )}
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border rounded-lg p-3"
              data-testid={`rule-row-${r.id}`}
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.triggerEventType} · priority {r.priority} · runs {r.executionCount}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={r.isEnabled ? "default" : "secondary"}>
                  {r.isEnabled ? "Enabled" : "Disabled"}
                </Badge>
                <Switch
                  checked={!!r.isEnabled}
                  onCheckedChange={() => toggleMutation.mutate(r)}
                  aria-label="Toggle rule"
                />
                <Button variant="outline" size="icon" onClick={() => openEdit(r)} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => setHistoryRule(r)} aria-label="History">
                  <History className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!historyRule} onOpenChange={(o) => !o && setHistoryRule(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Execution history — {historyRule?.name}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[360px] pr-3">
            <ul className="space-y-2 text-sm">
              {(executions?.items ?? []).map((row: any, i: number) => {
                const rr = row?.data?.ruleRun;
                const why = rr?.semanticStatus ?? row?.status ?? "unknown";
                return (
                  <li key={row.logId || i} className="border rounded p-2">
                    <p className="font-medium">{why}</p>
                    <p className="text-xs text-muted-foreground">{row.summary}</p>
                    {rr?.conditionResult && (
                      <pre className="text-[10px] mt-1 overflow-x-auto bg-muted/50 p-1 rounded">
                        {JSON.stringify(rr.conditionResult, null, 2)}
                      </pre>
                    )}
                  </li>
                );
              })}
              {historyRule && (executions?.items?.length ?? 0) === 0 && (
                <p className="text-muted-foreground text-sm">No executions logged yet.</p>
              )}
            </ul>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit rule" : "Create rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Trigger</Label>
              <Select
                value={form.triggerEventType}
                onValueChange={(v) => setForm({ ...form, triggerEventType: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OrderCreated">OrderCreated</SelectItem>
                  <SelectItem value="PaymentCaptured">PaymentCaptured</SelectItem>
                  <SelectItem value="OrderStatusChanged">OrderStatusChanged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <Label>Priority (lower runs first)</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  checked={!!form.isEnabled}
                  onCheckedChange={(c) => setForm({ ...form, isEnabled: c ? 1 : 0 })}
                />
                <span className="text-sm">Enabled</span>
              </div>
            </div>
            <div>
              <Label>Condition JSON</Label>
              <Textarea
                rows={8}
                className="font-mono text-xs"
                value={form.conditionJson}
                onChange={(e) => setForm({ ...form, conditionJson: e.target.value })}
              />
            </div>
            <div>
              <Label>Action JSON</Label>
              <Textarea
                rows={8}
                className="font-mono text-xs"
                value={form.actionJson}
                onChange={(e) => setForm({ ...form, actionJson: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Actions: in_app_notification (type notify) or tag_customer with category.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
