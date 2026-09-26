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
import { isRole, roleRank } from "@shared/rbac";

export type EvidenceStaffMember = { id: string; name: string; role: string };
export type EvidenceViewer = { userId: string | null; role: string | null | undefined };

/**
 * Whose sales a viewer may filter Evidence by. Admins and the owner: anyone.
 * Below that, cashiers and yourself — a manager running Daily Sales for a peer
 * manager or the admin is "managers' performance", which Q12 keeps above the
 * manager line (as ARC-T2-002 is).
 */
export function mayFilterEvidenceBy(viewer: EvidenceViewer, target: { id: string; role: string | null }): boolean {
  if (viewer.role && isRole(viewer.role) && roleRank(viewer.role) >= roleRank("ADMIN")) return true;
  if (viewer.userId && target.id === viewer.userId) return true;
  return target.role === "CASHIER";
}

function subjectOf(row: { authUserId: string | null; replitUserId: string }): string {
  return row.authUserId || row.replitUserId;
}

export async function listEvidenceStaff(orgId: string, viewer: EvidenceViewer): Promise<EvidenceStaffMember[]> {
  const viewerUserId = viewer.userId;
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
    .filter((m) => mayFilterEvidenceBy(viewer, m))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The role of `userId` if they are someone who can have completed an order in
 * this org — a non-customer member of it, or an org-less SUPER_ADMIN (the
 * owner steps in on the till too) — else null. Used to 404 a staff filter that
 * names nobody here, rather than silently answering org-wide under a person's
 * name (ARC-026), and to refuse one the viewer may not see (Q12).
 */
export async function evidenceStaffRole(orgId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: allowedUsers.role })
    .from(allowedUsers)
    .where(
      and(
        or(eq(allowedUsers.authUserId, userId), eq(allowedUsers.replitUserId, userId)),
        ne(allowedUsers.role, "CUSTOMER"),
        or(eq(allowedUsers.orgId, orgId), and(isNull(allowedUsers.orgId), eq(allowedUsers.role, "SUPER_ADMIN"))),
      ),
    )
    .limit(1);
  return row ? String(row.role ?? "CASHIER") : null;
}

export async function isEvidenceStaff(orgId: string, userId: string): Promise<boolean> {
  return (await evidenceStaffRole(orgId, userId)) !== null;
}
