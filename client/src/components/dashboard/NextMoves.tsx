import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, Info, TriangleAlert, AlertTriangle } from "lucide-react";
import { CONTROL_CENTRE_QUERY_KEY, type ControlCentreSnapshot, type NextMoveSeverity } from "@/lib/controlCentre";

/**
 * What actually needs a person today — ranked, not just listed.
 *
 * Everything here already exists as a real count somewhere in the system
 * (stock risk, outstanding credit, a missed close, a failed background job, a
 * pending approval); this is the one place they are gathered, ranked by how
 * much they matter, and given a destination. Empty is a real, good state —
 * shown as such rather than hidden, since "nothing needs you right now" is
 * itself useful to know at a glance.
 */

const SEVERITY_ICON: Record<NextMoveSeverity, typeof TriangleAlert> = {
  error: TriangleAlert,
  warning: AlertTriangle,
  info: Info,
};
const SEVERITY_CLASS: Record<NextMoveSeverity, string> = {
  error: "text-danger",
  warning: "text-warning",
  info: "text-metal-muted",
};

export function NextMoves() {
  const { data } = useQuery<ControlCentreSnapshot>({
    queryKey: CONTROL_CENTRE_QUERY_KEY,
    refetchInterval: 60_000,
  });

  const moves = data?.nextMoves ?? [];

  return (
    <section className="lm-card rounded-xl p-5 sm:p-6" data-testid="control-centre-next-moves">
      <h2 className="text-sm font-semibold text-metal-warm-white mb-3">Next moves</h2>
      {moves.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-metal-muted">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
          Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {moves.map((move) => {
            const Icon = SEVERITY_ICON[move.severity];
            return (
              <li key={move.id}>
                <Link
                  href={move.href}
                  className="group flex items-start gap-2 text-sm text-metal-warm-white transition-colors hover:text-truth-bright"
                  data-testid={`next-move-${move.id}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${SEVERITY_CLASS[move.severity]}`} aria-hidden />
                  <span className="underline-offset-4 group-hover:underline">{move.message}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
