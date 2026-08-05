import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, ClipboardList, ShoppingBag, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The "what is happening right now" row.
 *
 * Everything here is a count of real rows with a destination attached. No tile
 * renders a figure it cannot substantiate, and no tile is decorative — the
 * previous dashboard had four buttons that did nothing and a Recent Orders panel
 * hardcoded to "No recent orders available", which is what made the whole page
 * untrustworthy at a glance.
 */

type OrderRow = {
  id: string;
  status: string | null;
  fulfilmentMethod: string | null;
  createdAt: string | null;
};

type Tile = {
  label: string;
  value: number;
  href: string;
  icon: LucideIcon;
  tone: "neutral" | "warn";
  testId: string;
  hint: string;
};

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function OperationsSnapshot() {
  const { data: orders = [], isLoading: ordersLoading } = useQuery<OrderRow[]>({
    queryKey: ["/api/orders"],
  });

  const { data: stock, isLoading: stockLoading } = useQuery<{
    summary?: { critical: number; high: number; medium: number; total: number };
  }>({
    queryKey: ["/api/inventory/alerts"],
  });

  const open = orders.filter((o) => o.status !== "completed");
  // Fulfilment defaults to collection at the column level, so an order with a
  // null here (written before migration 047) counts as a collection rather than
  // disappearing from both tiles.
  const toDeliver = open.filter((o) => o.fulfilmentMethod === "delivery").length;
  const toCollect = open.length - toDeliver;
  const completedToday = orders.filter(
    (o) => o.status === "completed" && isToday(o.createdAt),
  ).length;
  const lowStock = stock?.summary?.total ?? 0;

  const isLoading = ordersLoading || stockLoading;

  const tiles: Tile[] = [
    {
      label: "Open orders",
      value: open.length,
      href: "/open-orders",
      icon: ClipboardList,
      tone: "neutral",
      testId: "snapshot-open-orders",
      hint: "Not yet completed",
    },
    {
      label: "To collect",
      value: toCollect,
      href: "/open-orders",
      icon: ShoppingBag,
      tone: "neutral",
      testId: "snapshot-to-collect",
      hint: "Waiting at the counter",
    },
    {
      label: "To deliver",
      value: toDeliver,
      href: "/open-orders",
      icon: Truck,
      tone: "neutral",
      testId: "snapshot-to-deliver",
      hint: "Going out on a round",
    },
    {
      label: "Completed today",
      value: completedToday,
      href: "/orders",
      icon: CheckCircle2,
      tone: "neutral",
      testId: "snapshot-completed-today",
      hint: "Settled since midnight",
    },
    {
      label: "Low stock",
      value: lowStock,
      // Straight to Replenishment, where a low line becomes a purchase draft —
      // the tile names a problem, so it links to the thing that fixes it.
      href: "/inventory?tab=replenishment",
      icon: AlertTriangle,
      tone: lowStock > 0 ? "warn" : "neutral",
      testId: "snapshot-low-stock",
      hint: lowStock > 0 ? "Restock these" : "Nothing below par",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Skeleton key={t.testId} className="h-[104px] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <Link
            key={tile.testId}
            href={tile.href}
            data-testid={tile.testId}
            className={[
              "group rounded-xl border p-4 transition-colors",
              tile.tone === "warn"
                ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                : "border-border bg-card hover:bg-muted",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tile.label}
              </span>
              <Icon
                className={[
                  "h-4 w-4 shrink-0",
                  tile.tone === "warn" ? "text-amber-500" : "text-muted-foreground",
                ].join(" ")}
                aria-hidden
              />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
              {tile.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{tile.hint}</p>
          </Link>
        );
      })}
    </div>
  );
}
