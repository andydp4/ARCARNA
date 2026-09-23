/**
 * The people an Evidence page can be filtered by (STF-FN2).
 *
 * Staff are keyed by user id — the auth subject written to
 * `orders.completed_user_id` — not by cashier code. No shift has carried a
 * code since the lazy-shift change, so a code-keyed filter answers £0 for
 * everyone trading today.
 *
 * Same membership rule as the Operations board's staff list
 * (server/services/opsBoard.ts loadStaff): the org's `allowed_users` minus
 * CUSTOMER, plus the viewer's own row when it has no org (the SUPER_ADMIN
 * owner, whose `org_id` is NULL by design). Names and ids only: this list is
 * for a picker, and it carries no contact details.
 */
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { allowedUsers } from "@shared/schema";
import { db } from "../db";

export type EvidenceStaffMember = { id: string; name: string; role: string };

function subjectOf(row: { authUserId: string | null; replitUserId: string }): string {
  return row.authUserId || row.replitUserId;
}

export async function listEvidenceStaff(orgId: string, viewerUserId: string | null): Promise<EvidenceStaffMember[]> {
  const orgOrViewer = viewerUserId
    ? or(
        eq(allowedUsers.orgId, orgId),
        and(
          isNull(allowedUsers.orgId),
          or(eq(allowedUsers.authUserId, viewerUserId), eq(allowedUsers.replitUserId, viewerUserId)),
        ),
      )
    : eq(allowedUsers.orgId, orgId);
  const rows = await db
    .select({
      authUserId: allowedUsers.authUserId,
      replitUserId: allowedUsers.replitUserId,
      name: allowedUsers.name,
      role: allowedUsers.role,
    })
    .from(allowedUsers)
    .where(and(orgOrViewer, ne(allowedUsers.role, "CUSTOMER")));
  return rows
    .map((r) => ({
      id: subjectOf(r),
      // No email fallback: a picker is not a contact list.
      name: r.name?.trim() || `Unnamed ${String(r.role ?? "staff").toLowerCase()}`,
      role: String(r.role ?? "CASHIER"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * True when `userId` is someone who can have completed an order in this org:
 * a non-customer member of it, or an org-less SUPER_ADMIN (the owner steps in
 * on the till too). Used to 404 a staff filter that names nobody here, rather
 * than silently answering org-wide under a person's name (ARC-026).
 */
export async function isEvidenceStaff(orgId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: allowedUsers.id })
    .from(allowedUsers)
    .where(
      and(
        or(eq(allowedUsers.authUserId, userId), eq(allowedUsers.replitUserId, userId)),
        ne(allowedUsers.role, "CUSTOMER"),
        or(eq(allowedUsers.orgId, orgId), and(isNull(allowedUsers.orgId), eq(allowedUsers.role, "SUPER_ADMIN"))),
      ),
    )
    .limit(1);
  return !!row;
}
