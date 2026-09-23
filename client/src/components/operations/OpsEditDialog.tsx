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
  /**
   * What is in the price box, as typed. Kept as text so an emptied box stays
   * empty and blocks saving — it used to become £0 (`parseFloat("") || 0`)
   * and save the line free.
   */
  priceText: string;
}

/** The price in the box, or null when it is empty or not a price. */
function linePrice(line: EditLine): number | null {
  const text = line.priceText.trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The server's price for the edit (POST /api/orders/:id/edit-preview). */
interface EditPreview {
  editable: boolean;
  code?: string;
  message?: string;
  pricing?: {
    subtotal: number;
    tierDiscount: number;
    promoDiscount: number;
    pointsDiscount: number;
    vatRate: number;
    vatAmount: number;
    total: number;
  } | null;
}

function money(n: number): string {
  return `£${n.toFixed(2)}`;
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
      return [
        ...current,
        { productId: product.id, productName: product.name, quantity: 1, priceText: String(posPrice(product)) },
      ];
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
            priceText: String(parseFloat(line.unitPrice)),
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

  const missingPrice = lines.find((line) => linePrice(line) === null) ?? null;
  const payloadLines = missingPrice
    ? null
    : lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: linePrice(line) as number }));

  // Subtotal, VAT and Total come from the server, priced exactly as the save
  // will be: the org's VAT rate, the sale's own discounts kept. It also says
  // up front when the order cannot be edited (paid in several parts, ...).
  const preview = useQuery<EditPreview>({
    queryKey: ["/api/orders", order?.id, "edit-preview", payloadLines],
    enabled: open && !!order && !loading && lines.length > 0 && payloadLines !== null,
    queryFn: async () => {
      const response = await apiRequest("POST", `/api/orders/${order!.id}/edit-preview`, { lines: payloadLines });
      return response.json();
    },
    staleTime: 0,
  });
  const refusal = preview.data && !preview.data.editable ? preview.data.message : null;
  // A refused price (points worth more than the new total) or a failed
  // preview (no VAT rate set) blocks saving, and says why.
  const pricingProblem =
    (preview.data?.editable && !preview.data.pricing ? preview.data.message : null) ??
    (preview.error instanceof Error ? preview.error.message : null);

  const save = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("No order selected");
      if (!payloadLines) throw new Error("Enter a price for every line.");
      const response = await apiRequest("PUT", `/api/orders/${order.id}`, { lines: payloadLines });
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
        toast({
          title: "Order updated",
          description: data?.pricing ? `New total ${money(data.pricing.total)}.` : "The lines have been saved.",
        });
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

  const pricing = preview.data?.pricing ?? null;
  const discounts = pricing ? pricing.tierDiscount + pricing.promoDiscount + pricing.pointsDiscount : 0;

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
                      value={line.priceText}
                      aria-invalid={linePrice(line) === null}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((existing, i) =>
                            i === index ? { ...existing, priceText: event.target.value } : existing,
                          ),
                        )
                      }
                      data-testid={`input-edit-price-${index}`}
                    />
                    {linePrice(line) === null && (
                      <p className="text-xs text-destructive" data-testid={`text-edit-price-missing-${index}`}>
                        Enter a price (0 if it is free).
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs tabular-nums text-muted-foreground">
                    Line total {linePrice(line) === null ? "—" : money(line.quantity * (linePrice(line) as number))}
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

          {refusal && (
            <p className="rounded-md border border-destructive/50 p-3 text-sm text-destructive" data-testid="text-edit-refused">
              {refusal}
            </p>
          )}
          {pricingProblem && (
            <p className="rounded-md border border-destructive/50 p-3 text-sm text-destructive" data-testid="text-edit-pricing-problem">
              {pricingProblem}
            </p>
          )}

          <Separator />
          <dl className="space-y-1 text-sm" data-testid="edit-totals">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums text-foreground" data-testid="text-edit-subtotal">
                {pricing ? money(pricing.subtotal) : "—"}
              </dd>
            </div>
            {pricing && discounts > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Discounts kept</dt>
                <dd className="tabular-nums text-foreground" data-testid="text-edit-discounts">
                  −{money(discounts)}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">VAT{pricing ? ` (${pricing.vatRate}%)` : ""}</dt>
              <dd className="tabular-nums text-foreground" data-testid="text-edit-vat">
                {pricing ? money(pricing.vatAmount) : "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between pt-1">
              <dt className="font-semibold text-foreground">Total</dt>
              <dd className="text-xl font-bold tabular-nums text-foreground" data-testid="text-edit-total">
                {pricing ? money(pricing.total) : "—"}
              </dd>
            </div>
          </dl>
        </div>

        <DialogFooter>
          <Button size="touch" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit">
            Cancel
          </Button>
          <Button
            size="touch"
            onClick={() => save.mutate()}
            disabled={
              save.isPending || lines.length === 0 || !payloadLines || !!refusal || !!pricingProblem || !pricing
            }
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
