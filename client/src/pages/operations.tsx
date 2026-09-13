import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useNavigation } from "@/contexts/NavigationContext";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useOpsBoard, type OpsBoardResponse } from "@/hooks/useOpsBoard";
import { useOpsTicker } from "@/hooks/useOpsTicker";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useOpsAlerts } from "@/hooks/useOpsAlerts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/appPaths";
import { invalidateAfterOpsTransition, invalidateAfterOrderStatusChange } from "@/lib/query-invalidation";
import { STORAGE_OPS_FILTER, STORAGE_OPS_TAB } from "@shared/storageKeys";
import type { OrderStatus } from "@shared/schema";
import type { TransitionAction, TransitionOrderInput } from "@shared/orders/opsTransitions";
import type { BoardOrder } from "@/lib/orderTypes";
import { OpsBoard } from "@/components/operations/OpsBoard";
import { OpsAnnouncer } from "@/components/operations/OpsAnnouncer";
import { OpsDeleteDialog } from "@/components/operations/OpsDeleteDialog";
import { OpsDetailsSheet } from "@/components/operations/OpsDetailsSheet";
import { OpsEditDialog } from "@/components/operations/OpsEditDialog";
import { OpsStaffStrip } from "@/components/operations/OpsStaffStrip";
import { OpsStationPicker } from "@/components/operations/OpsStationPicker";
import { OpsShiftControls } from "@/components/operations/OpsShiftControls";
import type { OpsFilter } from "@/components/operations/OpsHeader";
import POS from "@/pages/pos";

/**
 * The Operations Centre.
 *
 * One screen that answers the question Open Orders could not: what needs doing
 * now, who is it for, and is it late — see docs/briefs/PHASE_N_OPERATIONS_CENTRE.md.
 * N1 (v0) built the shell, the lanes, the cards and the clocks over the
 * columns `orders` already had, with one-tap Handed over / Delivered through
 * the pre-existing PATCH. This is N4a: every other card action — claim, pass,
 * ready, arrived, out for delivery, hold, undo, delay, set due, rate — now
 * calls the real `POST /api/orders/:id/transition` (N3b), plus stations,
 * presence, the break loop and the Done tray's Undo.
 *
 * Three structural decisions live here rather than in a component:
 *
 *  - The board takes the whole viewport below the app header and each pane
 *    scrolls itself. A counter screen that scrolls as one document puts the
 *    lane you are working in off the bottom whenever the other lane grows.
 *  - The sidebar collapses to its icon rail while this page is mounted and is
 *    restored on the way out. A 1194px tablet has 938px of main width with the
 *    sidebar open and 1130px with it closed (finding G17) — nearly 200px, which
 *    is the difference between two lanes beside the form and not.
 *  - The layout switches on the width of the MAIN AREA, not the viewport
 *    (`useMainWidth`). The viewport is the wrong measurement on the one device
 *    this is designed for: the same iPad is 938px or 1130px wide inside
 *    depending on a sidebar toggle the operator controls.
 */

/** Below this main-area width the form and the board become tabs rather than panes. */
const TWO_PANE_MIN_WIDTH = 900;

/** The order form's share of a two-pane layout, per the owner's mock. */
const FORM_PANE_PERCENT = 42;

type OpsTab = "board" | "order";

/** Reads a persisted per-device preference without ever throwing on a locked jar. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode, or storage disabled — the board works without it */
  }
}

/**
 * The width of the area the board actually has, observed rather than assumed.
 * Returns 0 until the first measurement, which callers read as "not yet known"
 * and treat as the wide case, so the tablet never flashes the phone layout.
 */
export function useMainWidth(): [(node: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, width];
}

/** Collapses the sidebar to its icon rail while the board is mounted. */
function useCollapsedSidebar(): void {
  const { sidebarOpen, setSidebarOpen } = useNavigation();
  const wasOpenOnEntry = useRef(sidebarOpen);

  useEffect(() => {
    const restore = wasOpenOnEntry.current;
    setSidebarOpen(false);
    return () => {
      if (restore) setSidebarOpen(true);
    };
    // Deliberately mount/unmount only, with the entry state read from a ref:
    // re-running this whenever `sidebarOpen` changed would fight an operator
    // who deliberately re-opened the sidebar while the board is up.
  }, [setSidebarOpen]);
}

export interface OpsShellProps {
  /** Measured width of the main area; 0 while unknown. */
  mainRef: (node: HTMLElement | null) => void;
  isTwoPane: boolean;
  tab: OpsTab;
  onTabChange: (tab: OpsTab) => void;
  board: ReactNode;
  /** The order form — the POS itself, embedded (N6). */
  formSlot: ReactNode;
  /** N5b hangs the alert rail here. */
  alertsSlot?: ReactNode;
  /**
   * Shift housekeeping (`OpsShiftControls`, N6) — a persistent strip above
   * both the two-pane layout and the phone's tabs, so it stays reachable
   * while the Order tab (which has no page header of its own once the form
   * is embedded) is the one in front.
   */
  headerExtras?: ReactNode;
  /**
   * How many orders have landed on the board since the phone's Order tab
   * was opened — shown on the Board tab so a cashier keying a second sale
   * knows something arrived without leaving the form to check (brief,
   * "Form embedding": "a badge counts arrivals while the Order tab is
   * active"). Meaningless (and not rendered) in the two-pane layout, where
   * the board is already on screen.
   */
  boardArrivalCount?: number;
}

/**
 * The two-pane / two-tab frame. Split out from the page so N6 can drop the
 * real order form into `formSlot` and N5b the alert rail into `alertsSlot`
 * without touching the board or the layout rules.
 */
export function OpsShell({
  mainRef,
  isTwoPane,
  tab,
  onTabChange,
  board,
  formSlot,
  alertsSlot,
  headerExtras,
  boardArrivalCount = 0,
}: OpsShellProps) {
  const [formCollapsed, setFormCollapsed] = useState(false);

  return (
    <div
      ref={mainRef}
      // The app header is 4rem; the board owns everything below it and each
      // pane scrolls on its own.
      className="flex h-[calc(100dvh-4rem)] min-w-0 flex-col overflow-hidden"
    >
      {headerExtras && (
        <div
          className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-border px-3 py-2"
          data-testid="ops-header-extras"
        >
          {headerExtras}
        </div>
      )}
      {isTwoPane ? (
        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto @container">
            {alertsSlot}
            {board}
          </div>
          <div
            className="flex shrink-0 flex-col gap-2 overflow-y-auto"
            style={formCollapsed ? { width: "3.5rem" } : { width: `${FORM_PANE_PERCENT}%`, minWidth: "400px" }}
            data-testid="ops-form-pane"
          >
            <Button
              size="touch"
              variant="outline"
              className="self-end"
              onClick={() => setFormCollapsed((current) => !current)}
              aria-expanded={!formCollapsed}
              aria-label={formCollapsed ? "Show the new order pane" : "Hide the new order pane"}
              data-testid="ops-form-collapse"
            >
              {formCollapsed ? (
                <ChevronLeft className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden />
              )}
            </Button>
            {!formCollapsed && <div className="min-h-0 flex-1">{formSlot}</div>}
          </div>
        </div>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as OpsTab)}
          className="flex min-h-0 flex-1 flex-col gap-3 p-3"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="board" className="min-h-11 gap-1.5" data-testid="ops-tab-board">
              Board
              {tab === "order" && boardArrivalCount > 0 && (
                <span
                  className="inline-flex min-w-5 items-center justify-center rounded-full bg-ops-alert px-1.5 text-xs font-semibold text-truth-foreground"
                  data-testid="ops-tab-board-badge"
                  aria-label={`${boardArrivalCount} new since you started this order`}
                >
                  {boardArrivalCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="order" className="min-h-11" data-testid="ops-tab-order">
              New order
            </TabsTrigger>
          </TabsList>
          {/* forceMount keeps the board mounted while the Order tab is in
              front, so its clocks keep ticking and its poll keeps running —
              a board that stops counting the moment somebody starts keying an
              order is a board nobody trusts. Radix hides the inactive panel
              with the `hidden` attribute rather than unmounting it. */}
          <TabsContent
            value="board"
            forceMount
            className="mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto @container data-[state=inactive]:hidden"
          >
            {alertsSlot}
            {board}
          </TabsContent>
          <TabsContent
            value="order"
            forceMount
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto data-[state=inactive]:hidden"
          >
            {formSlot}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/** The exact shape `runOrderTransition` returns (`server/services/orderTransitions.ts`). */
interface TransitionResult {
  order: BoardOrder;
  event: { id: string; kind: string; at: string } | null;
  changed: boolean;
}

interface TransitionClientError extends Error {
  status?: number;
  code?: string;
  assignedUserId?: string;
  assignedUserName?: string;
}

/**
 * Calls the real transition endpoint directly with `apiFetch` rather than
 * through `apiRequest` (`lib/queryClient.ts`): `apiRequest` throws away every
 * field of a JSON error body except `message`, and the claim-race 409's
 * `code: 'ORDER_ALREADY_ASSIGNED'` is exactly what tells this page to show a
 * distinct "someone got there first" toast instead of the generic failure
 * one. The server's `message` already names the winner
 * (`OrderAlreadyAssignedError`, N3b), so nothing here has to.
 */
async function postOrderTransition(orderId: string, input: TransitionOrderInput): Promise<TransitionResult> {
  const response = await apiFetch(`/api/orders/${orderId}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.message || `Request failed (${response.status})`) as TransitionClientError;
    error.status = response.status;
    error.code = body?.code;
    error.assignedUserId = body?.assignedUserId;
    error.assignedUserName = body?.assignedUserName;
    throw error;
  }
  return body as TransitionResult;
}

/** A human sentence for the announcer, one per action — the board's own `role="status"` region (`OpsAnnouncer`). */
function announceFor(order: BoardOrder, action: TransitionAction): string {
  const label = order.fulfilmentMethod === "delivery" ? "Delivered" : "Handed over";
  switch (action) {
    case "claim":
      return `You are now dealing with order ${order.shortCode}`;
    case "unclaim":
      return `Order ${order.shortCode} released`;
    case "assign":
      return `Order ${order.shortCode} passed on`;
    case "ready":
      return `Order ${order.shortCode} is ready`;
    case "unready":
      return `Order ${order.shortCode} is not ready`;
    case "arrived":
      return `Customer here for order ${order.shortCode}`;
    case "out_for_delivery":
      return `Order ${order.shortCode} is out for delivery`;
    case "complete":
      return `Order ${order.shortCode} ${label.toLowerCase()}`;
    case "reopen":
      return `Order ${order.shortCode} reopened`;
    case "hold":
      return `Order ${order.shortCode} on hold`;
    case "unhold":
      return `Order ${order.shortCode} resumed`;
    case "set_due":
      return `Order ${order.shortCode} now has a due time`;
    default:
      return `Order ${order.shortCode} updated`;
  }
}

export default function OperationsCentre() {
  const { toast } = useToast();
  const { user } = useAuth();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const prefersReducedMotion = usePrefersReducedMotion();

  useCollapsedSidebar();

  const [mainRef, mainWidth] = useMainWidth();
  // 0 means "not measured yet": assume the tablet, not the phone, so the board
  // never flashes the wrong layout on the device it is designed for.
  const isTwoPane = mainWidth === 0 || mainWidth >= TWO_PANE_MIN_WIDTH;

  const now = useOpsTicker();
  const board = useOpsBoard(now);
  const alerts = useOpsAlerts();
  useWakeLock(true);

  const [tab, setTab] = useState<OpsTab>(() =>
    params.get("pane") === "order" || readStored(STORAGE_OPS_TAB) === "order" ? "order" : "board",
  );
  const [filter, setFilter] = useState<OpsFilter>(() => {
    const stored = readStored(STORAGE_OPS_FILTER);
    return stored === "mine" || stored === "unassigned" || stored === "all" ? stored : "all";
  });
  const [searchText, setSearchText] = useState("");
  const [detailsOrderId, setDetailsOrderId] = useState<string | null>(null);
  const [editOrder, setEditOrder] = useState<BoardOrder | null>(null);
  const [deleteOrder, setDeleteOrder] = useState<BoardOrder | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [handOverPicking, setHandOverPicking] = useState(false);
  const [loopBusy, setLoopBusy] = useState(false);

  const setPending = useCallback((orderId: string, pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }, []);

  // Deep links: the command palette and the Control Centre tiles point at
  // /operations?order=<id> and ?lane=<lane> (brief, "Route & nav").
  const orderParam = params.get("order");
  const laneParam = params.get("lane");

  useEffect(() => {
    if (orderParam) setDetailsOrderId(orderParam);
  }, [orderParam]);

  useEffect(() => {
    if (!laneParam) return;
    const lane = document.querySelector<HTMLElement>(`[data-testid="ops-lane-${laneParam}"]`);
    lane?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    document.getElementById(`ops-lane-heading-${laneParam}`)?.focus();
  }, [laneParam, prefersReducedMotion, board.isInitialLoading]);

  const onTabChange = useCallback((next: OpsTab) => {
    setTab(next);
    writeStored(STORAGE_OPS_TAB, next);
  }, []);

  const onFilterChange = useCallback((next: OpsFilter) => {
    setFilter(next);
    writeStored(STORAGE_OPS_FILTER, next);
  }, []);

  // The Board tab's badge (brief, "Form embedding"): a snapshot of every
  // order id on the board is taken the moment the Order tab becomes active,
  // and the count is simply how many of the board's CURRENT orders are not
  // in that snapshot — orders that arrived (from anywhere: this till,
  // another one, the website, WhatsApp) while this cashier has been heads
  // down in the form. Leaving the Order tab clears it; only the two-pane
  // layout never needs it, since the board is already on screen there.
  //
  // Waits for the board's first real load (`!isInitialLoading`) before ever
  // taking that snapshot: `?pane=order` starts `tab` at "order" before the
  // board query has resolved, and a snapshot of the still-empty `[]` would
  // count the ENTIRE board as "new" the moment real data arrived a moment
  // later — a five-figure badge on a busy board, not the small number this
  // is meant to be.
  const orderTabBaselineRef = useRef<Set<string> | null>(null);
  const [boardArrivalCount, setBoardArrivalCount] = useState(0);
  useEffect(() => {
    if (tab !== "order") {
      orderTabBaselineRef.current = null;
      setBoardArrivalCount(0);
      return;
    }
    if (board.isInitialLoading) return;
    if (!orderTabBaselineRef.current) {
      orderTabBaselineRef.current = new Set(board.orders.map((order) => order.id));
    }
    const baseline = orderTabBaselineRef.current;
    setBoardArrivalCount(board.orders.filter((order) => !baseline.has(order.id)).length);
  }, [tab, board.orders, board.isInitialLoading]);

  /**
   * The embedded form's `onPlaced` (N6): find the just-created order's card
   * — the SSE stream or the form's own board-query invalidation usually beat
   * this here, but not always, hence the short poll — scroll it into view
   * and flash it (`data-new`, cleared after 4 s; styled in liquid-metal.css).
   * A plain DOM attribute rather than board/card state: `OpsCard.tsx` is out
   * of this package's scope, so nothing here can hand it a "just placed"
   * prop — this reaches the rendered card from the outside instead, the way
   * a highlight-and-fade toolkit would.
   */
  const handleOrderPlaced = useCallback(
    (orderId: string) => {
      const tryFlash = (attempt: number) => {
        const card = document.querySelector<HTMLElement>(`[data-testid="ops-card-${orderId}"]`);
        if (!card) {
          if (attempt < 10) setTimeout(() => tryFlash(attempt + 1), 300);
          return;
        }
        card.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
        card.setAttribute("data-new", "true");
        setTimeout(() => card.removeAttribute("data-new"), 4000);
      };
      tryFlash(0);
    },
    [prefersReducedMotion],
  );

  // Stable across the ticker's once-a-second re-render, so POS (which is not
  // memoized) never sees a "new" embedded prop object when nothing about it
  // actually changed.
  const embeddedPosProps = useMemo(() => ({ onPlaced: handleOrderPlaced }), [handleOrderPlaced]);

  const blockedReason = board.staleness.isStale ? board.staleness.reason : null;

  /**
   * The one write every stage action in this package makes: `claim`,
   * `unclaim`, `assign`, `ready`, `unready`, `arrived`, `out_for_delivery`,
   * `complete`, `reopen`, `hold`, `unhold` and `set_due` all end up here.
   *
   * No optimistic cache write happens in `onMutate` — only `pending` state,
   * which disables the card's buttons and shows the busy pulse. That is
   * deliberate: `claim` is a real race (two tablets, one order) and the
   * brief's whole point is that the LOSER sees a 409 naming the winner
   * (`server/services/orderTransitions.ts`'s `UPDATE … WHERE
   * assigned_user_id IS NULL`) — a board that painted "Sam has this" the
   * instant either tablet tapped would hide exactly the failure this
   * package has to prove it surfaces. `onSuccess` applies the server's own
   * fresh row (`invalidateAfterOpsTransition`); nothing here ever assumes
   * success before the response says so.
   */
  const transitionMutation = useMutation({
    mutationFn: ({ order, input }: { order: BoardOrder; input: TransitionOrderInput }) =>
      postOrderTransition(order.id, input),
    onMutate: ({ order }) => setPending(order.id, true),
    onSuccess: (result, { order, input }) => {
      void invalidateAfterOpsTransition(queryClient, result.order);
      if (result.changed) setAnnouncement(announceFor(order, input.action));
      if (input.action === "complete" && result.changed) {
        const label = order.fulfilmentMethod === "delivery" ? "Delivered" : "Handed over";
        toast({
          title: `${label} — order ${order.shortCode}`,
          description: "Tap Undo if that was a mistake.",
          action: (
            <ToastAction
              altText="Undo"
              onClick={() => transitionMutation.mutate({ order: result.order, input: { action: "reopen" } })}
            >
              Undo
            </ToastAction>
          ),
        });
      }
    },
    onError: (error: TransitionClientError, { order }) => {
      if (error.code === "ORDER_ALREADY_ASSIGNED") {
        toast({
          title: "Someone got there first",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: `Order ${order.shortCode} did not update`,
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: (_result, _error, { order }) => setPending(order.id, false),
  });

  const runTransition = useCallback(
    (order: BoardOrder, input: TransitionOrderInput) => {
      if (blockedReason) {
        toast({ title: "The board is not up to date", description: blockedReason });
        return;
      }
      transitionMutation.mutate({ order, input });
    },
    [blockedReason, transitionMutation, toast],
  );

  /**
   * `urgent` is a status flag, not a lifecycle stage — it was never one of
   * `TRANSITION_ACTIONS` (`shared/orders/opsTransitions.ts`, N0) before N3b
   * existed and it still is not one now, so it keeps the v0 PATCH write this
   * page always had. Kept optimistic (unlike the transition mutation above)
   * for the same reason it always was: nothing about "urgent" can race the
   * way a claim can — it has no losing side.
   */
  const urgentMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      const response = await apiRequest("PATCH", `/api/orders/${orderId}`, { status });
      return response.json();
    },
    onMutate: async ({ orderId, status }) => {
      setPending(orderId, true);
      await queryClient.cancelQueries({ queryKey: ["/api/orders/board"] });
      const previousOrder = queryClient
        .getQueryData<OpsBoardResponse>(["/api/orders/board"])
        ?.orders.find((row) => row.id === orderId);
      queryClient.setQueryData<OpsBoardResponse>(["/api/orders/board"], (current) =>
        current
          ? { ...current, orders: current.orders.map((row) => (row.id === orderId ? { ...row, status } : row)) }
          : current,
      );
      return { previousOrder };
    },
    onSuccess: async () => {
      await invalidateAfterOrderStatusChange(queryClient);
      setAnnouncement("Order marked urgent");
    },
    onError: (error: Error, variables, context) => {
      if (context?.previousOrder) {
        const restored = context.previousOrder;
        queryClient.setQueryData<OpsBoardResponse>(["/api/orders/board"], (current) =>
          current
            ? { ...current, orders: current.orders.map((row) => (row.id === variables.orderId ? restored : row)) }
            : current,
        );
      }
      toast({ title: "That did not save", description: error.message, variant: "destructive" });
    },
    onSettled: (_data, _error, variables) => {
      if (variables?.orderId) setPending(variables.orderId, false);
    },
  });

  const writeUrgent = useCallback(
    (order: BoardOrder) => {
      if (blockedReason) {
        toast({ title: "The board is not up to date", description: blockedReason });
        return;
      }
      urgentMutation.mutate({ orderId: order.id, status: "urgent" });
    },
    [blockedReason, urgentMutation, toast],
  );

  // My own open orders — the break loop's working set ("Hand over my
  // orders…" / "Release all") and `OpsStationPicker`'s enabled state for
  // both buttons.
  const myOpenOrders = useMemo(
    () => board.orders.filter((order) => order.assignedUserId === user?.id && order.status !== "completed"),
    [board.orders, user?.id],
  );

  const runLoop = useCallback(
    async (input: TransitionOrderInput, successTitle: string) => {
      if (blockedReason) {
        toast({ title: "The board is not up to date", description: blockedReason });
        return;
      }
      if (myOpenOrders.length === 0) return;
      setLoopBusy(true);
      let ok = 0;
      let failed = 0;
      for (const order of myOpenOrders) {
        try {
          await transitionMutation.mutateAsync({ order, input });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      setLoopBusy(false);
      toast({
        title: successTitle,
        description: `${ok} order${ok === 1 ? "" : "s"}.${failed ? ` ${failed} could not be moved.` : ""}`,
      });
    },
    [blockedReason, myOpenOrders, transitionMutation, toast],
  );

  const releaseAll = useCallback(() => {
    void runLoop({ action: "unclaim" }, "Orders released");
  }, [runLoop]);

  const handOverMineTo = useCallback(
    (targetUserId: string) => {
      setHandOverPicking(false);
      void runLoop({ action: "assign", userId: targetUserId }, "Orders handed over");
    },
    [runLoop],
  );

  const cardHandlers = useMemo(
    () => ({
      now,
      settings: board.settings,
      role: user?.role,
      currentUserId: user?.id,
      staff: board.staff,
      blockedReason,
      onClaim: (order: BoardOrder) => runTransition(order, { action: "claim" }),
      onUnclaim: (order: BoardOrder) => runTransition(order, { action: "unclaim" }),
      onAssign: (order: BoardOrder, userId: string) => runTransition(order, { action: "assign", userId }),
      onReady: (order: BoardOrder) => runTransition(order, { action: "ready" }),
      onUnready: (order: BoardOrder) => runTransition(order, { action: "unready" }),
      onArrived: (order: BoardOrder) => runTransition(order, { action: "arrived" }),
      onOutForDelivery: (order: BoardOrder) => runTransition(order, { action: "out_for_delivery" }),
      onComplete: (order: BoardOrder, actualAt?: string) =>
        runTransition(order, {
          action: "complete",
          label: order.fulfilmentMethod === "delivery" ? "delivered" : "handed_over",
          ...(actualAt ? { actualAt } : {}),
        }),
      onReopen: (order: BoardOrder) => runTransition(order, { action: "reopen" }),
      onHold: (order: BoardOrder, reason?: string) =>
        runTransition(order, { action: "hold", ...(reason ? { reason } : {}) }),
      onUnhold: (order: BoardOrder) => runTransition(order, { action: "unhold" }),
      onSetDue: (order: BoardOrder, due: { dueInMinutes: number } | { dueTime: string }) =>
        runTransition(order, "dueInMinutes" in due ? { action: "set_due", dueInMinutes: due.dueInMinutes } : { action: "set_due", dueTime: due.dueTime }),
      onUrgent: writeUrgent,
      onView: (orderId: string) => setDetailsOrderId(orderId),
      onEdit: (order: BoardOrder) => setEditOrder(order),
      onDelete: (order: BoardOrder) => setDeleteOrder(order),
    }),
    [now, board.settings, board.staff, user?.role, user?.id, blockedReason, runTransition, writeUrgent],
  );

  const detailsOrder = useMemo(
    () => board.orders.find((order) => order.id === detailsOrderId) ?? null,
    [board.orders, detailsOrderId],
  );

  /**
   * The details sheet's status select carries the whole `OrderStatus` enum
   * (`select-order-status-<id>`, kept from v0 — brief: "`awaiting-customer`
   * maps to `ready`, `completed` to `complete`"). Resuming a held order
   * through this control is `unhold` regardless of which OTHER status was
   * picked — `unhold` restores whatever status the matching `held` event
   * recorded (`assertTransition`, N0), so the dropdown's job is only to say
   * "not held any more", not to guess the destination itself. `pending` and
   * `urgent` have no transition of their own (neither ever did — see
   * `writeUrgent`'s doc comment) and keep the PATCH this control always used.
   */
  const onSheetStatusChange = useCallback(
    (order: BoardOrder, status: OrderStatus) => {
      if (order.status === "on-hold" && status !== "on-hold") {
        runTransition(order, { action: "unhold" });
        return;
      }
      if (status === "on-hold") {
        runTransition(order, { action: "hold" });
        return;
      }
      if (status === "awaiting-customer") {
        runTransition(order, { action: "ready" });
        return;
      }
      if (status === "completed") {
        runTransition(order, {
          action: "complete",
          label: order.fulfilmentMethod === "delivery" ? "delivered" : "handed_over",
        });
        return;
      }
      if (blockedReason) {
        toast({ title: "The board is not up to date", description: blockedReason });
        return;
      }
      urgentMutation.mutate({ orderId: order.id, status });
    },
    [runTransition, blockedReason, urgentMutation, toast],
  );

  const headerStationRow = (
    <div className="space-y-2">
      <OpsStaffStrip staff={board.staff} now={now} />
      <OpsStationPicker
        me={board.me}
        hasOpenAssigned={myOpenOrders.length > 0}
        onHandOverMine={() => setHandOverPicking(true)}
        onReleaseAll={releaseAll}
        handOverPending={loopBusy}
        releasePending={loopBusy}
      />
      {handOverPicking && (
        <div
          role="group"
          aria-label="Hand your orders to"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2"
          data-testid="ops-hand-over-picker"
        >
          {board.staff.filter((member) => member.userId !== user?.id).length === 0 ? (
            <p className="px-1 py-1 text-sm text-muted-foreground">Nobody else is on the board yet.</p>
          ) : (
            board.staff
              .filter((member) => member.userId !== user?.id)
              .map((member) => (
                <Button
                  key={member.userId}
                  type="button"
                  size="touch"
                  variant="outline"
                  disabled={loopBusy}
                  onClick={() => handOverMineTo(member.userId)}
                  data-testid={`ops-hand-over-to-${member.userId}`}
                >
                  {member.name}
                </Button>
              ))
          )}
          <Button
            type="button"
            size="touch"
            variant="ghost"
            onClick={() => setHandOverPicking(false)}
            data-testid="ops-hand-over-cancel"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <OpsShell
        mainRef={mainRef}
        isTwoPane={isTwoPane}
        tab={tab}
        onTabChange={onTabChange}
        formSlot={<POS embedded={embeddedPosProps} />}
        headerExtras={<OpsShiftControls />}
        boardArrivalCount={boardArrivalCount}
        board={
          <>
            <OpsBoard
              orders={board.orders}
              now={now}
              settings={board.settings}
              filter={filter}
              onFilterChange={onFilterChange}
              search={searchText}
              onSearchChange={setSearchText}
              currentUserId={user?.id}
              isInitialLoading={board.isInitialLoading}
              isFetching={board.isFetching}
              staleness={board.staleness}
              onRefresh={board.refetch}
              pendingIds={pendingIds}
              isAlertForOrder={alerts.isAlertForOrder}
              headerStationRow={headerStationRow}
              cardHandlers={cardHandlers}
            />
            {/* On a phone the details panel is inline rather than a Sheet, so
                it renders inside the board column. On anything wider the
                component renders a Sheet and this slot paints nothing. */}
            <OpsDetailsSheet
              order={detailsOrder}
              open={detailsOrderId !== null}
              onOpenChange={(open) => !open && setDetailsOrderId(null)}
              settings={board.settings}
              role={user?.role}
              statusPending={detailsOrder ? pendingIds.has(detailsOrder.id) : false}
              blockedReason={blockedReason}
              onStatusChange={onSheetStatusChange}
              onEdit={(order) => {
                setDetailsOrderId(null);
                setEditOrder(order);
              }}
              onDelete={(order) => {
                setDetailsOrderId(null);
                setDeleteOrder(order);
              }}
            />
          </>
        }
      />

      <OpsEditDialog
        order={editOrder}
        open={editOrder !== null}
        onOpenChange={(open) => !open && setEditOrder(null)}
      />
      <OpsDeleteDialog
        order={deleteOrder}
        open={deleteOrder !== null}
        onOpenChange={(open) => !open && setDeleteOrder(null)}
      />
      <OpsAnnouncer message={announcement} />
    </>
  );
}
