import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Info, TriangleAlert } from "lucide-react";
import { CONTROL_CENTRE_QUERY_KEY, type ControlCentreSnapshot } from "@/lib/controlCentre";

/**
 * The line that sits over the sphere.
 *
 * Deliberately no card, no background — ControlCentreBackdrop is a decorative
 * brand piece behind the whole hero band, and an opaque box here is exactly
 * what used to hide it. Text reads fine directly over it; that is how the
 * backdrop was designed to be used (see its own doc comment on sitting behind
 * "live figures someone is trying to read").
 */

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatTradingDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

const SEVERITY_ICON = { error: TriangleAlert, warning: AlertTriangle, info: Info } as const;
const SEVERITY_CLASS = {
  error: "text-danger",
  warning: "text-warning",
  info: "text-metal-muted",
} as const;

export function ControlCentreGreeting() {
  const { data } = useQuery<ControlCentreSnapshot>({
    queryKey: CONTROL_CENTRE_QUERY_KEY,
    refetchInterval: 60_000,
  });

  const topMove = data?.nextMoves[0];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-metal-stainless">
          {timeGreeting()}
          {data ? ` · ${formatTradingDay(data.tradingDay)}'s trading day` : ""}
        </p>
      </div>

      {topMove && (
        <Link
          href={topMove.href}
          className="group inline-flex w-fit items-center gap-2 text-sm font-medium text-metal-warm-white transition-colors hover:text-truth-bright"
          data-testid="greeting-top-next-move"
        >
          {(() => {
            const Icon = SEVERITY_ICON[topMove.severity];
            return <Icon className={`h-4 w-4 shrink-0 ${SEVERITY_CLASS[topMove.severity]}`} aria-hidden />;
          })()}
          <span>{topMove.message}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        </Link>
      )}
    </div>
  );
}
