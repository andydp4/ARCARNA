import { roleRank, type Role } from "./rbac";

/**
 * Who may reach what, in one place (v1.2 Phase 0B, CMP-16).
 *
 * The menus hide things, but a hidden menu entry is not a lock: the till's
 * own session can call any API route directly. So every rule here is enforced
 * on the server with `requireRole(...rolesAtLeast(minRole))`, and
 * `server/__tests__/roleMatrix.test.ts` walks this table as every role to
 * prove the server answers the way the table says. Add a row here when you
 * lock a route; the test picks it up without further wiring.
 *
 * RBAC.md is the plain-English version of this table.
 */

/** Staff roles in rank order. CUSTOMER (shop accounts) never reaches staff routes. */
export const STAFF_ROLES: readonly Role[] = ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"];

/** Every staff role at or above `min`, for `requireRole(...rolesAtLeast("MANAGER"))`. */
export function rolesAtLeast(min: Role): Role[] {
  return STAFF_ROLES.filter((r) => roleRank(r) >= roleRank(min));
}

export function isAtLeast(role: string | null | undefined, min: Role): boolean {
  if (!role || !(STAFF_ROLES as readonly string[]).includes(role)) return false;
  return roleRank(role as Role) >= roleRank(min);
}

// ---------------------------------------------------------------------------
// Cost prices (owner decision Q6: managers and admins, never cashiers — not
// even in API responses the till fetches and ignores).
// ---------------------------------------------------------------------------

export const COST_MIN_ROLE: Role = "MANAGER";

export function canSeeCost(role: string | null | undefined): boolean {
  return isAtLeast(role, COST_MIN_ROLE);
}

/**
 * Field names that carry what the business paid for stock. Covers the
 * products row (`costPrice`), supplier mappings, purchase lines and the
 * stock-valuation shapes, so a product-like object from any of those reads is
 * stripped the same way.
 */
export const COST_FIELDS = [
  "costPrice",
  "cost_price",
  "unitCost",
  "estimatedCost",
  "stockCost",
  "stockValue",
  "margin",
  "marginPercent",
] as const;

/**
 * A product (or inventory row) as the given role may see it. For a cashier
 * the cost fields are removed from the object entirely — not nulled, so a
 * client cannot tell "unknown cost" from "hidden cost" and nothing downstream
 * renders £0.00 as if it were the real figure.
 */
export function productForRole<T extends object>(product: T, role: string | null | undefined): T {
  if (canSeeCost(role)) return product;
  const out: Record<string, unknown> = { ...(product as Record<string, unknown>) };
  for (const field of COST_FIELDS) delete out[field];
  return out as T;
}

export function productsForRole<T extends object>(list: readonly T[], role: string | null | undefined): T[] {
  if (canSeeCost(role)) return list as T[];
  return list.map((p) => productForRole(p, role));
}

// ---------------------------------------------------------------------------
// Route table.
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteRule = {
  method: HttpMethod;
  /** Express path as registered, with `:params`. */
  path: string;
  /** Lowest role the server admits. Everything below gets 403. */
  minRole: Role;
  /** Why the line is drawn here, for RBAC.md and whoever reads a failing test. */
  reason: string;
};

const PRODUCT_WRITE = "Product create, edit, delete and aliases change prices and cost (FIX-02).";
const PURCHASING = "Supplier, purchasing and transfer records carry cost prices (FIX-09, Q6).";

export const ACCESS_POLICY: readonly RouteRule[] = [
  // Products: writes are manager and above.
  { method: "POST", path: "/api/products", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "PUT", path: "/api/products/:id", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "DELETE", path: "/api/products/:id", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "PATCH", path: "/api/products/:id/aliases", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "PATCH", path: "/api/products/:id/website", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "POST", path: "/api/products/import", minRole: "MANAGER", reason: PRODUCT_WRITE },

  // Suppliers and supplier-product mappings.
  { method: "GET", path: "/api/suppliers", minRole: "MANAGER", reason: PURCHASING },
  { method: "GET", path: "/api/product-suppliers", minRole: "MANAGER", reason: PURCHASING },

  // Purchase drafts, including the purchase-order PDF sent to the supplier.
  { method: "GET", path: "/api/purchase-drafts", minRole: "MANAGER", reason: PURCHASING },
  { method: "GET", path: "/api/purchase-drafts/:id", minRole: "MANAGER", reason: PURCHASING },
  { method: "GET", path: "/api/purchase-drafts/:id/export", minRole: "MANAGER", reason: PURCHASING },
  { method: "GET", path: "/api/purchase-drafts/:id/receiving", minRole: "MANAGER", reason: PURCHASING },

  // Goods receipts.
  { method: "GET", path: "/api/goods-receipts", minRole: "MANAGER", reason: PURCHASING },
  { method: "GET", path: "/api/goods-receipts/:id", minRole: "MANAGER", reason: PURCHASING },

  // Replenishment and transfers.
  { method: "GET", path: "/api/replenishment/recommendations", minRole: "MANAGER", reason: PURCHASING },
  { method: "GET", path: "/api/inventory/transfers", minRole: "MANAGER", reason: PURCHASING },
  { method: "GET", path: "/api/inventory/transfers/:id", minRole: "MANAGER", reason: PURCHASING },
];

// ---------------------------------------------------------------------------
// Canaries. Seeded by the role-matrix test into a throwaway org; none of
// them may appear anywhere in a response to a cashier.
// ---------------------------------------------------------------------------

export const CANARIES = {
  phone: "07700 900123",
  email: "canary@example.invalid",
  /** £13.37, as stored (numeric(10,2) → "13.37") and as a JSON number. */
  costPrice: "13.37",
} as const;
