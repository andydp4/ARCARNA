import { useState, type ReactNode } from "react";
import { settledBeforeToday } from "@shared/orders/opsState";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BoardLane } from "@/lib/orderTypes";
import type { LaneCard, StripCardHandlers } from "./OpsLane";
import { OpsCard, type OpsCardProps } from "./OpsCard";

/**
 * Completed orders — "Done (n)": today's trading day and yesterday's
 * (`ops-done-tray-<lane>`), so yesterday's work is still there to check back on.
 *
 * The window is enforced upstream — `GET /api/orders/board` returns completed
 * orders settled since the start of yesterday's trading day
 * (`boardCompletedCutoff`, `server/services/opsBoard.ts`), and below manager
 * only your own from yesterday (Q10a, `boardPayloadForViewer`).
 *
 * Yesterday's cards are split out under their own heading and are read-only
 * on the board (no Undo, Edit or Delete — `OpsCardActions.tsx`). Undo on
 * today's cards stays the completer within 10 minutes, or MANAGER+, the same
 * rule `assertTransitionRoleAllowed`'s `reopen` case enforces server-side.
 *
 * At most `RENDER_STEP` cards are drawn at a time (a busy Friday is a few
 * hundred completions); "Show more" draws the next batch.
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

const RENDER_STEP = 50;

export function OpsDoneTray({ lane, cards, searchActive, pendingIds, isAlertForOrder, cardHandlers }: OpsDoneTrayProps) {
  const [shown, setShown] = useState(RENDER_STEP);
  const { now } = cardHandlers;
  const timezone = cardHandlers.settings.timezone;
  const settledMs = (card: LaneCard) => (card.order.settledAt ? new Date(card.order.settledAt).getTime() : card.derived.receivedAt.getTime());
  const sorted = [...cards].sort((a, b) => settledMs(b) - settledMs(a));
  const today = sorted.filter((card) => !settledBeforeToday(card.order.settledAt, timezone, now));
  const earlier = sorted.filter((card) => settledBeforeToday(card.order.settledAt, timezone, now));
  const renderCard = (card: LaneCard) => (
    <OpsCard
      key={card.order.id}
      order={card.order}
      derived={card.derived}
      busy={pendingIds.has(card.order.id)}
      alertActive={isAlertForOrder?.(card.order.id) ?? false}
      {...(cardHandlers as Omit<OpsCardProps, "order" | "derived" | "busy" | "alertActive">)}
    />
  );
  const todayShown = today.slice(0, shown);
  const earlierShown = earlier.slice(0, Math.max(0, shown - today.length));
  const hidden = sorted.length - todayShown.length - earlierShown.length;
  return (
    <Strip testId={`ops-done-tray-${lane}`} title="Done" count={sorted.length} forceOpen={searchActive}>
      {todayShown.map(renderCard)}
      {earlierShown.length > 0 && (
        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground" data-testid={`ops-done-yesterday-${lane}`}>
          Yesterday ({earlier.length}) · to look back at
        </p>
      )}
      {earlierShown.map(renderCard)}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShown((n) => n + RENDER_STEP)}
          className="min-h-11 w-full rounded-md border border-border text-sm text-muted-foreground hover:text-foreground"
          data-testid={`ops-done-more-${lane}`}
        >
          Show {Math.min(hidden, RENDER_STEP)} more ({hidden} not shown)
        </button>
      )}
    </Strip>
  );
}
