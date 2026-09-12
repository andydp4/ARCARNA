import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { OPS_BOARD_QUERY_KEY } from "@/hooks/useOpsBoard";
import type { BoardOrder } from "@/lib/orderTypes";

function isEndpointFamilyMatch(queryKey: QueryKey, endpoint: string): boolean {
  const [head] = queryKey;
  if (typeof head !== "string") return false;
  // Keys are full request URLs, so a filtered list ("/api/x?status=pending")
  // belongs to the same family as "/api/x" and must invalidate with it.
  return (
    head === endpoint || head.startsWith(`${endpoint}/`) || head.startsWith(`${endpoint}?`)
  );
}

/**
 * Invalidates all queries that belong to an API endpoint family.
 * Example: "/api/analytics" invalidates "/api/analytics/monthly-summary", etc.
 */
export function invalidateEndpointFamily(queryClient: QueryClient, endpoint: string) {
  return queryClient.invalidateQueries({
    predicate: (query: Query) => isEndpointFamilyMatch(query.queryKey, endpoint),
  });
}

/**
 * Domain refresh after order/inventory-affecting mutations (POS checkout, order edit/delete, stock changes).
 */
export async function invalidateOperationalData(
  queryClient: QueryClient,
  options?: {
    includeOrders?: boolean;
    includeProducts?: boolean;
    includeInventory?: boolean;
    includeInvoices?: boolean;
    includeReports?: boolean;
    includeAnalytics?: boolean;
  }
) {
  const {
    includeOrders = true,
    includeProducts = true,
    includeInventory = true,
    includeInvoices = true,
    includeReports = true,
    includeAnalytics = true,
  } = options ?? {};

  const tasks: Array<Promise<unknown>> = [];
  if (includeOrders) tasks.push(invalidateEndpointFamily(queryClient, "/api/orders"));
  if (includeProducts) tasks.push(invalidateEndpointFamily(queryClient, "/api/products"));
  if (includeInventory) tasks.push(invalidateEndpointFamily(queryClient, "/api/inventory"));
  if (includeInvoices) tasks.push(invalidateEndpointFamily(queryClient, "/api/invoices"));
  if (includeReports) tasks.push(invalidateEndpointFamily(queryClient, "/api/reports"));
  if (includeAnalytics) tasks.push(invalidateEndpointFamily(queryClient, "/api/analytics"));
  await Promise.all(tasks);
}

export function invalidateAfterPosCheckout(queryClient: QueryClient) {
  return Promise.all([
    invalidateOperationalData(queryClient, {
      includeOrders: true,
      includeProducts: true,
      includeInventory: true,
      includeInvoices: false,
      includeReports: true,
      includeAnalytics: true,
    }),
    // The first sale of the day opens a till shift server-side; without this
    // the POS page's cached /api/shifts/current never learns about it (queries
    // default to staleTime: Infinity), so "Shift so far" / "Close shift" only
    // show up after a manual reload.
    invalidateEndpointFamily(queryClient, "/api/shifts"),
  ]);
}

export function invalidateAfterOrderStatusChange(queryClient: QueryClient) {
  return Promise.all([
    invalidateEndpointFamily(queryClient, "/api/orders"),
    invalidateEndpointFamily(queryClient, "/api/invoices"),
    invalidateEndpointFamily(queryClient, "/api/reports"),
  ]);
}

export function invalidateAfterOrderMutation(queryClient: QueryClient) {
  return invalidateOperationalData(queryClient, {
    includeOrders: true,
    includeProducts: true,
    includeInventory: true,
    includeInvoices: true,
    includeReports: true,
    includeAnalytics: true,
  });
}

export function invalidateAfterInventoryAdjustment(queryClient: QueryClient) {
  return invalidateOperationalData(queryClient, {
    includeOrders: false,
    includeProducts: true,
    includeInventory: true,
    includeInvoices: false,
    includeReports: true,
    includeAnalytics: false,
  });
}

/**
 * Refresh after any step of the replenishment → purchase draft → receiving
 * flow. The stages read each other's state — recommendations net off open
 * drafts, drafts track received quantity — so a mutation in one stage makes the
 * others stale. `includeStock` additionally refreshes stock-derived views,
 * which only a completed goods receipt changes.
 */
export function invalidatePurchasingPipeline(
  queryClient: QueryClient,
  options?: { includeStock?: boolean },
) {
  const tasks = [
    invalidateEndpointFamily(queryClient, "/api/replenishment/recommendations"),
    invalidateEndpointFamily(queryClient, "/api/purchase-drafts"),
    invalidateEndpointFamily(queryClient, "/api/goods-receipts"),
    invalidateEndpointFamily(queryClient, "/api/inventory/transfers"),
  ];

  if (options?.includeStock) {
    tasks.push(invalidateEndpointFamily(queryClient, "/api/products"));
    tasks.push(invalidateEndpointFamily(queryClient, "/api/inventory"));
  }

  return Promise.all(tasks);
}

/**
 * After a real `POST /api/orders/:id/transition` write (Phase N, N4a).
 *
 * The brief is explicit about this one (§ API, `GET /api/orders/board`):
 * "board taps apply the returned row and invalidate `['/api/control-centre']`
 * only." That is narrower than every other helper in this file on purpose —
 * `runOrderTransition` already returns the fresh `BoardOrder` inside one
 * locked transaction, so there is nothing stale left to refetch on the board
 * itself, and `opsBus` is about to push the identical row to every OTHER open
 * tablet over SSE (`server/services/opsBus.ts`, N3a) within the same
 * request's commit. Invalidating `/api/orders` or `/api/reports` here as
 * `invalidateAfterOrderStatusChange` does for the v0 PATCH path would only
 * cost the tapping tablet a redundant round trip for data it already has the
 * newest copy of. The Control Centre's `lateNow` / `dueSoonNow` tiles (N7)
 * are the one thing this response does not carry, so that family alone is
 * invalidated.
 */
export function invalidateAfterOpsTransition(queryClient: QueryClient, order: BoardOrder) {
  queryClient.setQueryData<{ orders: BoardOrder[] } & Record<string, unknown>>(
    OPS_BOARD_QUERY_KEY as unknown as QueryKey,
    (current) =>
      current
        ? {
            ...current,
            orders: current.orders.some((row) => row.id === order.id)
              ? current.orders.map((row) => (row.id === order.id ? order : row))
              : [...current.orders, order],
          }
        : current,
  );
  return invalidateEndpointFamily(queryClient, "/api/control-centre");
}

export function invalidateAfterCatalogMutation(queryClient: QueryClient) {
  return invalidateOperationalData(queryClient, {
    includeOrders: false,
    includeProducts: true,
    includeInventory: true,
    includeInvoices: false,
    includeReports: true,
    includeAnalytics: false,
  });
}
