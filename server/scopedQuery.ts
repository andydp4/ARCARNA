/**
 * Scoped query helpers - ensure org/location filters are applied.
 * Use these to avoid accidental cross-org data access.
 *
 * Rules:
 * - SUPER_ADMIN: can query any org (pass orgId = null to skip filter)
 * - All other roles: MUST pass orgId; queries are filtered by org
 * - locationId: optional store scope (filters to specific location when provided)
 */
import { eq } from "drizzle-orm";

export type OrgContext = {
  orgId: string | null; // null = SUPER_ADMIN (no filter)
  locationId?: string | null;
  role: string;
};

/**
 * Returns a condition that enforces org scope, or undefined if no filter needed.
 * For SUPER_ADMIN with no orgId filter, returns undefined.
 * For org users, returns eq(column, orgId).
 */
export function orgFilter(column: Parameters<typeof eq>[0], orgId: string | null) {
  if (orgId === null || orgId === undefined) return undefined;
  return eq(column, orgId);
}

/**
 * Asserts user can access the given org.
 * SUPER_ADMIN can access any org. Others must match their orgId.
 */
export function assertOrgAccess(ctx: OrgContext, targetOrgId: string | null): void {
  if (ctx.role === "SUPER_ADMIN") return;
  if (targetOrgId === null || targetOrgId === undefined) return; // legacy unscoped
  if (ctx.orgId !== targetOrgId) {
    throw new Error("Access denied: cannot access data from another organization");
  }
}
