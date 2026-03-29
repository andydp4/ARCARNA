import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

function isEndpointFamilyMatch(queryKey: QueryKey, endpoint: string): boolean {
  const [head] = queryKey;
  if (typeof head !== "string") return false;
  return head === endpoint || head.startsWith(`${endpoint}/`);
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
  return invalidateOperationalData(queryClient, {
    includeOrders: true,
    includeProducts: true,
    includeInventory: true,
    includeInvoices: false,
    includeReports: true,
    includeAnalytics: true,
  });
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

export function invalidateAfterInvoiceRegeneration(queryClient: QueryClient) {
  return Promise.all([
    invalidateEndpointFamily(queryClient, "/api/invoices"),
    invalidateEndpointFamily(queryClient, "/api/orders"),
  ]);
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
