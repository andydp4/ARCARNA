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
// Customer contact details (owner decision Q13a: admin and above). Staff below
// that still find and serve customers: they get a flag saying whether there is
// an email or phone on file (the receipt worker reads the address itself) and
// the phone's last four digits to tell two customers with one name apart.
// ---------------------------------------------------------------------------

export const CONTACT_MIN_ROLE: Role = "ADMIN";

export function canSeeContactDetails(role: string | null | undefined): boolean {
  return isAtLeast(role, CONTACT_MIN_ROLE);
}

export const CONTACT_FIELDS = ["phone", "email", "address"] as const;

export type CustomerContactHints = { hasEmail: boolean; hasPhone: boolean; phoneLast4: string | null };

export function customerForRole<T extends object>(
  customer: T,
  role: string | null | undefined,
): T | (Omit<T, (typeof CONTACT_FIELDS)[number]> & CustomerContactHints) {
  if (canSeeContactDetails(role)) return customer;
  const out: Record<string, unknown> = { ...(customer as Record<string, unknown>) };
  const phone = typeof out.phone === "string" ? out.phone : "";
  const email = typeof out.email === "string" ? out.email : "";
  for (const field of CONTACT_FIELDS) delete out[field];
  const digits = phone.replace(/\D/g, "");
  out.hasEmail = email.trim() !== "";
  out.hasPhone = digits !== "";
  out.phoneLast4 = digits.length >= 4 ? digits.slice(-4) : null;
  return out as Omit<T, (typeof CONTACT_FIELDS)[number]> & CustomerContactHints;
}

/**
 * A customer edit from someone who cannot see contact details. They cannot see
 * what is there, so a blank (the edit form's empty field) must not wipe it; a
 * value they type is still saved.
 */
export function customerEditForRole<T extends Record<string, unknown>>(body: T, role: string | null | undefined): T {
  if (canSeeContactDetails(role)) return body;
  const out: Record<string, unknown> = { ...body };
  for (const field of CONTACT_FIELDS) {
    const v = out[field];
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) delete out[field];
  }
  return out as T;
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

// ---------------------------------------------------------------------------
// Evidence and Truths (owner decision Q12): managers run all Evidence except
// staff pay and managers' performance; only admins export, and every export
// is logged.
// ---------------------------------------------------------------------------

export const EVIDENCE_MIN_ROLE: Role = "MANAGER";
export const EXPORT_MIN_ROLE: Role = "ADMIN";

/**
 * Evidence refs (GET /api/reports/:ref) that sit above the manager line.
 * ARC-T2-002 rates every member of staff, managers included, so it is
 * managers' performance (Q12). It is also hidden in the app while it is
 * rebuilt (STF-FN1), because on current data it shows everyone at zero.
 */
export const EVIDENCE_REF_MIN_ROLE: Readonly<Record<string, Role>> = {
  "ARC-T2-002": "ADMIN",
};

export function evidenceRefMinRole(ref: string): Role {
  return EVIDENCE_REF_MIN_ROLE[ref.toUpperCase()] ?? EVIDENCE_MIN_ROLE;
}

const PRODUCT_WRITE = "Product create, edit, delete and aliases change prices and cost (FIX-02).";
const PURCHASING = "Supplier, purchasing and transfer records carry cost prices (FIX-09, Q6).";
const EVIDENCE = "Evidence and Truths are manager and above (FIX-03, Q12).";
const EXPORT = "Exports are admin only and every one is logged (Q12).";
const PROFIT = "Profit and expense Evidence is whole-business money: admin only (FIX-03).";
const EXPENSE_LIST = "Expense lists are the money the totals are built from, and a personal-use expense is stock at cost: manager and above (Q6).";
const CUSTOMER_INTEL = "Customer lifetime value and order history are manager and above (PRV-02).";
const PAY = "Staff pay is manager and above; a manager sees cashiers' rows only (Q12, Q13a).";
const STAFF_LIST = "The staff list is manager and above; PINs never leave the server, rates are admin only (STF-FN4).";
const SCHEDULED = "Scheduled Evidence is Evidence: manager and above (STF-FN4, Q12).";
const CREDIT = "The Credit List and Invoices are manager and above, menu and server (Q11).";
const GIFT_ISSUE = "Issuing a gift card hands out money: managers only, with a reason (FIX-13).";

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

  // Evidence (reports) and Truths (analytics).
  { method: "GET", path: "/api/reports", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/reports/:ref", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/evidence/staff", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/analytics/top-customers", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/analytics/daily-revenue", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/analytics/monthly-summary", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/analytics/rfm", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/analytics/rfm/customers", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/analytics/hour-of-day", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/analytics/channels", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/analytics/stock-turn", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/analytics/promotions/:id/lift", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/assistant/summary", minRole: "MANAGER", reason: EVIDENCE },
  { method: "GET", path: "/api/assistant/alerts", minRole: "MANAGER", reason: EVIDENCE },

  // Profit and expense Evidence.
  { method: "GET", path: "/api/profit-analysis", minRole: "ADMIN", reason: PROFIT },
  { method: "GET", path: "/api/expense-report", minRole: "ADMIN", reason: PROFIT },
  { method: "GET", path: "/api/expense-analytics", minRole: "ADMIN", reason: PROFIT },
  { method: "GET", path: "/api/overhead-expenses", minRole: "MANAGER", reason: EXPENSE_LIST },
  { method: "GET", path: "/api/orders/:orderId/expenses", minRole: "MANAGER", reason: EXPENSE_LIST },

  // Exports.
  { method: "GET", path: "/api/reports/export", minRole: "ADMIN", reason: EXPORT },
  { method: "GET", path: "/api/analytics/rfm/export", minRole: "ADMIN", reason: EXPORT },
  { method: "GET", path: "/api/cashier-analytics/export.csv", minRole: "ADMIN", reason: EXPORT },
  { method: "POST", path: "/api/evidence/exports", minRole: "ADMIN", reason: EXPORT },

  // Customer intelligence.
  { method: "GET", path: "/api/customers/intelligence", minRole: "MANAGER", reason: CUSTOMER_INTEL },
  { method: "GET", path: "/api/customers/:id/intelligence", minRole: "MANAGER", reason: CUSTOMER_INTEL },

  // Payroll (the per-person table; rows are filtered by role in the handler).
  { method: "GET", path: "/api/cashier-analytics", minRole: "MANAGER", reason: PAY },

  // Staff and pay. Commission rows and payments are filtered per row in the
  // handler (canSeePayRow); shift sheets per sheet (maySeeShiftSheet).
  { method: "GET", path: "/api/cashiers", minRole: "MANAGER", reason: STAFF_LIST },
  { method: "GET", path: "/api/cashier-commission", minRole: "MANAGER", reason: PAY },
  { method: "GET", path: "/api/cashier-commission/payments", minRole: "MANAGER", reason: PAY },
  { method: "POST", path: "/api/cashier-commission/payments", minRole: "MANAGER", reason: PAY },
  { method: "GET", path: "/api/scheduled-reports", minRole: "MANAGER", reason: SCHEDULED },
  { method: "GET", path: "/api/scheduled-reports/:id/runs", minRole: "MANAGER", reason: SCHEDULED },

  // Credit (tick) and invoices.
  { method: "GET", path: "/api/tick-customers", minRole: "MANAGER", reason: CREDIT },
  { method: "DELETE", path: "/api/tick-customers/:id", minRole: "MANAGER", reason: CREDIT },
  { method: "POST", path: "/api/tick-customers/:id/payments", minRole: "MANAGER", reason: CREDIT },
  { method: "POST", path: "/api/tick-customers/:id/mark-paid", minRole: "MANAGER", reason: CREDIT },
  { method: "GET", path: "/api/credit/outstanding", minRole: "MANAGER", reason: CREDIT },
  { method: "POST", path: "/api/credit/:orderId/payments", minRole: "MANAGER", reason: CREDIT },
  { method: "POST", path: "/api/credit/:orderId/write-off", minRole: "MANAGER", reason: CREDIT },
  { method: "POST", path: "/api/credit/:orderId/void", minRole: "MANAGER", reason: CREDIT },
  { method: "GET", path: "/api/invoices", minRole: "MANAGER", reason: CREDIT },
  { method: "GET", path: "/api/invoices/:id/pdf", minRole: "MANAGER", reason: CREDIT },

  // Gift cards.
  { method: "POST", path: "/api/gift-cards", minRole: "MANAGER", reason: GIFT_ISSUE },
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
