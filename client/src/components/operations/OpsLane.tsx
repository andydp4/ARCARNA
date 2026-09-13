import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CardState, DerivedCardState } from "@shared/orders/opsState";
import type { BoardLane, BoardOrder } from "@/lib/orderTypes";
import { laneLabel } from "@/lib/orderTypes";
import { OpsCard, type OpsCardProps } from "./OpsCard";
import { OpsYesterdayStrip } from "./OpsYesterdayStrip";
import { OpsScheduledStrip } from "./OpsScheduledStrip";
import { OpsDoneTray } from "./OpsDoneTray";

/**
 * One area of the shop: everything to be collected, or everything to go out.
 *
 * The lane owns ORDER, which is most of what makes a board a board rather than
 * a list. The sequence is the brief's, and each step of it is an operational
 * decision, not a preference:
 *
 *   customer waiting → late → due soon → delayed → on time → ready → held
 *
 * A person standing at the counter outranks a clock; something already late
 * outranks something about to be; anything ready is waiting on the customer,
 * not on us, so it sinks below the work still to do; held is parked. Urgent
 * pins to the top of its own state rather than jumping the queue outright —
 * an urgent order that is not late still does not outrank a customer who is
 * standing there.
 *
 * Cards that are not about right now — yesterday's, tomorrow's, and the ones
 * already handed over — go into collapsed strips beneath, where they are
 * reachable but never in the way (brief, "Lanes & filters"). N4a extracts
 * those strips into their own components (`OpsYesterdayStrip`,
 * `OpsScheduledStrip`, `OpsDoneTray`) — the stage actions themselves live on
 * `OpsCard`/`OpsCardActions` regardless of which list renders one, so the
 * three strips are thin. This lane imports all three of them to render them,
 * so `CollapsibleStrip` below stays private to this file rather than being
 * exported for them to share — a value-level import back into this module
 * would make the four files a genuine ES module cycle. Each of the three
 * carries its own small copy of the same chrome instead; see
 * `OpsYesterdayStrip.tsx`'s doc comment.
 */

export interface LaneCard {
  order: BoardOrder;
  derived: DerivedCardState;
}

/** Working order for the live part of a lane. Lower sorts first. */
const STATE_RANK: Record<CardState, number> = {
  "customer-waiting": 0,
  late: 1,
  "due-soon": 2,
  delayed: 3,
  "on-time": 4,
  ready: 5,
  held: 6,
  // Never sorted among the live cards — these live in their own strips.
  completed: 7,
  "carried-over": 8,
  scheduled: 9,
};

export function sortLaneCards(cards: LaneCard[]): LaneCard[] {
  return [...cards].sort((a, b) => {
    const byState = STATE_RANK[a.derived.state] - STATE_RANK[b.derived.state];
    if (byState !== 0) return byState;
    // Urgent pins to the top of its own state.
    if (a.derived.urgent !== b.derived.urgent) return a.derived.urgent ? -1 : 1;
    if (a.derived.state === "ready") {
      const aReady = a.order.readyAt ? new Date(a.order.readyAt).getTime() : 0;
      const bReady = b.order.readyAt ? new Date(b.order.readyAt).getTime() : 0;
      if (aReady !== bReady) return aReady - bReady;
    }
    const byDue = a.derived.dueEffective.getTime() - b.derived.dueEffective.getTime();
    if (byDue !== 0) return byDue;
    // Last resort: the order it came in. Stable, and never re-sorts under a
    // finger that is on its way to a button.
    return a.derived.receivedAt.getTime() - b.derived.receivedAt.getTime();
  });
}

/** Every prop an `OpsCard` needs except the three that vary per card. Shared by the lane's own live list and by the three strip components (N4a). */
export type StripCardHandlers = Omit<OpsCardProps, "order" | "derived" | "busy" | "alertActive">;

export interface OpsLaneProps extends StripCardHandlers {
  lane: BoardLane;
  cards: LaneCard[];
  /** True while a search or filter is narrowing the board — changes the empty copy. */
  filtered: boolean;
  /**
   * True while the operator has typed something. Searching means looking for
   * one particular order, and that order is as likely to be in the Done tray
   * or in yesterday's strip as in the live lane — so a search opens them.
   */
  searchActive: boolean;
  /** Ids whose own write is in flight. */
  pendingIds: Set<string>;
  /** N4a's alert stub always answers false; N5b makes it real (see `useOpsAlerts.ts`). */
  isAlertForOrder?: (orderId: string) => boolean;
}

/**
 * The collapsed-strip chrome — a header button with a count and a chevron,
 * closed by default, forced open while a search is active. Exported so
 * `OpsYesterdayStrip`, `OpsScheduledStrip` and `OpsDoneTray` (N4a) each render
 * their own copy of this shape rather than importing it from here — this
 * lane already imports all three of them, and a value-level import back into
 * this module would make the four files a genuine ES module cycle. `LaneCard`
 * and `StripCardHandlers` are types, erased at compile time, so importing
 * THOSE back into the three strips carries none of that risk.
 */
function CollapsibleStrip({
  testId,
  title,
  count,
  forceOpen,
  children,
}: {
  testId: string;
  title: string;
  count: number;
  forceOpen: boolean;
  children: ReactNode;
}) {
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

export function OpsLane({
  lane,
  cards,
  filtered,
  searchActive,
  pendingIds,
  isAlertForOrder,
  ...cardHandlers
}: OpsLaneProps) {
  const live = sortLaneCards(
    cards.filter(
      (card) =>
        card.derived.state !== "completed" &&
        card.derived.state !== "carried-over" &&
        card.derived.state !== "scheduled",
    ),
  );
  const carriedOver = cards.filter((card) => card.derived.state === "carried-over");
  const scheduled = cards.filter((card) => card.derived.state === "scheduled");
  const done = cards.filter((card) => card.derived.state === "completed");

  const headingId = `ops-lane-heading-${lane}`;
  const label = laneLabel(lane);

  return (
    <section
      aria-labelledby={headingId}
      data-testid={`ops-lane-${lane}`}
      data-lane={lane}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-background p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id={headingId}
          // Focusable programmatically (never in the tab order): after a card
          // is completed and leaves the lane, focus lands here rather than on
          // the document body (brief, "Keyboard & focus").
          tabIndex={-1}
          className="text-base font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-truth-bright"
        >
          {label}
        </h2>
        <span
          className="text-sm font-medium tabular-nums text-muted-foreground"
          data-testid={`ops-lane-count-${lane}`}
        >
          {live.length}
        </span>
      </div>

      {live.length === 0 ? (
        /* Deliberately not the shared <EmptyState>: it paints itself with
           `lm-card-muted`, a gradient, and axe cannot measure text contrast
           over a gradient — it reports `color-contrast` as *incomplete*, which
           this package's a11y spec treats as a failure (finding G13). A solid
           surface says the same thing and stays measurable. */
        <div
          className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center"
          data-testid={`ops-lane-empty-${lane}`}
        >
          <PackageCheck className="mx-auto mb-2 h-7 w-7 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">
            {filtered ? `Nothing matches in ${label.toLowerCase()}` : `Nothing waiting in ${label.toLowerCase()}`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered
              ? "Clear the search or choose All to see the rest of this lane."
              : "New orders for this area land here the moment they are keyed in."}
          </p>
        </div>
      ) : (
        <ul className={cn("space-y-3")} aria-label={`${label} orders`}>
          {live.map((card) => (
            <li key={card.order.id}>
              <OpsCard
                order={card.order}
                derived={card.derived}
                busy={pendingIds.has(card.order.id)}
                alertActive={isAlertForOrder?.(card.order.id) ?? false}
                {...cardHandlers}
              />
            </li>
          ))}
        </ul>
      )}

      <OpsYesterdayStrip
        lane={lane}
        cards={carriedOver}
        searchActive={searchActive}
        pendingIds={pendingIds}
        isAlertForOrder={isAlertForOrder}
        cardHandlers={cardHandlers}
      />

      <OpsScheduledStrip
        lane={lane}
        cards={scheduled}
        searchActive={searchActive}
        pendingIds={pendingIds}
        isAlertForOrder={isAlertForOrder}
        cardHandlers={cardHandlers}
      />

      <OpsDoneTray
        lane={lane}
        cards={done}
        searchActive={searchActive}
        pendingIds={pendingIds}
        isAlertForOrder={isAlertForOrder}
        cardHandlers={cardHandlers}
      />
    </section>
  );
}
