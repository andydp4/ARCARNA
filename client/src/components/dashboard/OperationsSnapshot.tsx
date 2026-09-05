import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, ClipboardList, ShoppingBag, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CONTROL_CENTRE_QUERY_KEY, type ControlCentreSnapshot } from "@/lib/controlCentre";

/**
 * The "what is happening right now" row — every count sourced from the one
 * Control Centre snapshot rather than fetching /api/orders and
 * /api/inventory/alerts separately and re-deriving them client-side.
 *
 * "Completed today" in particular used to be computed here by filtering
 * /api/orders on createdAt falling on the browser's local calendar day. That
 * missed every order taken one trading day and handed over the next — the
 * normal case for a pick-and-pack shop — and used a third definition of
 * "today" from the one revenue and the order count above it were using. The
 * snapshot now counts it the same way everything else on this page does: by
 * settlement, within the trading day.
 */

type Tile = {
  label: string;
  value: number;
  href: string;
  icon: LucideIcon;
  tone: "neutral" | "warn";
  testId: string;
  hint: string;
};

export function OperationsSnapshot() {
  const { data, isLoading } = useQuery<ControlCentreSnapshot>({
    queryKey: CONTROL_CENTRE_QUERY_KEY,
    refetchInterval: 60_000,
  });

  const lowStock = data?.lowStockCount ?? 0;

  const tiles: Tile[] = [
    {
      label: "Open orders",
      value: data?.openOrders ?? 0,
      href: "/open-orders",
      icon: ClipboardList,
      tone: "neutral",
      testId: "snapshot-open-orders",
      hint: "Not yet completed",
    },
    {
      label: "To collect",
      value: data?.toCollect ?? 0,
      href: "/open-orders",
      icon: ShoppingBag,
      tone: "neutral",
      testId: "snapshot-to-collect",
      hint: "Waiting at the counter",
    },
    {
      label: "To deliver",
      value: data?.toDeliver ?? 0,
      href: "/open-orders",
      icon: Truck,
      tone: "neutral",
      testId: "snapshot-to-deliver",
      hint: "Going out on a round",
    },
    {
      label: "Completed today",
      value: data?.ordersCompletedToday ?? 0,
      href: "/orders",
      icon: CheckCircle2,
      tone: "neutral",
      testId: "snapshot-completed-today",
      hint: "Settled this trading day",
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
              "group lm-card rounded-xl p-4 transition-colors",
              tile.tone === "warn" ? "border-amber-500/40 hover:bg-amber-500/5" : "hover:bg-[hsl(215,10%,18%/0.5)]",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-metal-muted">{tile.label}</span>
              <Icon
                className={["h-4 w-4 shrink-0", tile.tone === "warn" ? "text-warning" : "text-metal-muted"].join(" ")}
                aria-hidden
              />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-metal-warm-white">
              {tile.value}
            </p>
            <p className="mt-1 text-xs text-metal-muted">{tile.hint}</p>
          </Link>
        );
      })}
    </div>
  );
}
