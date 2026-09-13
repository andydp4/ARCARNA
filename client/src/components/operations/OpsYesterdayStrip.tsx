import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BoardLane } from "@/lib/orderTypes";
import type { LaneCard, StripCardHandlers } from "./OpsLane";
import { OpsCard, type OpsCardProps } from "./OpsCard";

/**
 * Open orders whose own trading day already ended while they were still on
 * the board — "Yesterday (n)" (brief, "Carried-over").
 *
 * Promoted out of `OpsLane.tsx`'s inline strip (N1) into its own file per
 * this package's touch list. The cards inside behave exactly like any other
 * open card — claim, ready, hold, all of it — with one deliberate exception
 * `OpsCardActions.tsx` owns: completing one always asks for the actual
 * handover time first rather than stamping the tap as "now" (brief:
 * "an honest 'handed over yesterday?' on completion"), because a carried-over
 * order's tap is almost certainly not the moment it actually left the
 * counter.
 *
 * `LaneCard` and `StripCardHandlers` are TYPES imported from `OpsLane.tsx`
 * (erased at compile time); this file deliberately does not import any VALUE
 * from there, because `OpsLane.tsx` imports this component to render it — a
 * value-level import back would make the two files a real ES module cycle.
 * The small collapsed-strip header below is a second, intentional copy of
 * `OpsLane.tsx`'s own private `CollapsibleStrip` for exactly that reason; see
 * its doc comment.
 */
export interface OpsYesterdayStripProps {
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

export function OpsYesterdayStrip({ lane, cards, searchActive, pendingIds, isAlertForOrder, cardHandlers }: OpsYesterdayStripProps) {
  return (
    <Strip testId={`ops-yesterday-${lane}`} title="Yesterday" count={cards.length} forceOpen={searchActive}>
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
