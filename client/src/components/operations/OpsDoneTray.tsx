import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BoardLane } from "@/lib/orderTypes";
import type { LaneCard, StripCardHandlers } from "./OpsLane";
import { OpsCard, type OpsCardProps } from "./OpsCard";

/**
 * Completed orders — "Done (n)" (brief: the last 120 minutes, `ops-done-tray-<lane>`).
 *
 * Promoted out of `OpsLane.tsx`'s inline strip (N1) into its own file per this
 * package's touch list. The 120-minute window itself is enforced upstream —
 * `GET /api/orders/board`'s own predicate is `status <> 'completed' OR
 * settled_at >= now() − 120 min` (`server/services/opsBoard.ts`, N3a) — so
 * every completed card this tray is ever handed is already inside that
 * window; there is nothing left for the client to filter a second time.
 *
 * Undo lives on the card itself: `OpsCardActions.tsx` renders it as the
 * completed-card primary button (`ops-undo-<id>`) and shows it only to the
 * completer or MANAGER+ — the same rule `assertTransitionRoleAllowed`'s
 * `reopen` case enforces server-side (`server/services/orderTransitions.ts`),
 * so the button a cashier cannot legally use never appears for them to try.
 *
 * See `OpsYesterdayStrip.tsx`'s doc comment for why this file defines its own
 * small collapsed-strip header rather than importing `OpsLane.tsx`'s.
 */
export interface OpsDoneTrayProps {
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

export function OpsDoneTray({ lane, cards, searchActive, pendingIds, isAlertForOrder, cardHandlers }: OpsDoneTrayProps) {
  const sorted = [...cards].sort((a, b) => b.derived.receivedAt.getTime() - a.derived.receivedAt.getTime());
  return (
    <Strip testId={`ops-done-tray-${lane}`} title="Done" count={sorted.length} forceOpen={searchActive}>
      {sorted.map((card) => (
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
