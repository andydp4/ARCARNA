/**
 * Order operations capture — collection ETA, queue position and delay details.
 * Feeds ARC-T1-003 (Order Status Dashboard) and ARC-T1-005 (Delay Log).
 *
 * The Delay Log's headline measure is whether the customer was warned BEFORE
 * the original ETA passed, so "Customer told just now" is a first-class control
 * here rather than a detail buried in notes.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/appPaths";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DELAY_CAUSES } from "@shared/delayCauses";



export interface OrderOpsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  customerName?: string | null;
}

/** datetime-local value → ISO, or undefined when blank. */
function toIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function OrderOpsDialog({ open, onOpenChange, orderId, customerName }: OrderOpsDialogProps) {
  const { toast } = useToast();
  const [queuePosition, setQueuePosition] = useState("");
  const [etaGiven, setEtaGiven] = useState("");
  const [delayFlag, setDelayFlag] = useState(false);
  const [delayCause, setDelayCause] = useState<string>("");
  const [delayReason, setDelayReason] = useState("");
  const [revisedEta, setRevisedEta] = useState("");
  const [notifyNow, setNotifyNow] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (queuePosition !== "") body.queuePosition = parseInt(queuePosition, 10);
      const eta = toIso(etaGiven);
      if (eta) body.etaGiven = eta;
      body.delayFlag = delayFlag;
      if (delayFlag) {
        if (delayCause) body.delayCause = delayCause;
        if (delayReason.trim()) body.delayReason = delayReason.trim();
        const rev = toIso(revisedEta);
        if (rev) body.revisedEta = rev;
        if (notifyNow) body.notifyCustomerNow = true;
      }

      const res = await apiFetch(`/api/orders/${orderId}/operations`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || "Failed to update order");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: delayFlag ? "Delay recorded" : "Order updated",
        description: delayFlag
          ? "It will appear in the Delay Log and on the Order Status Dashboard."
          : "Collection details saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports", "ARC-T1-003"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports", "ARC-T1-005"] });
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({ title: "Could not update order", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Collection details</DialogTitle>
          <DialogDescription>
            {customerName ? `${customerName}'s order.` : "This order."} Sets the queue and ETA shown on the Order
            Status Dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="queue-pos">Queue position</Label>
              <Input
                id="queue-pos"
                type="number"
                min="0"
                value={queuePosition}
                onChange={(e) => setQueuePosition(e.target.value)}
                placeholder="1 = next"
                data-testid="input-queue-position"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eta-given">Collection ETA</Label>
              <Input
                id="eta-given"
                type="datetime-local"
                value={etaGiven}
                onChange={(e) => setEtaGiven(e.target.value)}
                data-testid="input-eta-given"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="delay-flag">This order is delayed</Label>
              <p className="text-xs text-muted-foreground">Adds it to today's Delay Log.</p>
            </div>
            <Switch id="delay-flag" checked={delayFlag} onCheckedChange={setDelayFlag} data-testid="switch-delay" />
          </div>

          {delayFlag && (
            <div className="space-y-4 rounded-lg border border-destructive/30 p-3">
              <div className="space-y-2">
                <Label>What caused it?</Label>
                <Select value={delayCause} onValueChange={setDelayCause}>
                  <SelectTrigger data-testid="select-delay-cause">
                    <SelectValue placeholder="Choose a cause" />
                  </SelectTrigger>
                  <SelectContent>
                    {DELAY_CAUSES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="revised-eta">Revised ETA</Label>
                <Input
                  id="revised-eta"
                  type="datetime-local"
                  value={revisedEta}
                  onChange={(e) => setRevisedEta(e.target.value)}
                  data-testid="input-revised-eta"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delay-reason">Detail (optional)</Label>
                <Input
                  id="delay-reason"
                  value={delayReason}
                  onChange={(e) => setDelayReason(e.target.value)}
                  placeholder="What happened?"
                  data-testid="input-delay-reason"
                />
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/50 p-2">
                <div>
                  <Label htmlFor="notify-now" className="text-sm">
                    Customer told just now
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Telling them before the original ETA counts as proactive.
                  </p>
                </div>
                <Switch id="notify-now" checked={notifyNow} onCheckedChange={setNotifyNow} data-testid="switch-notify" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()} data-testid="button-save-order-ops">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
