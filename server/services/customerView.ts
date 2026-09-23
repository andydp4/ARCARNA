/**
 * The one customer view (v1.2 Phase 5, PRV-03).
 *
 * Every staff read of a customer goes through here. A non-admin query never
 * selects a contact column: the hints and masks (has phone, ••4821,
 * j•••@gmail.com) are computed inside Postgres, so the phone, email and saved
 * address never leave the database for a cashier or a manager. Admins get the
 * whole row. `customerForRole` (shared/accessPolicy.ts) is then applied to
 * whatever the route sends, as a second line.
 *
 * The few places that genuinely need a contact value — the driver's call, "Use
 * saved address", the receipt email, the admin's own reads — are named
 * functions below, each logged by its caller. `scripts/audit-contact-fields.mjs`
 * fails CI when a contact column is read anywhere not on its allow-list, and
 * this file is the first entry on it.
 */
import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { customers, orders } from "@shared/schema";
import {
  canSeeContactDetails,
  canSeeCustomerOrderSummary,
  customerForRole,
} from "@shared/accessPolicy";
import { formatUkPhone, shortName, type CustomerMatch } from "@shared/customerView";

/** Masks, in SQL. The bullet is written out rather than interpolated so the statement caches. */
const phoneDigits = sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g')`;
const emailTrim = sql`btrim(coalesce(${customers.email}, ''))`;

const hintColumns = {
  hasPhone: sql<boolean>`(${phoneDigits} <> '')`.as("has_phone"),
  hasEmail: sql<boolean>`(${emailTrim} <> '')`.as("has_email"),
  phoneLast4: sql<string | null>`case when length(${phoneDigits}) >= 4 then right(${phoneDigits}, 4) end`.as(
    "phone_last4",
  ),
  phoneMasked: sql<string | null>`case
      when length(${phoneDigits}) >= 4 then '••' || right(${phoneDigits}, 4)
      when ${phoneDigits} <> '' then '••'
    end`.as("phone_masked"),
  emailMasked: sql<string | null>`case
      when ${emailTrim} = '' then null
      when position('@' in ${emailTrim}) > 1
        then left(${emailTrim}, 1) || '•••' || substring(${emailTrim} from '@[^@]*$')
      else '•••'
    end`.as("email_masked"),
};

/** The cashier's columns: name, tier, points and the receipt switch. No contact column. */
const cashierColumns = {
  id: customers.id,
  orgId: customers.orgId,
  name: customers.name,
  category: customers.category,
  tierId: customers.tierId,
  loyaltyPoints: customers.loyaltyPoints,
  receiptEmailOptIn: customers.receiptEmailOptIn,
  source: customers.source,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
  ...hintColumns,
};

/**
 * The manager adds the past-order summary and who created the record. The
 * outer table is named in full: drizzle renders a lone column unqualified,
 * which inside the subquery would silently mean the order's own id.
 */
const orderCountSql = sql<number>`(select count(*)::int from ${orders} o where o.customer_id = "customers"."id" and o.org_id = "customers"."org_id")`.as(
  "order_count",
);
const lastOrderAtSql = sql<Date | null>`(select max(o.created_at) from ${orders} o where o.customer_id = "customers"."id" and o.org_id = "customers"."org_id")`.as(
  "last_order_at",
);

const managerColumns = {
  ...cashierColumns,
  totalSpent: customers.totalSpent,
  manualOverrideProtected: customers.manualOverrideProtected,
  createdByUserId: customers.createdByUserId,
  orderCount: orderCountSql,
  lastOrderAt: lastOrderAtSql,
};

const adminColumns = {
  ...managerColumns,
  phone: customers.phone,
  email: customers.email,
  address: customers.address,
  phoneE164: customers.phoneE164,
  possibleDuplicateOf: customers.possibleDuplicateOf,
};

export type CustomerViewTier = "cashier" | "manager" | "admin";

export function customerViewTier(role: string | null | undefined): CustomerViewTier {
  if (canSeeContactDetails(role)) return "admin";
  if (canSeeCustomerOrderSummary(role)) return "manager";
  return "cashier";
}

/** The select list for a role. Exported so the tests can prove no contact column is in it. */
export function customerViewColumns(role: string | null | undefined) {
  const tier = customerViewTier(role);
  return tier === "admin" ? adminColumns : tier === "manager" ? managerColumns : cashierColumns;
}

async function mainDb() {
  return (await import("../db")).db;
}

/** Every customer of the org, as `role` sees them. */
export async function listCustomersForRole(orgId: string, role: string | null | undefined) {
  const db = await mainDb();
  const rows = await db
    .select(customerViewColumns(role) as typeof cashierColumns)
    .from(customers)
    .where(eq(customers.orgId, orgId))
    .orderBy(customers.name);
  return rows.map((row) => customerForRole(row, role));
}

/** One customer, as `role` sees them, or null. */
export async function getCustomerForRole(orgId: string, customerId: string, role: string | null | undefined) {
  const db = await mainDb();
  const [row] = await db
    .select(customerViewColumns(role) as typeof cashierColumns)
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, orgId)))
    .limit(1);
  return row ? customerForRole(row, role) : null;
}


// ---------------------------------------------------------------------------
// Finding a customer by phone (PRV-06): the formatted number, exact match, at
// most three people, and only ever the masked number back.
// ---------------------------------------------------------------------------

export const PHONE_LOOKUP_MAX_RESULTS = 3;

const matchColumns = {
  id: customers.id,
  name: customers.name,
  phoneMasked: sql<string | null>`case when ${customers.phoneE164} is not null then '••' || right(${customers.phoneE164}, 4) end`.as(
    "phone_masked",
  ),
};

function toMatch(row: { id: string; name: string; phoneMasked: string | null }): CustomerMatch {
  return { id: row.id, displayName: shortName(row.name), phoneMasked: row.phoneMasked };
}

/** Up to three customers whose formatted phone is exactly this one. An unreadable number finds nobody. */
export async function findCustomersByPhone(orgId: string, rawPhone: string): Promise<CustomerMatch[]> {
  const formatted = formatUkPhone(rawPhone);
  if (!formatted) return [];
  const db = await mainDb();
  const rows = await db
    .select(matchColumns)
    .from(customers)
    .where(and(eq(customers.orgId, orgId), eq(customers.phoneE164, formatted)))
    .orderBy(desc(customers.updatedAt))
    .limit(PHONE_LOOKUP_MAX_RESULTS);
  return rows.map(toMatch);
}

/**
 * Customers a new record would duplicate: the same formatted phone, or the
 * same email (case-insensitive). What the "Already on the system" prompt shows.
 */
export async function findPossibleDuplicates(
  orgId: string,
  input: { phone?: string | null; email?: string | null },
): Promise<CustomerMatch[]> {
  const formatted = formatUkPhone(input.phone ?? null);
  const email = String(input.email ?? "").trim().toLowerCase();
  const conditions: SQL[] = [];
  if (formatted) conditions.push(eq(customers.phoneE164, formatted));
  if (email) conditions.push(sql`lower(btrim(${customers.email})) = ${email}`);
  if (conditions.length === 0) return [];
  const db = await mainDb();
  const rows = await db
    .select(matchColumns)
    .from(customers)
    .where(and(eq(customers.orgId, orgId), sql`(${sql.join(conditions, sql` or `)})`))
    .orderBy(desc(customers.updatedAt))
    .limit(PHONE_LOOKUP_MAX_RESULTS);
  return rows.map(toMatch);
}

// ---------------------------------------------------------------------------
// Website and shop accounts: the both-match fallback (v1.2 Phase 5).
// ---------------------------------------------------------------------------

export type WebsiteCustomerResolution =
  | { kind: "matched"; customerId: string }
  | { kind: "new"; possibleDuplicateOf: string | null };

/**
 * Who a website order belongs to when no signed-in shop account says so: the
 * one customer whose phone AND email both match. A half-match (one of the two)
 * is a different person as far as we can tell — a shared family phone — so the
 * order gets a new record flagged for an admin to merge.
 */
export async function resolveWebsiteCustomer(
  tx: any,
  orgId: string,
  input: { phone?: string | null; email?: string | null },
): Promise<WebsiteCustomerResolution> {
  const formatted = formatUkPhone(input.phone ?? null);
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!formatted && !email) return { kind: "new", possibleDuplicateOf: null };
  const conditions: SQL[] = [];
  if (formatted) conditions.push(eq(customers.phoneE164, formatted));
  if (email) conditions.push(sql`lower(btrim(${customers.email})) = ${email}`);
  const rows: Array<{ id: string; phoneMatch: boolean; emailMatch: boolean }> = await tx
    .select({
      id: customers.id,
      phoneMatch: formatted ? sql<boolean>`(${customers.phoneE164} = ${formatted})` : sql<boolean>`false`,
      emailMatch: email ? sql<boolean>`(lower(btrim(coalesce(${customers.email}, ''))) = ${email})` : sql<boolean>`false`,
    })
    .from(customers)
    .where(and(eq(customers.orgId, orgId), sql`(${sql.join(conditions, sql` or `)})`))
    .orderBy(desc(customers.updatedAt))
    .limit(20);
  const both = formatted && email ? rows.filter((r) => r.phoneMatch && r.emailMatch) : [];
  if (both.length === 1) return { kind: "matched", customerId: both[0].id };
  return { kind: "new", possibleDuplicateOf: rows[0]?.id ?? null };
}

/** The customer a signed-in shop account is linked to, if any. */
export async function shopAccountCustomerId(tx: any, orgId: string, userId: string): Promise<string | null> {
  const { allowedUsers } = await import("@shared/schema");
  const { or } = await import("drizzle-orm");
  const [row] = await tx
    .select({ customerId: allowedUsers.customerId })
    .from(allowedUsers)
    .innerJoin(customers, eq(customers.id, allowedUsers.customerId))
    .where(
      and(
        eq(allowedUsers.role, "CUSTOMER"),
        eq(customers.orgId, orgId),
        or(eq(allowedUsers.authUserId, userId), eq(allowedUsers.replitUserId, userId)),
      ),
    )
    .limit(1);
  return row?.customerId ?? null;
}

/** Links a shop account with no customer yet to this one. Never re-points an existing link. */
export async function linkShopAccount(tx: any, userId: string, customerId: string): Promise<void> {
  const { allowedUsers } = await import("@shared/schema");
  const { isNull, or } = await import("drizzle-orm");
  await tx
    .update(allowedUsers)
    .set({ customerId })
    .where(
      and(
        eq(allowedUsers.role, "CUSTOMER"),
        isNull(allowedUsers.customerId),
        or(eq(allowedUsers.authUserId, userId), eq(allowedUsers.replitUserId, userId)),
      ),
    );
}

/** Admin's merge list: records a website order half-matched to someone else. */
export async function listPossibleDuplicates(orgId: string) {
  const db = await mainDb();
  return db
    .select({
      id: customers.id,
      name: customers.name,
      possibleDuplicateOf: customers.possibleDuplicateOf,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(and(eq(customers.orgId, orgId), isNotNull(customers.possibleDuplicateOf)))
    .orderBy(desc(customers.createdAt));
}

// ---------------------------------------------------------------------------
// The named contact reads. Each caller logs what it reads and sends
// `Cache-Control: no-store`.
// ---------------------------------------------------------------------------

/** "Use saved address" at the till (PRV-05). */
export async function readSavedAddress(orgId: string, customerId: string): Promise<{ found: boolean; address: string | null }> {
  const db = await mainDb();
  const [row] = await db
    .select({ address: customers.address })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, orgId)))
    .limit(1);
  if (!row) return { found: false, address: null };
  const address = row.address?.trim() ? row.address.trim() : null;
  return { found: true, address };
}

/** The driver's call (Q8a). The route decides whether the caller may have it. */
export async function readCustomerPhone(orgId: string, customerId: string): Promise<string | null> {
  const db = await mainDb();
  const [row] = await db
    .select({ phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, orgId)))
    .limit(1);
  return row?.phone?.trim() ? row.phone.trim() : null;
}
