import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/appPaths";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ActionLoader } from "@/components/action-loader";
import type { TickCustomer } from "@/pages/tick-list";

/**
 * What a credit customer's balance is made up of.
 *
 * Clicking a customer on the credit list used to do nothing — this is the
 * "minimum summary of totals and order numbers" that was missing. The order
 * list itself comes with the customer (`/api/tick-customers` already groups
 * every outstanding/partial credit row per customer); only a single order's
 * line items are fetched here, lazily, and only once it's expanded — the
 * same `GET /api/orders/:id` the Operations board's own details sheet uses,
 * so a customer with a long history doesn't pull every line for every order
 * up front.
 */

export interface CreditCustomerDetailDialogProps {
  customer: TickCustomer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreditCustomerDetailDialog({ customer, open, onOpenChange }: CreditCustomerDetailDialogProps) {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  if (!customer) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setExpandedOrderId(null);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{customer.name}</DialogTitle>
          <DialogDescription>
            {[customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact details on file"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total outstanding</p>
            <p className="text-2xl font-bold tabular-nums text-foreground" data-testid="text-detail-total-debt">
              £{(customer.totalDebt || 0).toFixed(2)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Made up from</p>
            <p className="text-lg font-semibold text-foreground">
              {customer.orders.length} order{customer.orders.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Orders</h3>
          {customer.orders.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {customer.orders.map((order) => {
                const expanded = expandedOrderId === order.id;
                return (
                  <li key={order.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-accent/50"
                      onClick={() => setExpandedOrderId(expanded ? null : order.id)}
                      aria-expanded={expanded}
                      data-testid={`button-credit-order-${order.id}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">Order #{order.shortCode}</span>
                          <span className="block text-sm text-muted-foreground">
                            {order.date ? new Date(order.date).toLocaleDateString() : "Unknown date"}
                          </span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-right">
                          <span className="block font-semibold tabular-nums text-foreground">
                            £{order.amountOutstanding.toFixed(2)}
                          </span>
                          {order.status === "partial" && (
                            <span className="block text-xs text-muted-foreground">
                              of £{order.amountGiven.toFixed(2)}
                            </span>
                          )}
                        </span>
                        <Badge variant={order.status === "partial" ? "secondary" : "destructive"}>
                          {order.status === "partial" ? "Partial" : "Pending"}
                        </Badge>
                      </span>
                    </button>
                    {expanded && <CreditOrderLines orderId={order.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface OrderLineDetail {
  items?: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: string;
    total: string;
  }>;
}

function CreditOrderLines({ orderId }: { orderId: string }) {
  const { data, isLoading } = useQuery<OrderLineDetail>({
    queryKey: ["/api/orders", orderId],
    queryFn: async () => {
      const response = await apiFetch(`/api/orders/${orderId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load this order");
      return response.json();
    },
  });

  const items = data?.items ?? [];

  return (
    <div className="border-t border-border bg-muted/30 px-3 py-2" data-testid={`credit-order-lines-${orderId}`}>
      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <ActionLoader className="size-4 text-primary" />
          Loading what they had…
        </div>
      ) : items.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No lines on this order.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="text-foreground">
                {line.productName || "Unknown product"}
                <span className="text-muted-foreground">
                  {" "}
                  · {line.quantity} × £{Number(line.unitPrice ?? 0).toFixed(2)}
                </span>
              </span>
              <span className="font-medium tabular-nums text-foreground">
                £{Number(line.total ?? 0).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
