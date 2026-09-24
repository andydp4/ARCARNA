import { roleRank, type Role } from "./rbac";
import { isMaskedValue, maskEmail, maskPhone } from "./customerView";

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
// Minimum prices (v1.2 Phase 2, PRC-01): managers and admins edit them. The
// product write routes are already manager and above; the service checks
// this again so a new path that saves a product cannot skip it.
// ---------------------------------------------------------------------------

export const MIN_PRICE_MIN_ROLE: Role = "MANAGER";

export function canEditMinPrice(role: string | null | undefined): boolean {
  return isAtLeast(role, MIN_PRICE_MIN_ROLE);
}

/**
 * "Would have flagged" — underpriced sales recorded silently (PRC-03,
 * CMP-03): admins and the owner only, so a manager never reviews (or can
 * see the absence of) flags about their own prices.
 */
export const WOULD_HAVE_FLAGGED_MIN_ROLE: Role = "ADMIN";

export function canSeeWouldHaveFlagged(role: string | null | undefined): boolean {
  return isAtLeast(role, WOULD_HAVE_FLAGGED_MIN_ROLE);
}

/** "Price guard at the till" is switched on and off by admins only (v1.2 Phase 4, owner decision). */
export const PRICE_GUARD_SWITCH_MIN_ROLE: Role = "ADMIN";

/** Card (link): a cashier takes a sale's card payment by Stripe link (v1.2 Stripe links). */
export const CARD_LINK_MIN_ROLE: Role = "CASHIER";

/** Whether Stripe is connected, the webhook URL and the .env lines: managers and above. */
export const STRIPE_SETTINGS_MIN_ROLE: Role = "MANAGER";

// ---------------------------------------------------------------------------
// Customer contact details (owner decision Q13a: admin and above). Staff below
// that still find and serve customers: they get flags saying whether there is
// an email or phone on file (the receipt worker reads the address itself), the
// phone's last four digits and the masked phone and email (Q7: ••4821,
// j•••@gmail.com) to tell two customers with one name apart.
//
// One customer view, three versions (v1.2 Phase 5, PRV-03):
//   Cashier  name, tier, points, the hints and masks.
//   Manager  the cashier's view plus the past-order summary. Full contact only
//            inside a 24-hour grant (Phase 6), so for now masks only.
//   Admin    everything.
// The server's queries select only the columns the version needs
// (server/services/customerView.ts); customerForRole is the last line, applied
// to whatever a route is about to send.
// ---------------------------------------------------------------------------

export const CONTACT_MIN_ROLE: Role = "ADMIN";

export function canSeeContactDetails(role: string | null | undefined): boolean {
  return isAtLeast(role, CONTACT_MIN_ROLE);
}

/** Managers see the past-order summary (PRV-03); cashiers do not. */
export const ORDER_SUMMARY_MIN_ROLE: Role = "MANAGER";

export function canSeeCustomerOrderSummary(role: string | null | undefined): boolean {
  return isAtLeast(role, ORDER_SUMMARY_MIN_ROLE);
}

/**
 * Every spelling a contact field travels under: the camelCase row, the
 * snake_case row from apps/server's schema, and the formatted phone (it IS
 * the phone). `scripts/audit-contact-fields.mjs` reads the same idea from the
 * source side.
 */
export const CONTACT_FIELDS = ["phone", "email", "address", "phoneE164", "phone_e164"] as const;

/** Customer fields that are the past-order summary or back-office bookkeeping: manager and above. */
export const CUSTOMER_MANAGER_FIELDS = [
  "totalSpent",
  "total_spent",
  "orderCount",
  "lastOrderAt",
  "clv",
  "rfmScore",
  "createdByUserId",
  "created_by_user_id",
  "manualOverrideProtected",
  "manual_override_protected",
] as const;

/** Admin only: the merge flag points at another person's record. */
export const CUSTOMER_ADMIN_FIELDS = ["possibleDuplicateOf", "possible_duplicate_of"] as const;

export type CustomerContactHints = {
  hasEmail: boolean;
  hasPhone: boolean;
  phoneLast4: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
};

/** The hints for one phone and email, computed from values that are then thrown away. */
export function contactHints(phone: unknown, email: unknown): CustomerContactHints {
  const p = typeof phone === "string" ? phone : "";
  const e = typeof email === "string" ? email : "";
  const digits = p.replace(/\D/g, "");
  return {
    hasEmail: e.trim() !== "",
    hasPhone: digits !== "",
    phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
    phoneMasked: maskPhone(p),
    emailMasked: maskEmail(e),
  };
}

export function customerForRole<T extends object>(
  customer: T,
  role: string | null | undefined,
): T | (Omit<T, (typeof CONTACT_FIELDS)[number]> & CustomerContactHints) {
  if (canSeeContactDetails(role)) return customer;
  const out: Record<string, unknown> = { ...(customer as Record<string, unknown>) };
  // A row from the view already carries the hints (computed in SQL, so the
  // contact columns were never read); keep them rather than blank them.
  const hints =
    "phone" in out || "email" in out
      ? contactHints(out.phone, out.email)
      : {
          hasEmail: out.hasEmail === true,
          hasPhone: out.hasPhone === true,
          phoneLast4: typeof out.phoneLast4 === "string" ? out.phoneLast4 : null,
          phoneMasked: typeof out.phoneMasked === "string" ? out.phoneMasked : null,
          emailMasked: typeof out.emailMasked === "string" ? out.emailMasked : null,
        };
  for (const field of CONTACT_FIELDS) delete out[field];
  for (const field of CUSTOMER_ADMIN_FIELDS) delete out[field];
  if (!canSeeCustomerOrderSummary(role)) {
    for (const field of CUSTOMER_MANAGER_FIELDS) delete out[field];
  }
  Object.assign(out, hints);
  return out as Omit<T, (typeof CONTACT_FIELDS)[number]> & CustomerContactHints;
}

// ---------------------------------------------------------------------------
// Edit without reading (PRV-08). Each role edits its own set of fields; points
// and total spent are never typed in by anyone (they come from sales and the
// loyalty ledger); a masked value is never saved; and below admin a blank does
// not wipe what the person could not see. The phone below admin is changed
// only through the manager's write-only "Replace number", which is logged.
// ---------------------------------------------------------------------------

export const CUSTOMER_EDIT_FIELDS: Readonly<Record<"CASHIER" | "MANAGER" | "ADMIN", readonly string[]>> = {
  // A cashier creates a walk-in customer at the till; they never edit one.
  CASHIER: ["name", "phone", "email", "address", "receiptEmailOptIn", "source"],
  MANAGER: ["name", "email", "address", "category", "receiptEmailOptIn", "source"],
  ADMIN: ["name", "phone", "email", "address", "category", "receiptEmailOptIn", "source"],
};

export function customerEditFieldsFor(role: string | null | undefined): readonly string[] {
  if (canSeeContactDetails(role)) return CUSTOMER_EDIT_FIELDS.ADMIN;
  if (isAtLeast(role, "MANAGER")) return CUSTOMER_EDIT_FIELDS.MANAGER;
  if (isAtLeast(role, "CASHIER")) return CUSTOMER_EDIT_FIELDS.CASHIER;
  return [];
}

/**
 * A customer create or edit, cut down to what `role` may write. Unknown
 * fields, points, total spent, org and ids are dropped; so is any masked
 * value (it came back from a mask, not from a person); and below admin a
 * blank contact field is dropped rather than saved over what is there.
 */
export function customerEditForRole<T extends Record<string, unknown>>(
  body: T,
  role: string | null | undefined,
): Partial<T> {
  const allowed = new Set(customerEditFieldsFor(role));
  const seesContact = canSeeContactDetails(role);
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(body)) {
    if (!allowed.has(field)) continue;
    if (isMaskedValue(value)) continue;
    const isContact = (CONTACT_FIELDS as readonly string[]).includes(field);
    if (isContact && !seesContact && (value === null || value === undefined || (typeof value === "string" && value.trim() === ""))) {
      continue;
    }
    if (field === "receiptEmailOptIn" && typeof value !== "boolean") continue;
    out[field] = value;
  }
  return out as Partial<T>;
}

/** The manager's write-only "Replace number" (PRV-08): managers and above, logged. */
export const REPLACE_PHONE_MIN_ROLE: Role = "MANAGER";

/**
 * The customers:read_contact API permission (PRV-03): an API key without it
 * gets the same masked view a manager gets. `*` keys have every permission.
 */
export const API_READ_CONTACT_SCOPE = "customers:read_contact";

export function apiKeyCanReadContact(scopes: readonly string[] | null | undefined): boolean {
  return !!scopes && (scopes.includes(API_READ_CONTACT_SCOPE) || scopes.includes("*"));
}

// ---------------------------------------------------------------------------
// Order history (owner decision Q10a, CMP-06). A cashier's history is the
// current trading day plus the orders they keyed in or completed in the last
// seven days; managers and above see all of it. The palette searches on the
// server within the same bound, so no device is pre-loaded with every order.
// ---------------------------------------------------------------------------

export const ORDER_HISTORY_FULL_MIN_ROLE: Role = "MANAGER";
export const CASHIER_ORDER_HISTORY_DAYS = 7;

export function seesFullOrderHistory(role: string | null | undefined): boolean {
  return isAtLeast(role, ORDER_HISTORY_FULL_MIN_ROLE);
}

// ---------------------------------------------------------------------------
// Delivery address and the driver's call (owner decision Q8a, PRV-04/05). The
// address is on the order: every member of staff sees it while the delivery is
// live, managers and above afterwards too. The phone is revealed only to the
// person the order is assigned to, once it is out for delivery and until it is
// completed; admins always. Every reveal is logged and never cached.
// Managers get the phone inside a Phase 6 grant, not before.
// ---------------------------------------------------------------------------

export const DELIVERY_ADDRESS_AFTER_MIN_ROLE: Role = "MANAGER";

export type DeliveryOrderState = {
  fulfilmentMethod: string | null | undefined;
  status: string | null | undefined;
};

export function canSeeDeliveryAddress(role: string | null | undefined, order: DeliveryOrderState): boolean {
  if (!isAtLeast(role, "CASHIER")) return false;
  if (order.status !== "completed") return true;
  return isAtLeast(role, DELIVERY_ADDRESS_AFTER_MIN_ROLE);
}

export type DriverCallState = DeliveryOrderState & {
  assignedUserId: string | null | undefined;
  outForDeliveryAt: Date | string | null | undefined;
};

export type DriverCallVerdict = { ok: true; via: "admin" | "assigned-driver" } | { ok: false; reason: string };

export function driverCallVerdict(
  role: string | null | undefined,
  userId: string | null | undefined,
  order: DriverCallState,
): DriverCallVerdict {
  if (canSeeContactDetails(role)) return { ok: true, via: "admin" };
  if (!isAtLeast(role, "CASHIER") || !userId) return { ok: false, reason: "Staff only." };
  if (order.fulfilmentMethod !== "delivery") return { ok: false, reason: "Only a delivery has a driver's call." };
  if (order.assignedUserId !== userId) return { ok: false, reason: "Only the person delivering this order can call the customer." };
  if (!order.outForDeliveryAt) return { ok: false, reason: "The number is shown once the order is out for delivery." };
  if (order.status === "completed") return { ok: false, reason: "This delivery is finished." };
  return { ok: true, via: "assigned-driver" };
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
const STOCK_LEVELS =
  "Stock levels is every staff member's read-only count, built from an allow-list with no cost field (v1.2 Phase 3); the Canary check proves no cost reaches a cashier.";
const TRUTHS_LAYOUT =
  "Truths at a glance is Truths: manager and above read it, with widgets above their role removed; only admins change the org's one layout, and every save is logged (v1.2 Phase 3).";
const PRICE_GUARD =
  "The price guard switch is admin only and logged; the till lists managers by name only for \"Manager agreed\"; only the manager named answers it (v1.2 Phase 4).";
const NEEDS_A_LOOK =
  "Needs a look and Price overrides Evidence are manager and above, and each viewer gets only exceptions about people they outrank; the rules are admin only and logged (v1.2 Phase 4, CMP-02, CMP-04, PRC-09).";
const BULK_MIN =
  "Bulk \"Set minimum price\" is managers and admins, previewed first and written to price history; a manager's change tells the owner (v1.2 Phase 4, PRC-05).";
const CUSTOMER_VIEW =
  "One customer view per role: contact details are admin only, managers see masks and the order summary, cashiers name, tier and points (PRV-03, Q7, Q13a).";
const PHONE_LOOKUP =
  "Finding a customer by phone is exact-match on the formatted number, at most three, masked, and rate-limited per person (PRV-06).";
const DELIVERY =
  "The delivery address is on the order; the driver's call reveals the phone to the assigned driver only while out for delivery, admins always, every reveal logged (Q8a, PRV-04/05).";
const ORDER_HISTORY =
  "A cashier's order history is today plus their own last seven days; the palette searches on the server inside that bound (Q10a, CMP-06).";
const CARD_LINK =
  "Card (link): any staff member can make, cancel or send a Stripe link for a sale and switch it to another tender; the customer's number never reaches the till. Stripe settings are manager and above and never show a key (v1.2 Stripe links).";
const NEEDS_ATTENTION =
  "Refused till sales are dealt with by a manager; a discard or a sign-out with sales unsent is logged (v1.2 Phase 1A).";

export const ACCESS_POLICY: readonly RouteRule[] = [
  // Products: writes are manager and above.
  { method: "POST", path: "/api/products", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "PUT", path: "/api/products/:id", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "DELETE", path: "/api/products/:id", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "PATCH", path: "/api/products/:id/aliases", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "PATCH", path: "/api/products/:id/website", minRole: "MANAGER", reason: PRODUCT_WRITE },
  { method: "POST", path: "/api/products/import", minRole: "MANAGER", reason: PRODUCT_WRITE },
  {
    method: "GET",
    path: "/api/products/:id/price-history",
    minRole: "MANAGER",
    reason: "Price history carries cost changes; minimums are managed by managers and admins (PRC-07, Q6).",
  },
  {
    method: "GET",
    path: "/api/price-exceptions/would-have-flagged",
    minRole: "ADMIN",
    reason: "Would have flagged is admins and the owner only: managers do not review flags about themselves (PRC-03, CMP-03).",
  },

  // Price guard at the till (v1.2 Phase 4, PRC-02, CMP-05).
  { method: "PUT", path: "/api/settings/price-guard", minRole: "ADMIN", reason: PRICE_GUARD },
  { method: "GET", path: "/api/price-guard/managers", minRole: "CASHIER", reason: PRICE_GUARD },
  { method: "POST", path: "/api/price-guard/checks/:id/answer", minRole: "MANAGER", reason: PRICE_GUARD },
  { method: "GET", path: "/api/needs-a-look", minRole: "MANAGER", reason: NEEDS_A_LOOK },
  { method: "POST", path: "/api/needs-a-look/:id/review", minRole: "MANAGER", reason: NEEDS_A_LOOK },
  { method: "GET", path: "/api/evidence/price-overrides", minRole: "MANAGER", reason: NEEDS_A_LOOK },
  { method: "GET", path: "/api/settings/review-rules", minRole: "MANAGER", reason: NEEDS_A_LOOK },
  { method: "PUT", path: "/api/settings/review-rules", minRole: "ADMIN", reason: NEEDS_A_LOOK },
  { method: "POST", path: "/api/products/min-price/preview", minRole: "MANAGER", reason: BULK_MIN },
  { method: "POST", path: "/api/products/min-price/apply", minRole: "MANAGER", reason: BULK_MIN },

  // Stock Centre › Stock levels: open to all staff, never a cost.
  { method: "GET", path: "/api/stock-levels", minRole: "CASHIER", reason: STOCK_LEVELS },

  // Suppliers and supplier-product mappings (Stock Centre › Suppliers). The
  // mappings now carry the product-card cost beside the supplier price.
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
  { method: "GET", path: "/api/truths/layout", minRole: "MANAGER", reason: TRUTHS_LAYOUT },
  { method: "PUT", path: "/api/truths/layout", minRole: "ADMIN", reason: TRUTHS_LAYOUT },

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

  // Customer view (v1.2 Phase 5).
  { method: "POST", path: "/api/customers/lookup-phone", minRole: "CASHIER", reason: PHONE_LOOKUP },
  { method: "GET", path: "/api/customers/possible-duplicates", minRole: "ADMIN", reason: CUSTOMER_VIEW },
  { method: "POST", path: "/api/customers/:id/replace-phone", minRole: "MANAGER", reason: CUSTOMER_VIEW },
  { method: "POST", path: "/api/customers/:id/saved-address", minRole: "CASHIER", reason: DELIVERY },
  { method: "POST", path: "/api/orders/board/phone-search", minRole: "CASHIER", reason: PHONE_LOOKUP },
  { method: "POST", path: "/api/orders/:id/customer-phone", minRole: "CASHIER", reason: DELIVERY },
  { method: "PATCH", path: "/api/orders/:id/delivery", minRole: "CASHIER", reason: DELIVERY },
  { method: "POST", path: "/api/orders/search", minRole: "CASHIER", reason: ORDER_HISTORY },
  { method: "GET", path: "/api/whatsapp/conversations", minRole: "CASHIER", reason: CUSTOMER_VIEW },
  { method: "GET", path: "/api/whatsapp/conversations/:id", minRole: "CASHIER", reason: CUSTOMER_VIEW },

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

  // Card (link) at the till (v1.2 Stripe links). The webhook itself is public
  // and signed by Stripe, so it has no role row.
  { method: "GET", path: "/api/card-links/till", minRole: CARD_LINK_MIN_ROLE, reason: CARD_LINK },
  { method: "POST", path: "/api/card-links/:orderId", minRole: CARD_LINK_MIN_ROLE, reason: CARD_LINK },
  { method: "GET", path: "/api/card-links/:orderId", minRole: CARD_LINK_MIN_ROLE, reason: CARD_LINK },
  { method: "POST", path: "/api/card-links/:orderId/cancel", minRole: CARD_LINK_MIN_ROLE, reason: CARD_LINK },
  { method: "POST", path: "/api/card-links/:orderId/retender", minRole: CARD_LINK_MIN_ROLE, reason: CARD_LINK },
  { method: "POST", path: "/api/card-links/:orderId/whatsapp", minRole: CARD_LINK_MIN_ROLE, reason: CARD_LINK },
  { method: "GET", path: "/api/settings/stripe", minRole: STRIPE_SETTINGS_MIN_ROLE, reason: CARD_LINK },

  // Needs attention: refused till sales.
  { method: "GET", path: "/api/sale-issues", minRole: "MANAGER", reason: NEEDS_ATTENTION },
  { method: "POST", path: "/api/sale-issues/:id/discard", minRole: "MANAGER", reason: NEEDS_ATTENTION },
  { method: "POST", path: "/api/sale-issues/sign-out-override", minRole: "MANAGER", reason: NEEDS_ATTENTION },
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
  /** The customer's saved address: admin only (v1.2 Phase 5). */
  address: "1 Canary Lane",
} as const;
