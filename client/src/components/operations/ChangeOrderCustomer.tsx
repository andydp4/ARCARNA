/**
 * Move an open order onto another customer. The server refuses finished
 * orders, credit already opened, and orders that already used points.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { getJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { OPS_BOARD_QUERY_KEY } from "@/hooks/useOpsBoard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoardOrder } from "@/lib/orderTypes";

export function ChangeOrderCustomer({ order }: { order: BoardOrder }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const customers = useQuery({
    queryKey: ["/api/customers", "reassign"],
    enabled: open,
    queryFn: () => getJson<Array<{ id: string; name: string }>>("/api/customers"),
  });
  if (order.status === "completed") return null;

  const needle = search.trim().toLowerCase();
  const matches = (customers.data ?? [])
    .filter((customer) => !needle || customer.name.toLowerCase().includes(needle))
    .slice(0, 8);

  async function choose(customerId: string | null) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/orders/${order.id}/customer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Could not change the customer",
          description: typeof body.message === "string" ? body.message : "Try again.",
          variant: "destructive",
        });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: OPS_BOARD_QUERY_KEY });
      toast({ title: customerId ? "Customer updated" : "Set to Walk-in" });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-sm underline"
        onClick={() => setOpen((current) => !current)}
        data-testid="button-change-customer"
      >
        Change customer
      </button>
      {open && (
        <div className="mt-2 space-y-2" data-testid="change-customer-panel">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers"
            aria-label="Search customers"
            className="min-h-11"
          />
          <ul className="space-y-1">
            {matches.map((customer) => (
              <li key={customer.id}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start"
                  disabled={busy}
                  onClick={() => void choose(customer.id)}
                >
                  {customer.name}
                </Button>
              </li>
            ))}
          </ul>
          {order.paymentMethod !== "tick" && (
            <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => void choose(null)}>
              Walk-in
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
