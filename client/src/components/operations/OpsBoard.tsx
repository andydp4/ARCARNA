import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { deriveCardState, type OpsTimingSettings } from "@shared/orders/opsState";
import { formatOrderChannel } from "@shared/orders/channel";
import { isEditableTarget } from "@/hooks/useBarcodeScanner";
import { createScannerBurstGuard } from "@/lib/opsKeys";
import { formatPaymentLabel } from "@/lib/paymentLabel";
import { BOARD_LANES, type BoardLane, type BoardOrder } from "@/lib/orderTypes";
import type { OpsStaleness } from "@/hooks/useOpsBoard";
import { OpsBoardSkeleton } from "./OpsBoardSkeleton";
import { OpsHeader, type OpsFilter } from "./OpsHeader";
import { OpsLane, type LaneCard, type StripCardHandlers } from "./OpsLane";
import { OpsStaleBanner } from "./OpsStaleBanner";

/**
 * Collection and Delivery, side by side, over one read of the orders.
 *
 * The board owns three things a card cannot own for itself: which cards are on
 * screen (search and filter), what order they are in (the lane), and the
 * keyboard. The keyboard rules are the brief's, and the reason for each is the
 * counter the board lives on:
 *
 *   - Arrows move between cards in a lane and Enter activates the focused one.
 *     Nothing is bound to a bare letter, because the barcode scanner types
 *     letters (finding G15) and a scan must never complete an order.
 *   - `/` jumps to the search box, but only while a card or a lane heading has
 *     focus — a shortcut that steals focus from a text field would break WCAG
 *     2.1.4 and, more to the point, eat somebody's typing.
 *   - When the card you were on is completed and leaves the lane, focus moves
 *     to whatever is now in its place, or to the lane heading. Losing focus to
 *     the document body mid-task is how a keyboard user loses their place on a
 *     board that re-sorts itself every few seconds.
 */

export interface OpsBoardProps {
  orders: BoardOrder[];
  now: Date;
  settings: OpsTimingSettings;
  filter: OpsFilter;
  onFilterChange: (filter: OpsFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  /** The signed-in user, for the "Mine" filter. */
  currentUserId?: string;
  isInitialLoading: boolean;
  isFetching: boolean;
  staleness: OpsStaleness;
  onRefresh: () => void;
  headerExtras?: ReactNode;
  /** N4a: the staff strip and station picker row, passed through to `OpsHeader`. */
  headerStationRow?: ReactNode;
  /** Ids whose own write is in flight, so only those cards show as busy. */
  pendingIds: Set<string>;
  /** N4a's alert stub always answers false; N5b makes it real. */
  isAlertForOrder?: (orderId: string) => boolean;
  cardHandlers: Omit<StripCardHandlers, "shouldIgnoreEnter">;
}

/** Does this card match what was typed: id, customer, payment or channel. */
function matchesSearch(order: BoardOrder, query: string): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    order.id.toLowerCase().includes(needle) ||
    order.shortCode.toLowerCase().includes(needle) ||
    (order.customerName ?? "").toLowerCase().includes(needle) ||
    (order.customerPhone ?? "").toLowerCase().includes(needle) ||
    formatPaymentLabel(order.paymentMethod).toLowerCase().includes(needle) ||
    formatOrderChannel(order.channel).toLowerCase().includes(needle)
  );
}

/**
 * "Mine" before assignment exists.
 *
 * `assigned_user_id` arrives with migration 065 (N2) and is written from N3b.
 * Until then every order is unassigned, so a literal reading of the filter
 * would make "Mine" permanently empty — a control that always shows nothing is
 * worse than no control. Until the column exists, an order counts as yours if
 * you keyed it in and nobody else has taken it, which is exactly what the
 * default-owner rule will make true server-side in N3b.
 */
function isMine(order: BoardOrder, userId?: string): boolean {
  if (!userId) return false;
  if (order.assignedUserId) return order.assignedUserId === userId;
  return order.inputUserId === userId;
}

export function OpsBoard({
  orders,
  now,
  settings,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  currentUserId,
  isInitialLoading,
  isFetching,
  staleness,
  onRefresh,
  headerExtras,
  headerStationRow,
  pendingIds,
  isAlertForOrder,
  cardHandlers,
}: OpsBoardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // One buffer for the whole board: a scanner burst is a property of the
  // keyboard, not of whichever card happens to be focused.
  const scannerGuard = useRef(createScannerBurstGuard()).current;
  const lastFocused = useRef<{ lane: BoardLane; index: number } | null>(null);

  const cards = useMemo<LaneCard[]>(
    () => orders.map((order) => ({ order, derived: deriveCardState(order, now, settings) })),
    [orders, now, settings],
  );

  const visible = useMemo(
    () =>
      cards.filter(({ order }) => {
        if (!matchesSearch(order, search)) return false;
        if (filter === "all") return true;
        if (filter === "mine") return isMine(order, currentUserId);
        return !order.assignedUserId;
      }),
    [cards, search, filter, currentUserId],
  );

  const summary = useMemo(() => {
    const open = cards.filter(({ order }) => order.status !== "completed");
    return {
      open: open.length,
      lateNow: open.filter(({ derived }) => derived.state === "late" || derived.state === "customer-waiting")
        .length,
      dueSoonNow: open.filter(({ derived }) => derived.state === "due-soon").length,
      completedToday: cards.filter(({ derived }) => derived.state === "completed").length,
    };
  }, [cards]);

  const cardsInLane = useCallback(
    (lane: BoardLane): HTMLElement[] =>
      Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>(
          `[data-lane="${lane}"][data-testid^="ops-card-"]`,
        ) ?? [],
      ),
    [],
  );

  /** Remembers where the keyboard was, so a re-sort or a completion can restore it. */
  const onFocusCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>('[data-testid^="ops-card-"]');
      if (!card) return;
      const lane = (card.dataset.lane as BoardLane | undefined) ?? "collection";
      lastFocused.current = { lane, index: cardsInLane(lane).indexOf(card) };
    },
    [cardsInLane],
  );

  // When the card you were working on is completed it leaves the lane, taking
  // the focus with it — and focus on <body> means a keyboard user has to tab
  // in from the top of the page again.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const last = lastFocused.current;
    if (!last) return;
    const remaining = cardsInLane(last.lane);
    const next = remaining[Math.min(last.index, remaining.length - 1)];
    if (next) {
      next.focus();
      return;
    }
    rootRef.current
      ?.querySelector<HTMLElement>(`#ops-lane-heading-${last.lane}`)
      ?.focus();
  }, [visible, cardsInLane]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key.length === 1) scannerGuard.note(event.key, event.timeStamp);

    const active = document.activeElement as HTMLElement | null;
    const focusedCard = active?.closest?.<HTMLElement>('[data-testid^="ops-card-"]') ?? null;
    const onLaneHeading = active?.id?.startsWith("ops-lane-heading-") ?? false;

    if (event.key === "/" && !isEditableTarget(event.target)) {
      // Only from a card or a lane heading: see the module comment (WCAG 2.1.4).
      if (focusedCard || onLaneHeading) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      return;
    }

    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && focusedCard) {
      const lane = (focusedCard.dataset.lane as BoardLane | undefined) ?? "collection";
      const laneCards = cardsInLane(lane);
      const index = laneCards.indexOf(focusedCard);
      const next = laneCards[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }
  };

  if (isInitialLoading) return <OpsBoardSkeleton />;

  const filtered = search.trim().length > 0 || filter !== "all";

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scannerGuard.reset();
      }}
      className="flex flex-col gap-4"
    >
      <OpsHeader
        ref={searchRef}
        filter={filter}
        onFilterChange={onFilterChange}
        search={search}
        onSearchChange={onSearchChange}
        summary={summary}
        isFetching={isFetching}
        onRefresh={onRefresh}
        extras={headerExtras}
        stationRow={headerStationRow}
      />

      <OpsStaleBanner staleness={staleness} />

      {/* Container query, not a viewport one: the lanes sit side by side when
          the BOARD is wide enough, which on the tablet this is designed for
          depends on the sidebar rail and the form pane, not on the device
          (finding G17). Below 36rem of board they stack rather than squeeze. */}
      <div className="grid min-w-0 gap-4 @xl:grid-cols-2">
        {BOARD_LANES.map((lane) => (
          <OpsLane
            key={lane}
            lane={lane}
            cards={visible.filter((card) => card.order.fulfilmentMethod === lane)}
            filtered={filtered}
            searchActive={search.trim().length > 0}
            pendingIds={pendingIds}
            isAlertForOrder={isAlertForOrder}
            shouldIgnoreEnter={scannerGuard.shouldIgnoreEnter}
            {...cardHandlers}
          />
        ))}
      </div>
    </div>
  );
}
