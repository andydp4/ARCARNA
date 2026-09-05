import { useQuery } from "@tanstack/react-query";
import { Activity, Package, TrendingUp, Users } from "lucide-react";
import { CONTROL_CENTRE_QUERY_KEY, money, type ControlCentreSnapshot } from "@/lib/controlCentre";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The raw numbers, as distinct from Next Moves. Everything actionable
 * (missing close, dead letters, stock risk, credit outstanding, pending
 * approvals) lives in Next Moves so it is said once, not twice; this is
 * purely "what is the state of things", including worker health, which is
 * background-process plumbing rather than a business truth in its own right.
 */

function WorkerBadge({ status }: { status: string }) {
  const tone =
    status === "healthy"
      ? "text-success border-success"
      : status === "busy"
        ? "text-metal-muted border-[hsl(210,15%,78%/0.18)]"
        : "text-danger border-danger";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>
      <Activity className="h-3 w-3" aria-hidden />
      Workers: {status}
    </span>
  );
}

export function BusinessSignals() {
  const { data, isLoading } = useQuery<ControlCentreSnapshot>({
    queryKey: CONTROL_CENTRE_QUERY_KEY,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <Skeleton className="h-full min-h-[220px] rounded-xl" />;
  }
  if (!data) return null;

  const revenue7d = data.revenueTrend.reduce((sum, d) => sum + d.revenue, 0);

  return (
    <section className="lm-card rounded-xl p-5 sm:p-6 flex flex-col gap-4" data-testid="business-signals">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-metal-warm-white">The last 7 trading days</h2>
        <WorkerBadge status={data.workerHealth.status} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-metal-muted flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> Revenue
          </p>
          <p className="text-xl font-bold text-metal-warm-white">{money(revenue7d)}</p>
        </div>
        <div>
          <p className="text-xs text-metal-muted flex items-center gap-1">
            <Users className="h-3 w-3" /> New customers
          </p>
          <p className="text-xl font-bold text-metal-warm-white">{data.newCustomers7d}</p>
        </div>
      </div>

      {data.topProduct && (
        <p className="flex items-center gap-1.5 text-sm text-metal-muted">
          <Package className="h-4 w-4 shrink-0" aria-hidden />
          Top product (30d): <strong className="text-metal-warm-white">{data.topProduct.name}</strong> (
          {data.topProduct.unitsSold} units)
        </p>
      )}
    </section>
  );
}
