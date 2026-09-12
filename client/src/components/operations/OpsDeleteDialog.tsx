import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAfterOrderMutation } from "@/lib/query-invalidation";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ActionLoader } from "@/components/action-loader";
import type { BoardOrder } from "@/lib/orderTypes";
import { formatPaymentLabel } from "@/lib/paymentLabel";

/**
 * Deleting an order from the board.
 *
 * Destructive, irreversible, and MANAGER+ only. The tick box is not ceremony:
 * this is a touchscreen on a counter, the confirm button sits where a "next
 * card" button sits on every other surface, and releasing reserved stock for
 * an order somebody is standing waiting for is not a mistake you can undo.
 * The dialog states what the order is — who, how much, how paid — so the
 * decision is made against the order rather than against an id.
 */
export interface OpsDeleteDialogProps {
  order: BoardOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OpsDeleteDialog({ order, open, onOpenChange }: OpsDeleteDialogProps) {
  const { toast } = useToast();
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) setAcknowledged(false);
  }, [open]);

  const remove = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("No order selected");
      const response = await apiRequest("DELETE", `/api/orders/${order.id}`);
      return response.json();
    },
    onSuccess: async () => {
      await invalidateAfterOrderMutation(queryClient);
      toast({
        title: "Order deleted",
        description: "The order is gone and its reserved stock has been released.",
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Could not delete the order",
        description: error?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `liquid-metal`: Radix portals dialog content to <body>, outside the
          shell that scopes the theme's tokens (see OpsDetailsSheet). */}
      <DialogContent className="liquid-metal border-destructive/20 bg-background text-foreground sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete this order?</DialogTitle>
          <DialogDescription>
            Order #{order?.shortCode} — this cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Stock reserved for this order will be released. Customer and payment records elsewhere
            are not affected.
          </p>
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            <p className="font-medium text-foreground">{order?.customerName ?? "Walk-in"}</p>
            <p className="mt-1 tabular-nums text-muted-foreground">
              Total £{order?.total ? parseFloat(order.total).toFixed(2) : "0.00"} ·{" "}
              {formatPaymentLabel(order?.paymentMethod ?? "")}
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <Checkbox
              id="ops-delete-ack"
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              className="mt-0.5"
              data-testid="checkbox-delete-ack"
            />
            <Label htmlFor="ops-delete-ack" className="cursor-pointer text-sm font-normal leading-snug">
              I understand this order will be permanently deleted.
            </Label>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between sm:gap-0">
          <Button
            size="touch"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-delete"
          >
            Cancel
          </Button>
          <Button
            size="touch"
            variant="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending || !acknowledged}
            data-testid="button-confirm-delete"
          >
            {remove.isPending ? (
              <>
                <ActionLoader className="text-destructive-foreground" />
                Deleting…
              </>
            ) : (
              "Delete permanently"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
