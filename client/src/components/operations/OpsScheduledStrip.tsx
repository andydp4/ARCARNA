import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BoardLane } from "@/lib/orderTypes";
import type { LaneCard, StripCardHandlers } from "./OpsLane";
import { OpsCard, type OpsCardProps } from "./OpsCard";

/**
 * Pre-orders whose trading day has not started — "Scheduled (n)" (brief,
 * "Pre-orders"): no clocks, no alerts, on-time until their own promise on the
 * day itself.
 *
 * Promoted out of `OpsLane.tsx`'s inline strip (N1) into its own file per
 * this package's touch list. `OpsCardActions.tsx` already withholds every
 * stage action from a `scheduled` card (no primary button, no overflow stage
 * items) — acting on an order nobody is meant to be working yet would be a
 * false claim of progress on a sale that has not started, so this strip is,
 * deliberately, the one place on the board where View and the manager-only
 * Edit/Delete are the whole story.
 *
 * See `OpsYesterdayStrip.tsx`'s doc comment for why this file defines its own
 * small collapsed-strip header rather than importing `OpsLane.tsx`'s.
 */
export interface OpsScheduledStripProps {
  lane: BoardLane;
  cards: LaneCard[];
  searchActive: boolean;
  pendingIds: Set<string>;
  isAlertForOrder?: (orderId: string) => boolean;
  cardHandlers: StripCardHandlers;
}

function Strip({ testId, title, count, forceOpen, children }: { testId: string; title: string; count: number; forceOpen: boolean; children: ReactNode }) {
  const [openedByHand, setOpenedByHand] = useState(false);
  const open = forceOpen || openedByHand;
  if (count === 0) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="rounded-lg border border-border bg-background" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpenedByHand((current) => !current)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground"
      >
        <Chevron className="h-4 w-4 shrink-0" aria-hidden />
        {title} ({count})
      </button>
      {open && <div className="space-y-3 px-3 pb-3">{children}</div>}
    </section>
  );
}

export function OpsScheduledStrip({ lane, cards, searchActive, pendingIds, isAlertForOrder, cardHandlers }: OpsScheduledStripProps) {
  return (
    <Strip testId={`ops-scheduled-${lane}`} title="Scheduled" count={cards.length} forceOpen={searchActive}>
      {cards.map((card) => (
        <OpsCard
          key={card.order.id}
          order={card.order}
          derived={card.derived}
          busy={pendingIds.has(card.order.id)}
          alertActive={isAlertForOrder?.(card.order.id) ?? false}
          {...(cardHandlers as Omit<OpsCardProps, "order" | "derived" | "busy" | "alertActive">)}
        />
      ))}
    </Strip>
  );
}
