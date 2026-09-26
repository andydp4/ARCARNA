import type { Request, Response, NextFunction } from "express";

/**
 * Routes whose path ids are UUID columns (v1.2.1 SEC-500-NONUUID).
 *
 * A malformed id used to reach Postgres, fail with "invalid input syntax for
 * type uuid", come back as a 500 and write the full SQL with its bound values
 * to the error log. Each template here was seen doing exactly that; a
 * non-UUID in any `:param` slot is answered 404 before the handler runs.
 * Method-agnostic: every verb on these paths keys on the same column.
 */
export const UUID_PARAM_ROUTES: readonly string[] = [
  "/api/api-keys/:id/revoke",
  "/api/analytics/promotions/:id/lift",
  "/api/products/:id",
  "/api/products/:id/price-history",
  "/api/rules/:id",
  "/api/rules/:id/executions",
  "/api/scheduled-reports/:id",
  "/api/scheduled-reports/:id/runs",
  "/api/inventory/transfers/:id",
  "/api/suppliers/:id",
  "/api/product-suppliers/:id",
  "/api/purchase-drafts/:id",
  "/api/purchase-drafts/:id/export",
  "/api/purchase-drafts/:id/items/:itemId",
  "/api/purchase-drafts/:id/receiving",
  "/api/goods-receipts/:id",
  "/api/goods-receipts/:id/complete",
  "/api/goods-receipts/:id/void",
  "/api/customers/:id",
  "/api/customers/:id/intelligence",
  "/api/customers/:id/saved-address",
  "/api/orders/:id",
  "/api/orders/:id/receipt.pdf",
  "/api/orders/:id/customer-phone",
  "/api/orders/:id/delivery",
  "/api/orders/:id/edit-preview",
  "/api/orders/:id/refunds",
  "/api/orders/:id/operations",
  "/api/operations/alerts/:id/ack",
  "/api/shifts/:id/report",
  "/api/cashiers/:id",
  "/api/cashier-shifts/:id/end",
  "/api/cashier-shifts/:id/summary",
  "/api/cashier-shifts/current/:cashierId",
  "/api/saved-views/:id",
  "/api/whatsapp/conversations/:id",
  "/api/whatsapp/conversations/:id/read",
  "/api/whatsapp/conversations/:id/create-customer",
  "/api/whatsapp/conversations/:id/intents",
  "/api/whatsapp/conversations/:id/create-draft-order",
  "/api/whatsapp/conversations/:id/attach-order",
  "/api/inventory/:productId",
  "/api/locations/:id",
  "/api/locations/:id/set-default",
  "/api/locations/:id/stock",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ROUTE_SET = new Set(UUID_PARAM_ROUTES);

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID.test(value);
}

/** The `:param` names used in UUID_PARAM_ROUTES. */
export const UUID_PARAM_NAMES: readonly string[] = [
  ...new Set(UUID_PARAM_ROUTES.flatMap((t) => t.split("/").filter((s) => s.startsWith(":")).map((s) => s.slice(1)))),
];

/**
 * Registers `app.param` checks for the templates above. A param callback runs
 * only once a route has matched, so a literal sibling (GET /api/orders/board)
 * is never affected, and `req.route.path` limits it to the listed templates.
 */
export function registerUuidParamGuards(app: {
  param: (name: string, fn: (req: Request, res: Response, next: NextFunction, value: unknown) => void) => unknown;
}): void {
  for (const name of UUID_PARAM_NAMES) {
    app.param(name, (req, res, next, value) => {
      const routePath = (req as Request & { route?: { path?: unknown } }).route?.path;
      if (typeof routePath === "string" && UUID_ROUTE_SET.has(routePath) && !isUuid(value)) {
        res.status(404).json({ message: "Not found" });
        return;
      }
      next();
    });
  }
}
