/**
 * The role of each member of staff named by an auth subject, for rules that
 * depend on whose record it is (shift sheets, commission payments).
 *
 * Resolved the same way as the payroll table (server/routes/cashierAnalytics.ts):
 * the org login (allowed_users) first — the legacy owner flag wins, as in
 * storage.getUserRoleAndOrg — then the user record. Someone with neither is
 * returned as null, which the rules treat as "not known to be a cashier".
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { allowedUsers, users } from "@shared/schema";
import { isRole, type Role } from "@shared/rbac";

export async function loadStaffRoles(orgId: string, userIds: Iterable<string | null | undefined>): Promise<Map<string, Role | null>> {
  const ids = [...new Set([...userIds].filter((id): id is string => !!id))];
  const out = new Map<string, Role | null>();
  if (ids.length === 0) return out;
  const [logins, userRows] = await Promise.all([
    db
      .select({
        authUserId: allowedUsers.authUserId,
        replitUserId: allowedUsers.replitUserId,
        role: allowedUsers.role,
        isOwner: allowedUsers.isOwner,
      })
      .from(allowedUsers)
      .where(
        and(
          or(inArray(allowedUsers.authUserId, ids), inArray(allowedUsers.replitUserId, ids)),
          or(eq(allowedUsers.orgId, orgId), isNull(allowedUsers.orgId)),
        ),
      ),
    db.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, ids)),
  ]);
  const loginRole = new Map<string, string>();
  for (const l of logins) {
    const role = l.isOwner ? "SUPER_ADMIN" : String(l.role ?? "");
    if (l.authUserId) loginRole.set(l.authUserId, role);
    loginRole.set(l.replitUserId, role);
  }
  const userRole = new Map(userRows.map((u) => [u.id, String(u.role ?? "")]));
  for (const id of ids) {
    const raw = loginRole.get(id) ?? userRole.get(id) ?? "";
    out.set(id, isRole(raw) ? raw : null);
  }
  return out;
}

export async function loadStaffRole(orgId: string, userId: string | null | undefined): Promise<Role | null> {
  if (!userId) return null;
  return (await loadStaffRoles(orgId, [userId])).get(userId) ?? null;
}
