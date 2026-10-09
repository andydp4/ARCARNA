/**
 * Past orders for the customer on the till. Managers and above.
 * Each order is a real link, so a new tab opens it without leaving this sale.
 * A normal click tells the till to remember the sale first.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { getJson } from "@/lib/queryClient";

type HistoryOrder = {
  id: string;
  reference: string;
  createdAt: string | null;
  status: string | null;
  total: string;
};

type HistoryPage = {
  total: number;
  orders: HistoryOrder[];
  nextOffset: number | null;
};

function when(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function PosCustomerHistory({
  customerId,
  onBeforeLeave,
}: {
  customerId: string;
  onBeforeLeave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOpen(false);
    setOrders([]);
    setTotal(null);
    setError(null);
    setLoading(true);
    getJson<HistoryPage>(`/api/customers/${customerId}/orders?limit=20&offset=0`)
      .then((page) => {
        if (cancelled) return;
        setOrders(page.orders);
        setTotal(page.total);
        setNextOffset(page.nextOffset);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load past orders.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, attempt]);

  async function loadMore() {
    if (nextOffset == null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await getJson<HistoryPage>(
        `/api/customers/${customerId}/orders?limit=20&offset=${nextOffset}`,
      );
      setOrders((current) => [...current, ...page.orders]);
      setTotal(page.total);
      setNextOffset(page.nextOffset);
    } catch {
      setError("Could not load more orders.");
    } finally {
      setLoading(false);
    }
  }

  const countLabel = total == null ? "" : ` (${total})`;

  return (
    <div className="mt-3" data-testid="customer-order-history">
      <button
        type="button"
        className="text-sm font-medium text-metal-warm-white underline underline-offset-2"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        data-testid="button-customer-history"
      >
        View all past orders{countLabel}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {error && (
            <p className="text-sm text-destructive" data-testid="customer-history-error">
              {error}{" "}
              <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </button>
            </p>
          )}
          {!error && !loading && orders.length === 0 && (
            <p className="text-sm text-metal-muted">No past orders.</p>
          )}
          <ul className="space-y-1">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  onClick={() => onBeforeLeave()}
                  className="flex items-baseline justify-between gap-2 rounded-md px-1 py-1 text-sm hover:bg-white/5"
                  data-testid={`customer-history-${order.id}`}
                >
                  <span className="font-mono text-truth">{order.reference}</span>
                  <span className="min-w-0 flex-1 truncate text-metal-muted">
                    {when(order.createdAt)}
                    {order.status ? ` · ${order.status}` : ""}
                  </span>
                  <span className="tabular-nums">£{Number(order.total).toFixed(2)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {loading && <p className="text-sm text-metal-muted">Loading…</p>}
          {nextOffset != null && !loading && (
            <button type="button" className="text-sm underline" onClick={() => void loadMore()} data-testid="button-customer-history-more">
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
