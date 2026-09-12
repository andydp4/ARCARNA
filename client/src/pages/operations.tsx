import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useNavigation } from "@/contexts/NavigationContext";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useOpsBoard } from "@/hooks/useOpsBoard";
import { useOpsTicker } from "@/hooks/useOpsTicker";
import { useWakeLock } from "@/hooks/useWakeLock";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAfterOrderStatusChange } from "@/lib/query-invalidation";
import { STORAGE_OPS_FILTER, STORAGE_OPS_TAB } from "@shared/storageKeys";
import type { OrderStatus } from "@shared/schema";
import type { ApiOrderRow, BoardOrder } from "@/lib/orderTypes";
import { OpsBoard } from "@/components/operations/OpsBoard";
import { OpsAnnouncer } from "@/components/operations/OpsAnnouncer";
import { OpsDeleteDialog } from "@/components/operations/OpsDeleteDialog";
import { OpsDetailsSheet } from "@/components/operations/OpsDetailsSheet";
import { OpsEditDialog } from "@/components/operations/OpsEditDialog";
import type { OpsFilter } from "@/components/operations/OpsHeader";

/**
 * The Operations Centre.
 *
 * One screen that answers the question Open Orders could not: what needs doing
 * now, who is it for, and is it late — see docs/briefs/PHASE_N_OPERATIONS_CENTRE.md.
 * This is v0 (N1): the lanes, the cards, the clocks and one-tap Handed over /
 * Delivered, built over the columns `orders` already has. Assignment, stages,
 * alerts and the embedded order form arrive in N2–N6 and slot into the shell
 * this file establishes.
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
  /** The order form. A link to it in v0; the POS itself from N6. */
  formSlot: ReactNode;
  /** N5b hangs the alert rail here. */
  alertsSlot?: ReactNode;
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
}: OpsShellProps) {
  const [formCollapsed, setFormCollapsed] = useState(false);

  return (
    <div
      ref={mainRef}
      // The app header is 4rem; the board owns everything below it and each
      // pane scrolls on its own.
      className="flex h-[calc(100dvh-4rem)] min-w-0 flex-col overflow-hidden"
    >
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
            {!formCollapsed && formSlot}
          </div>
        </div>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as OpsTab)}
          className="flex min-h-0 flex-1 flex-col gap-3 p-3"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="board" className="min-h-11" data-testid="ops-tab-board">
              Board
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
            className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
          >
            {formSlot}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/**
 * v0's form slot.
 *
 * The brief's end state is the POS itself rendered in this pane (N6 makes it
 * embeddable). Until then this is a deliberate stand-in: a prominent way to
 * get to the order form, on the screen where orders are worked, rather than
 * half an embedded till that would have to be unpicked. `/create-order` keeps
 * working exactly as it does today, which is why its own journey and a11y
 * coverage are untouched by this package.
 */
function NewOrderSlot() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-base font-semibold text-foreground">New order</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Key a sale on the till. It lands on this board the moment it is placed.
      </p>
      <Button asChild size="touch" className="mt-3 w-full" data-testid="ops-new-order">
        <Link href="/create-order">
          <Plus className="h-4 w-4" aria-hidden />
          Start a new order
        </Link>
      </Button>
    </div>
  );
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

  /**
   * Every card action in v0 is one status write.
   *
   * The transition endpoint the brief specifies (`POST /api/orders/:id/transition`,
   * one locked transaction per stage) is N3b. Until it exists the board uses
   * the endpoint that already settles orders — `PATCH /api/orders/:id` — so
   * Handed over and Delivered go through exactly the completion path the old
   * list used, with the same commission consequences and the same invalidation
   * (`invalidateAfterOrderStatusChange`). Nothing new is invented server-side
   * by this package.
   *
   * The optimistic update is not decoration either: on the counter, the gap
   * between the tap and the poll is the moment a second cashier completes the
   * same order.
   */
  const statusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus; announce: string }) => {
      const response = await apiRequest("PATCH", `/api/orders/${orderId}`, { status });
      return response.json();
    },
    onMutate: async ({ orderId, status }) => {
      setPending(orderId, true);
      await queryClient.cancelQueries({ queryKey: ["/api/orders"] });
      const previous = queryClient.getQueryData<ApiOrderRow[]>(["/api/orders"]);
      queryClient.setQueryData<ApiOrderRow[]>(["/api/orders"], (current = []) =>
        current.map((row) => (row.id === orderId ? { ...row, status } : row)),
      );
      return { previous };
    },
    onSuccess: async (_data, variables) => {
      await invalidateAfterOrderStatusChange(queryClient);
      setAnnouncement(variables.announce);
    },
    onError: (error: any, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["/api/orders"], context.previous);
      toast({
        title: "That did not save",
        description: error?.message ?? "The order was left as it was.",
        variant: "destructive",
      });
    },
    onSettled: (_data, _error, variables) => {
      if (variables?.orderId) setPending(variables.orderId, false);
    },
  });

  const blockedReason = board.staleness.isStale ? board.staleness.reason : null;

  const write = useCallback(
    (order: BoardOrder, status: OrderStatus, announce: string) => {
      if (blockedReason) {
        toast({ title: "The board is not up to date", description: blockedReason });
        return;
      }
      statusMutation.mutate({ orderId: order.id, status, announce });
    },
    [blockedReason, statusMutation, toast],
  );

  const cardHandlers = useMemo(
    () => ({
      now,
      settings: board.settings,
      role: user?.role,
      blockedReason,
      onComplete: (order: BoardOrder) =>
        write(
          order,
          "completed",
          order.fulfilmentMethod === "delivery"
            ? `Order ${order.shortCode} delivered`
            : `Order ${order.shortCode} handed over`,
        ),
      onHold: (order: BoardOrder) => write(order, "on-hold", `Order ${order.shortCode} on hold`),
      onResume: (order: BoardOrder) => write(order, "pending", `Order ${order.shortCode} resumed`),
      onUrgent: (order: BoardOrder) => write(order, "urgent", `Order ${order.shortCode} marked urgent`),
      onView: (orderId: string) => setDetailsOrderId(orderId),
      onEdit: (order: BoardOrder) => setEditOrder(order),
      onDelete: (order: BoardOrder) => setDeleteOrder(order),
    }),
    [now, board.settings, user?.role, blockedReason, write],
  );

  const detailsOrder = useMemo(
    () => board.orders.find((order) => order.id === detailsOrderId) ?? null,
    [board.orders, detailsOrderId],
  );

  // A card can be completed from the sheet's status select, which is the same
  // write as the card's own button and must announce the same way.
  const onSheetStatusChange = useCallback(
    (order: BoardOrder, status: OrderStatus) =>
      write(order, status, `Order ${order.shortCode} is now ${status.replace(/-/g, " ")}`),
    [write],
  );

  return (
    <>
      <OpsShell
        mainRef={mainRef}
        isTwoPane={isTwoPane}
        tab={tab}
        onTabChange={onTabChange}
        formSlot={<NewOrderSlot />}
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
