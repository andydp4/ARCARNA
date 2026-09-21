import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Minus } from "lucide-react";
import { apiFetch } from "@/lib/appPaths";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAfterOrderMutation } from "@/lib/query-invalidation";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ActionLoader } from "@/components/action-loader";
import { parseQuantityInput } from "@shared/quantity";
import type { BoardOrder } from "@/lib/orderTypes";
import { ProductSearch } from "@/components/pos-order-lines";
import { posPrice, type PosProduct } from "@/components/pos-types";

/**
 * Correcting what is on an order, from the board.
 *
 * MANAGER+ only, because `PUT /api/orders/:id` is — a cashier is never shown a
 * control that would come back 403. The write goes through the same endpoint
 * the Open Orders dialog used, including its warnings (a re-priced line can
 * move the order's status), which are surfaced rather than swallowed.
 *
 * A Dialog is correct here and nowhere else on this screen: this is a
 * deliberate, rare, manager-level correction, not counter work, and it is
 * never reachable from the phone's Order tab (brief, UI → Form embedding).
 */

interface EditLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface OpsEditDialogProps {
  order: BoardOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OpsEditDialog({ order, open, onOpenChange }: OpsEditDialogProps) {
  const { toast } = useToast();
  const [lines, setLines] = useState<EditLine[]>([]);
  const [loading, setLoading] = useState(false);

  // Only fetched while the dialog is actually open — this dialog is a rare,
  // deliberate correction, not counter work, so there is no reason to hold a
  // product-catalogue subscription open for the rest of the board's life.
  const { data: products = [] } = useQuery<PosProduct[]>({
    queryKey: ["/api/products"],
    enabled: open,
  });

  const addProduct = (product: PosProduct) => {
    setLines((current) => {
      const existing = current.findIndex((line) => line.productId === product.id);
      if (existing >= 0) {
        return current.map((line, i) => (i === existing ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [...current, { productId: product.id, productName: product.name, quantity: 1, unitPrice: posPrice(product) }];
    });
  };

  useEffect(() => {
    if (!open || !order) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await apiFetch(`/api/orders/${order.id}`, { credentials: "include" });
        const detail = await response.json();
        if (cancelled) return;
        setLines(
          (detail.items ?? []).map((line: any) => ({
            productId: line.productId,
            productName: line.productName,
            quantity: line.quantity,
            unitPrice: parseFloat(line.unitPrice),
          })),
        );
      } catch (error) {
        toast({
          title: "Could not load the order's lines",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, order, toast]);

  const save = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("No order selected");
      const response = await apiRequest("PUT", `/api/orders/${order.id}`, {
        lines: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });
      return response.json();
    },
    onSuccess: async (data: any) => {
      await invalidateAfterOrderMutation(queryClient);
      if (data?.warnings?.length) {
        toast({
          title: "Order updated, with warnings",
          description: `${data.warnings.join(". ")}. The status may have changed.`,
          variant: "destructive",
          duration: 8000,
        });
      } else {
        toast({ title: "Order updated", description: "The lines have been saved." });
      }
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Could not update the order",
        description: error?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `liquid-metal`: Radix portals dialog content to <body>, outside the
          shell that scopes the theme's tokens (see OpsDetailsSheet). */}
      <DialogContent className="liquid-metal max-h-[85vh] overflow-y-auto bg-background text-foreground sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Edit order #{order?.shortCode}</DialogTitle>
          <DialogDescription>
            Add items, change quantities and prices, or remove a line if you mean to drop that item.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <ActionLoader className="size-5 text-primary" />
              Loading the order's lines…
            </div>
          ) : (
            <>
              <ProductSearch products={products} onPick={addProduct} testId="ops-edit-add-product" />
              {lines.map((line, index) => (
                <div key={`${line.productId}-${index}`} className="rounded-lg border border-border p-3">
                <p className="font-medium text-foreground">{line.productName}</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`ops-edit-qty-${index}`} className="text-xs text-muted-foreground">
                      Quantity
                    </Label>
                    <Input
                      id={`ops-edit-qty-${index}`}
                      type="number"
                      min="0.001"
                      step="0.001"
                      className="min-h-11"
                      value={line.quantity}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((existing, i) =>
                            i === index
                              ? {
                                  ...existing,
                                  quantity: parseQuantityInput(event.target.value) ?? existing.quantity,
                                }
                              : existing,
                          ),
                        )
                      }
                      data-testid={`input-edit-quantity-${index}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`ops-edit-price-${index}`} className="text-xs text-muted-foreground">
                      Unit price
                    </Label>
                    <Input
                      id={`ops-edit-price-${index}`}
                      type="number"
                      min="0"
                      step="0.01"
                      className="min-h-11"
                      value={line.unitPrice}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((existing, i) =>
                            i === index
                              ? { ...existing, unitPrice: parseFloat(event.target.value) || 0 }
                              : existing,
                          ),
                        )
                      }
                      data-testid={`input-edit-price-${index}`}
                    />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs tabular-nums text-muted-foreground">
                    Line total £{(line.quantity * line.unitPrice).toFixed(2)}
                  </p>
                  <Button
                    size="touch"
                    variant="outline"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    aria-label={`Remove ${line.productName} from the order`}
                    data-testid={`button-remove-line-${index}`}
                  >
                    <Minus className="h-4 w-4" aria-hidden />
                    Remove line
                  </Button>
                </div>
                </div>
              ))}
            </>
          )}

          {!loading && lines.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No lines left. Add at least one item before saving.
            </p>
          )}

          <Separator />
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">New total</span>
            <span className="text-xl font-bold tabular-nums text-foreground">£{total.toFixed(2)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button size="touch" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit">
            Cancel
          </Button>
          <Button
            size="touch"
            onClick={() => save.mutate()}
            disabled={save.isPending || lines.length === 0}
            data-testid="button-save-edit"
          >
            {save.isPending ? (
              <>
                <ActionLoader className="text-primary-foreground" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
