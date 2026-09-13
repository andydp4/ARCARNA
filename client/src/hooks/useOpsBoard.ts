import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { OpsTimingSettings } from "@shared/orders/opsState";
import type { OpsAlertKind, OpsAlertStation } from "@shared/orders/opsAlerts";
import type { BoardOrder } from "@/lib/orderTypes";
import { resolveApiUrl } from "@/lib/appPaths";
import { getSelectedOrgId } from "@/lib/orgScope";

/**
 * Everything the board draws, and how it stays current — N3a's hand-over
 * from N1 (whose module comment this replaces).
 *
 * v0 read `GET /api/orders` and adapted each row into a `BoardOrder` because
 * the stage columns and the real endpoint did not exist yet. Both do now:
 * this reads `GET /api/orders/board` (server/services/opsBoard.ts) once on
 * mount and on reconnect, then applies deltas pushed over
 * `GET /api/orders/board/stream` (an `EventSource`, server/routes/
 * opsStream.ts) for everything in between. The query key stays
 * `['/api/orders/board']` so the rest of the board — the optimistic status
 * mutation in `operations.tsx`, the reconciliation poll below — all read and
 * write the one cache.
 *
 * `EventSource` is opened with `withCredentials: true` rather than through
 * `apiRequest`'s header machinery: the browser's `EventSource` cannot set
 * arbitrary request headers (no `Authorization`, no `X-Org-Id`), only send
 * cookies and follow query parameters. For every board user except a
 * SUPER_ADMIN switching tenants, `requireOrgContext` resolves the org from
 * the signed-in account itself — no header needed — and the one case that
 * does (`?orgId=`) is a query parameter the route already reads as the
 * SUPER_ADMIN fallback (server/auth/commonAuth.ts).
 */

export interface OpsBoardSettings {
  prepSlaMinutes: number;
  dueSoonLeadMinutes: number;
  lateGraceMinutes: number;
  deliveryLeadMinutes: number;
  autoClaimOnCreate: boolean;
  alertOnSlaDue: boolean;
  keepScreenAwake: boolean;
  reconcilePollSeconds: number;
}

export interface OpsBoardStaffRow {
  userId: string;
  name: string;
  role: string;
  station: string | null;
  onBreak: boolean;
  lastSeenAt: string | null;
  present: boolean;
  openCount: number;
}

export interface OpsBoardSummary {
  open: number;
  collection: number;
  delivery: number;
  unassigned: number;
  mine: number;
  lateNow: number;
  dueSoonNow: number;
  readyWaiting: number;
  carriedOver: number;
  completedToday: number;
}

/**
 * One row of the board's `alerts` array — the signed-in user's own unacked,
 * unresolved alerts, exactly as `server/services/opsAlerts.ts`'s
 * `OpsAlertListItem` (and `listFor`, which the board route calls) shapes it.
 * Mirrored here rather than imported from `server/services/opsAlerts.ts`
 * itself: that module also does `await import("../db")` inside several of its
 * exports, and nothing in the client bundle should import from `server/**`
 * even for a type, the same reason `operations.tsx`'s `TransitionResult`
 * mirrors `runOrderTransition`'s return shape instead of importing it (N5a).
 */
export interface OpsBoardAlert {
  id: string;
  orderId: string;
  kind: OpsAlertKind;
  /** '' = addressed to the assignee personally (pulse only); a station name = a station-wide broadcast. */
  station: OpsAlertStation;
  dueAt: string | null;
  createdAt: string;
}

/** The exact `GET /api/orders/board` response shape (brief, API section). */
export interface OpsBoardResponse {
  serverNow: string;
  tradingDay: string;
  timezone: string;
  settings: OpsBoardSettings;
  me: { userId: string | null; station: string | null; onBreak: boolean };
  staff: OpsBoardStaffRow[];
  orders: BoardOrder[];
  alerts: OpsBoardAlert[];
  summary: OpsBoardSummary;
}

/** One `opsBus` delta, exactly as `server/services/opsBus.ts` defines it. */
export type OpsBusEvent =
  | { type: "order"; order: BoardOrder }
  | { type: "order_removed"; id: string }
  | { type: "alert"; alert: OpsBoardAlert }
  | { type: "staff"; staff: OpsBoardStaffRow[] }
  | { type: "summary"; summary: OpsBoardSummary };

/** How long a board may go without a successful read before it says so. */
export const OPS_STALE_AFTER_MS = 30_000;

export interface OpsStaleness {
  isStale: boolean;
  /** Why, in words a cashier can act on. Null while the board is fresh. */
  reason: string | null;
}

export interface OpsBoardData {
  orders: BoardOrder[];
  settings: OpsTimingSettings;
  me: OpsBoardResponse["me"];
  staff: OpsBoardStaffRow[];
  /** The signed-in user's own open alerts (N5b) — always `[]` before the first successful load. */
  alerts: OpsBoardAlert[];
  summary: OpsBoardSummary | null;
  /** True only on the very first load, when there is nothing to show yet. */
  isInitialLoading: boolean;
  isFetching: boolean;
  staleness: OpsStaleness;
  refetch: () => void;
}

export const OPS_BOARD_QUERY_KEY = ["/api/orders/board"] as const;

/** Applies one pushed delta straight into the board's own query-cache entry. */
export function applyOpsBusEvent(queryClient: QueryClient, event: OpsBusEvent): void {
  queryClient.setQueryData<OpsBoardResponse>(OPS_BOARD_QUERY_KEY, (current) => {
    if (!current) return current;
    switch (event.type) {
      case "order": {
        const exists = current.orders.some((o) => o.id === event.order.id);
        const orders = exists
          ? current.orders.map((o) => (o.id === event.order.id ? event.order : o))
          : [...current.orders, event.order];
        return { ...current, orders };
      }
      case "order_removed":
        return { ...current, orders: current.orders.filter((o) => o.id !== event.id) };
      case "staff":
        return { ...current, staff: event.staff };
      case "summary":
        return { ...current, summary: event.summary };
      case "alert":
        // No caller publishes this event yet: `server/services/opsBus.ts`'s
        // "alert" variant has existed since N3a but nothing in this phase's
        // touch lists (N5a's included — its own alert generation runs through
        // `createInTx`/`sweepOpsAlerts`, not `publishOpsEvent`) ever emits
        // one. The board's reconciliation poll is what actually delivers
        // fresh `alerts` rows today (`useOpsAlerts.ts`); this case stays a
        // documented no-op rather than a guess at a merge shape for an event
        // this server version never sends.
        return current;
      default:
        return current;
    }
  });
}

function parseOpsBusEvent(raw: string): OpsBusEvent | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.type === "string") return parsed as OpsBusEvent;
  } catch {
    // Malformed payloads are dropped rather than thrown — a stray remnant of
    // the ring buffer must never take the whole tab down.
  }
  return null;
}

/** The stream URL for the signed-in user's tenant, `?orgId=` only for a SUPER_ADMIN switching one in. */
function boardStreamUrl(): string {
  const orgId = getSelectedOrgId();
  const base = resolveApiUrl("/api/orders/board/stream");
  return orgId ? `${base}${base.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(orgId)}` : base;
}

/**
 * Opens one `EventSource` for the life of the component, reconnecting,
 * reloading the board on `open` (after the first) and on any gap the server
 * reports, and applying every delta into the board's own cache entry.
 */
function useOpsBoardStream(queryClient: QueryClient, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") return;

    let source: EventSource | null = null;
    let stopped = false;
    let hasOpenedOnce = false;

    const reloadBoard = () => {
      void queryClient.invalidateQueries({ queryKey: OPS_BOARD_QUERY_KEY });
    };

    function connect() {
      if (stopped) return;
      source = new EventSource(boardStreamUrl(), { withCredentials: true });

      source.onopen = () => {
        // The very first connection has nothing to reload — the ordinary
        // `useQuery` below already fetched the board before this stream ever
        // opens. Every connection AFTER that means the socket was down for
        // some stretch (a dropped wifi, a backgrounded tab, a server
        // restart), which the 5-minute ring buffer's replay may or may not
        // fully cover — a fresh GET is the safe default (brief: "reloads the
        // board on open").
        if (hasOpenedOnce) reloadBoard();
        hasOpenedOnce = true;
      };

      source.onmessage = (event) => {
        const parsed = parseOpsBusEvent(event.data);
        if (parsed) applyOpsBusEvent(queryClient, parsed);
      };

      // The server sends a NAMED `reload` event (no `data` worth parsing) when
      // a reconnect's `Last-Event-ID` has aged out of its 5-minute ring
      // buffer — the "gap detection" the brief asks for. The browser's own
      // automatic reconnect already resent that id; this is the route
      // refusing to trust a partial replay rather than the client noticing a
      // hole on its own.
      source.addEventListener("reload", reloadBoard);

      source.onerror = () => {
        // The browser retries on its own using the server's `retry: 3000`
        // (`readyState` cycles through CONNECTING); nothing to do here except
        // let `onopen` fire again once it succeeds.
      };
    }

    connect();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // A backgrounded tab's EventSource can be throttled or silently
      // dropped by the browser well before its own error handler notices —
      // becoming visible again is exactly the moment `useOpsTicker` also
      // resumes ticking, so treat it as a reconnect rather than trust a
      // connection that may have gone stale while nobody was watching.
      reloadBoard();
      source?.close();
      connect();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      source?.close();
    };
  }, [queryClient, enabled]);
}

/**
 * @param now the ticker's current instant, so staleness is judged against the
 * same clock the cards count with rather than a second one of its own.
 */
export function useOpsBoard(now: Date): OpsBoardData {
  const queryClient = useQueryClient();

  const boardQuery = useQuery<OpsBoardResponse>({
    queryKey: OPS_BOARD_QUERY_KEY,
    // The reconciliation poll (brief: "a reconciliation poll every
    // `ops_reconcile_poll_seconds`"), not the board's primary source of
    // truth — the stream carries everything in between. Guards against a
    // missed event the ring buffer could not replay and a `reload` the
    // client somehow failed to act on.
    refetchInterval: (query) => {
      const seconds = (query.state.data as OpsBoardResponse | undefined)?.settings.reconcilePollSeconds ?? 60;
      return Math.max(5, seconds) * 1000;
    },
    // Keep the last good board on screen across a refetch. A board that
    // blanks every poll is worse than one that is briefly old, and the
    // staleness banner below is what tells the operator which they are
    // looking at.
    placeholderData: (previous) => previous,
  });

  useOpsBoardStream(queryClient, true);

  const orders = boardQuery.data?.orders ?? [];

  const settings = useMemo<OpsTimingSettings>(() => {
    const s = boardQuery.data?.settings;
    return {
      timezone: boardQuery.data?.timezone || "Europe/London",
      prepSlaMinutes: s?.prepSlaMinutes ?? 20,
      dueSoonLeadMinutes: s?.dueSoonLeadMinutes ?? 10,
      lateGraceMinutes: s?.lateGraceMinutes ?? 5,
      deliveryLeadMinutes: s?.deliveryLeadMinutes ?? 45,
    };
  }, [boardQuery.data?.settings, boardQuery.data?.timezone]);

  const staleness = useMemo<OpsStaleness>(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { isStale: true, reason: "This tablet is offline — the board is not updating." };
    }
    if (boardQuery.isError || boardQuery.failureCount > 0) {
      return { isStale: true, reason: "The board could not reach the server on its last try." };
    }
    const updatedAt = boardQuery.dataUpdatedAt;
    if (updatedAt > 0 && now.getTime() - updatedAt > OPS_STALE_AFTER_MS) {
      const seconds = Math.floor((now.getTime() - updatedAt) / 1000);
      return { isStale: true, reason: `The board has not refreshed for ${seconds} seconds.` };
    }
    return { isStale: false, reason: null };
  }, [boardQuery.isError, boardQuery.failureCount, boardQuery.dataUpdatedAt, now]);

  return {
    orders,
    settings,
    me: boardQuery.data?.me ?? { userId: null, station: null, onBreak: false },
    staff: boardQuery.data?.staff ?? [],
    alerts: boardQuery.data?.alerts ?? [],
    summary: boardQuery.data?.summary ?? null,
    isInitialLoading: boardQuery.isPending && boardQuery.data === undefined,
    isFetching: boardQuery.isFetching,
    staleness,
    refetch: () => {
      void boardQuery.refetch();
    },
  };
}
