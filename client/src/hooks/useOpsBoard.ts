import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OpsTimingSettings } from "@shared/orders/opsState";
import type { ApiOrderRow, BoardOrder } from "@/lib/orderTypes";

/**
 * Everything the board draws, from whatever the server can currently tell us.
 *
 * v0 reads `GET /api/orders` — the list the old Open Orders page read — and
 * adapts each row into the `BoardOrder` shape that `GET /api/orders/board`
 * will return from N3a (docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, API). The
 * cards are therefore written against the real contract from their first
 * commit, and N3a's job is to swap the query and delete `toBoardOrder`, not to
 * rewrite a board.
 *
 * What the adapter cannot invent, it sets to null. There are no stage columns
 * on `orders` until migration 065, so no card can be "ready", "on the road" or
 * "customer waiting" yet — and that is the honest answer, not a gap to paper
 * over: `deriveCardState` degrades to the states the existing fields really do
 * support (on time, due soon, late, delayed, held, completed, scheduled,
 * carried over), which is exactly what N1 promises the floor.
 */

/**
 * The org's timing rules. Real, per-organisation values arrive with the
 * `ops_*` columns in N2; until then these are the defaults that migration will
 * write (brief, Data model → `ALTER TABLE organizations`), so the board's
 * behaviour does not change when the settings appear — only who decides them.
 */
export const OPS_DEFAULT_TIMING = {
  prepSlaMinutes: 20,
  deliveryLeadMinutes: 45,
  dueSoonLeadMinutes: 10,
  lateGraceMinutes: 5,
} as const;

/** How long a board may go without a successful read before it says so. */
export const OPS_STALE_AFTER_MS = 30_000;

/** How often v0 re-reads the order list. N3a replaces this with a push stream. */
export const OPS_POLL_INTERVAL_MS = 10_000;

export interface OpsStaleness {
  isStale: boolean;
  /** Why, in words a cashier can act on. Null while the board is fresh. */
  reason: string | null;
}

export interface OpsBoardData {
  orders: BoardOrder[];
  settings: OpsTimingSettings;
  /** True only on the very first load, when there is nothing to show yet. */
  isInitialLoading: boolean;
  isFetching: boolean;
  staleness: OpsStaleness;
  refetch: () => void;
}

/** One row of `GET /api/orders`, in the shape the cards are written against. */
export function toBoardOrder(row: ApiOrderRow): BoardOrder {
  const fulfilment = row.fulfilmentMethod === "delivery" ? "delivery" : "collection";
  const dateKind =
    row.dateKind === "preorder" || row.dateKind === "backdated" ? row.dateKind : "live";
  return {
    id: row.id,
    shortCode: row.id.slice(0, 8),
    customerId: row.customerId ?? null,
    customerName: row.customerName?.trim() ? row.customerName.trim() : null,
    // The list projection carries no phone number; the details sheet fetches
    // the full order, which does, and offers the `tel:` link from there.
    customerPhone: null,
    total: row.total,
    paymentMethod: row.paymentMethod,
    channel: row.channel ?? "pos",
    status: row.status || "pending",
    fulfilmentMethod: fulfilment,
    dateKind,
    createdAt: row.createdAt,
    enteredAt: row.enteredAt ?? null,
    etaGiven: row.etaGiven ?? null,
    revisedEta: row.revisedEta ?? null,
    delayFlag: row.delayFlag === true,
    delayReason: row.delayReason ?? null,
    // Everything below is a column that does not exist yet (N2) or a join the
    // list projection does not do. Null, not undefined: the board has to be
    // able to tell "nobody has it" from "we did not ask".
    assignedUserId: null,
    assignedUserName: null,
    heldAt: null,
    readyAt: null,
    customerArrivedAt: null,
    outForDeliveryAt: null,
    settledAt: null,
    inputUserId: row.inputUserId ?? null,
    inputUserName: row.inputUserName ?? null,
  };
}

interface SettingsResponse {
  timezone?: string;
}

/**
 * @param now the ticker's current instant, so staleness is judged against the
 * same clock the cards count with rather than a second one of its own.
 */
export function useOpsBoard(now: Date): OpsBoardData {
  const ordersQuery = useQuery<ApiOrderRow[]>({
    queryKey: ["/api/orders"],
    refetchInterval: OPS_POLL_INTERVAL_MS,
    // Keep the last good board on screen across a refetch. A board that blanks
    // every ten seconds is worse than one that is ten seconds old, and the
    // staleness banner below is what tells the operator which they are looking
    // at.
    placeholderData: (previous) => previous,
  });

  // Times are rendered in the organisation's timezone, never the tablet's:
  // a device left on the wrong zone would otherwise make every promise on the
  // board an hour out (brief, Decisions locked → Time).
  const settingsQuery = useQuery<SettingsResponse>({ queryKey: ["/api/settings"] });

  const orders = useMemo(
    () => (ordersQuery.data ?? []).map(toBoardOrder),
    [ordersQuery.data],
  );

  const settings = useMemo<OpsTimingSettings>(
    () => ({
      timezone: settingsQuery.data?.timezone || "Europe/London",
      ...OPS_DEFAULT_TIMING,
    }),
    [settingsQuery.data?.timezone],
  );

  /**
   * v0 has no `serverNow` to compare against, so staleness is judged from what
   * the client can see: a failed poll, or a successful one too long ago. Both
   * matter because the service worker answers a failed API GET from its cache
   * with the original 200 (finding G11) — "the request succeeded" is not
   * evidence the shop's network is up, but "nothing has changed for half a
   * minute while we were polling every ten seconds" is evidence something is
   * wrong. N3a replaces this with the `serverNow`-did-not-advance test.
   */
  const staleness = useMemo<OpsStaleness>(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { isStale: true, reason: "This tablet is offline — the board is not updating." };
    }
    if (ordersQuery.isError || ordersQuery.failureCount > 0) {
      return { isStale: true, reason: "The board could not reach the server on its last try." };
    }
    const updatedAt = ordersQuery.dataUpdatedAt;
    if (updatedAt > 0 && now.getTime() - updatedAt > OPS_STALE_AFTER_MS) {
      const seconds = Math.floor((now.getTime() - updatedAt) / 1000);
      return { isStale: true, reason: `The board has not refreshed for ${seconds} seconds.` };
    }
    return { isStale: false, reason: null };
  }, [ordersQuery.isError, ordersQuery.failureCount, ordersQuery.dataUpdatedAt, now]);

  return {
    orders,
    settings,
    isInitialLoading: ordersQuery.isPending && ordersQuery.data === undefined,
    isFetching: ordersQuery.isFetching,
    staleness,
    refetch: () => {
      void ordersQuery.refetch();
    },
  };
}
