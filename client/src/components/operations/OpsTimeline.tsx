import { CheckCircle2, Circle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpsTimingSettings } from "@shared/orders/opsState";
import type { BoardOrder } from "@/lib/orderTypes";
import { formatClockSpan, formatTimeOfDay } from "@/lib/opsClock";

/**
 * This order's stages, in the order they happened, with the clock between
 * each one.
 *
 * The brief's Details sheet calls for "`order_events` timeline with clocks
 * between stamps" — but nothing exposes `order_events` to the client today.
 * `GET /api/orders/:id` (kept, unmodified by this package) has never
 * projected it, and adding a route that does is `server/**` work this
 * package's touch list explicitly rules out ("Out of scope: … `server/**`").
 * Building that endpoint is exactly the kind of change the standing rule asks
 * to flag rather than smuggle in.
 *
 * What this reads instead is the one thing already on every `BoardOrder`
 * (`GET /api/orders/board`, N3a): the stage TIMESTAMPS migration 065's own
 * header calls "the architectural principle" — "stages are timestamps, not
 * statuses" — and each one is written in the same transaction as, and mirrors
 * exactly, one `order_events` row of the matching `kind` (received / assigned
 * / held / ready / arrived / out_for_delivery / completed; see the brief's
 * "Milestone → Column → Written by" table). A sequence built from those
 * columns is not an approximation of the event log for the stages it covers —
 * it is the same eight milestones in the same order with the same instants.
 * What it cannot show is per-event free text that has no column of its own
 * (a hold's reason, an old due time an `assigned {from,to,by}` once held) —
 * that is exactly the detail a future package can add once something
 * projects `order_events` itself to the client.
 */
export interface OpsTimelineProps {
  order: BoardOrder;
  settings: OpsTimingSettings;
}

interface Milestone {
  key: string;
  label: string;
  at: string | null;
}

function milestonesFor(order: BoardOrder): Array<Milestone & { at: string }> {
  const list: Milestone[] = [
    { key: "received", label: "Received", at: order.enteredAt ?? order.createdAt },
  ];
  if (order.assignedAt) list.push({ key: "assigned", label: `Assigned${order.assignedUserName ? ` to ${order.assignedUserName}` : ""}`, at: order.assignedAt });
  if (order.heldAt) list.push({ key: "held", label: "Put on hold", at: order.heldAt });
  if (order.readyAt) list.push({ key: "ready", label: "Ready", at: order.readyAt });
  if (order.customerArrivedAt) list.push({ key: "arrived", label: "Customer arrived", at: order.customerArrivedAt });
  if (order.outForDeliveryAt) list.push({ key: "out_for_delivery", label: "Out for delivery", at: order.outForDeliveryAt });
  if (order.status === "completed" && (order.handoverAt ?? order.settledAt)) {
    list.push({
      key: "completed",
      label: order.fulfilmentMethod === "delivery" ? "Delivered" : "Handed over",
      at: order.handoverAt ?? order.settledAt,
    });
  }
  return list
    .filter((m): m is Milestone & { at: string } => Boolean(m.at))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function OpsTimeline({ order, settings }: OpsTimelineProps) {
  const milestones = milestonesFor(order);
  if (milestones.length === 0) return null;

  return (
    <div data-testid={`ops-timeline-${order.id}`}>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">Timeline</h3>
      <ol className="space-y-0">
        {milestones.map((milestone, index) => {
          const previous = milestones[index - 1];
          const gapMs = previous ? new Date(milestone.at).getTime() - new Date(previous.at).getTime() : null;
          const isLast = index === milestones.length - 1;
          const Icon: LucideIcon = isLast && order.status === "completed" ? CheckCircle2 : Circle;
          return (
            <li key={milestone.key} className="relative flex gap-3 pb-4 last:pb-0">
              {!isLast && (
                <span className="absolute left-[9px] top-5 h-full w-px bg-border" aria-hidden />
              )}
              <Icon
                className={cn(
                  "mt-0.5 h-[18px] w-[18px] shrink-0",
                  isLast && order.status === "completed" ? "text-ops-completed" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {milestone.label}{" "}
                  <span className="font-normal text-muted-foreground">
                    at {formatTimeOfDay(milestone.at, settings.timezone)}
                  </span>
                </p>
                {gapMs != null && (
                  <p className="text-xs text-muted-foreground">{formatClockSpan(gapMs)} after the step before</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
