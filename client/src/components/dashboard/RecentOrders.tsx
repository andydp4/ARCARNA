import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Truck, ShoppingBag } from "lucide-react";

/**
 * The last few orders, from /api/orders.
 *
 * The panel this replaces was a hardcoded "No recent orders available" with no
 * query behind it — it would have read empty forever regardless of trade. It was
 * the only unconditional empty state in the codebase.
 */

type OrderRow = {
  id: string;
  customerName: string | null;
  total: string | number | null;
  status: string | null;
  fulfilmentMethod: string | null;
  createdAt: string | null;
};

const LIMIT = 6;

function statusTone(status: string | null): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "secondary";
    case "urgent":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * Time only for a row from today (by the browser's local calendar day — this
 * is a display disambiguation, not a financial figure, so it does not need
 * the org's trading day). A date prefix for anything older, because "recent"
 * spans however far back LIMIT reaches, not just today — a row from three
 * days ago showing only "19:12" next to one from this morning showing
 * "10:55" reads as later today when it is not.
 */
function whenOf(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${time}`;
}

export function RecentOrders() {
  const { data: orders = [], isLoading } = useQuery<OrderRow[]>({
    queryKey: ["/api/orders"],
  });

  // /api/orders returns oldest-first, so the newest are at the end.
  const recent = [...orders].reverse().slice(0, LIMIT);

  return (
    <div className="lm-card rounded-xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-metal-warm-white sm:text-lg">Recent orders</h3>
        <Link
          href="/open-orders"
          className="text-sm text-truth hover:underline"
          data-testid="link-viewallorders"
        >
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <p className="py-8 text-center text-sm text-metal-muted">
          No orders yet. Takings will appear here as they come in.
        </p>
      ) : (
        <ul className="divide-y divide-[hsl(210,15%,78%/0.10)]">
          {recent.map((order) => (
            <li
              key={order.id}
              className="flex items-center justify-between gap-3 py-2.5"
              data-testid={`recent-order-${order.id}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {order.fulfilmentMethod === "delivery" ? (
                  <Truck className="h-4 w-4 shrink-0 text-metal-muted" aria-hidden />
                ) : (
                  <ShoppingBag className="h-4 w-4 shrink-0 text-metal-muted" aria-hidden />
                )}
                <span className="truncate text-sm font-medium text-metal-warm-white">
                  {order.customerName || "Walk-in"}
                </span>
                <span className="shrink-0 text-xs text-metal-muted">{whenOf(order.createdAt)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={statusTone(order.status)} className="text-[10px] capitalize">
                  {order.status || "pending"}
                </Badge>
                <span className="text-sm font-semibold tabular-nums text-metal-warm-white">
                  £{Number(order.total ?? 0).toFixed(2)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
