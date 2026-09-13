import { useCallback } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { OpsBoardAlert } from "@/hooks/useOpsBoard";
import type { OpsAlertKind } from "@shared/orders/opsAlerts";
import type { BoardOrder } from "@/lib/orderTypes";

/**
 * The alert rail (Phase N, N5b; brief, "Alerts & notifications" → "Surface").
 *
 * Verbatim from the brief: "`OpsAlertTray` (`ops-alerts`) is a plain
 * `<section aria-label="Alerts">` of buttons (`ops-alert-<id>`, Ack
 * `ops-alert-ack-<id>`; tapping a row scrolls to and focuses the card)."
 * That is the whole surface — no dialog, no toast, nothing here reads or
 * writes anything beyond the two things a person can do with an alert: go
 * look at the order, or say they have seen it.
 *
 * Renders nothing when there is nothing open, the same way `OpsAnnouncer`'s
 * own region says nothing until there is something worth a sentence — an
 * always-present empty landmark would just be board furniture.
 *
 * Each row also carries a small pulsing indicator, `[data-alert="true"]`'s
 * own visual language extended down to the rail so an eye already scanning
 * for the truth-blue pulse finds it here too. `OpsCard.tsx`'s own pulse is
 * out of this package's touch list (N4a already wired `data-alert` and
 * `animate-ops-pulse` there) — this dot is this component's own, and gets
 * `usePrefersReducedMotion()`'s `data-static` fallback (a static bell, no
 * animation) the same way the brief's "Pulse" section describes for the
 * card, since a row that only differs by a suppressed CSS animation would
 * leave a reduced-motion viewer with no visual sign an alert exists at all.
 */

const KIND_LABEL: Record<OpsAlertKind, string> = {
  assigned: "Assigned to you",
  new_unassigned: "Unclaimed",
  customer_waiting: "Customer waiting",
  due_soon: "Due soon",
  late: "Running late",
  delayed: "Delayed",
};

export interface OpsAlertTrayProps {
  alerts: OpsBoardAlert[];
  orders: BoardOrder[];
  ackingIds: Set<string>;
  onAck: (id: string) => void;
  /** The board's one `role="status"` announcer (`OpsAnnouncer`) — a sentence per focused-card state change. */
  onAnnounce?: (message: string) => void;
}

export function OpsAlertTray({ alerts, orders, ackingIds, onAck, onAnnounce }: OpsAlertTrayProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const focusCard = useCallback(
    (orderId: string, shortCode: string) => {
      const card = document.querySelector<HTMLElement>(`[data-testid="ops-card-${orderId}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
      card.focus();
      onAnnounce?.(`Order ${shortCode} in view`);
    },
    [prefersReducedMotion, onAnnounce],
  );

  if (alerts.length === 0) return null;

  return (
    <section aria-label="Alerts" data-testid="ops-alerts" className="flex flex-col gap-2">
      {alerts.map((alert) => {
        const order = orders.find((o) => o.id === alert.orderId);
        const shortCode = order?.shortCode ?? alert.orderId;
        const label = `${KIND_LABEL[alert.kind]} — Order ${shortCode}`;
        const acking = ackingIds.has(alert.id);
        return (
          <div
            key={alert.id}
            data-testid={`ops-alert-row-${alert.id}`}
            data-static={prefersReducedMotion ? "true" : undefined}
            className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
          >
            <span
              aria-hidden
              className={cn(
                "inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-ops-alert",
                !prefersReducedMotion && "animate-ops-pulse",
              )}
            />
            <button
              type="button"
              onClick={() => focusCard(alert.orderId, shortCode)}
              className="flex min-h-11 flex-1 items-center gap-2 rounded-md px-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-truth-bright"
              data-testid={`ops-alert-${alert.id}`}
            >
              <BellRing className="h-4 w-4 shrink-0 text-ops-alert" aria-hidden />
              <span>{label}</span>
            </button>
            <Button
              type="button"
              size="touch"
              variant="outline"
              disabled={acking}
              onClick={() => onAck(alert.id)}
              aria-label={`Acknowledge: ${label}`}
              data-testid={`ops-alert-ack-${alert.id}`}
            >
              Ack
            </Button>
          </div>
        );
      })}
    </section>
  );
}
