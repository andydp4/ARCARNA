import { eq, or } from "drizzle-orm";
import { db } from "../db";
import { users } from "../../shared/schema";
import { storage } from "../storage";
import { getAuthProvider } from "../authRuntime";

/** OIDC / Clerk token claims used for allow-list and approval decisions. */
export type AllowListClaims = {
  sub: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  profile_image_url?: string | null;
};

export type AllowListStatus = {
  allowed: boolean;
  isOwner: boolean;
  isPending: boolean;
  role?: string;
  orgId?: string | null;
  defaultLocationId?: string | null;
};

/**
 * This person's default POS location, set by an admin in User Access
 * (`users.default_location_id`). Matched on `users.id` OR `users.replit_user_id`
 * for the same reason `setUserCommissionRate` does: those two columns are the
 * same value for accounts created since the auth migration and differ for
 * older ones.
 */
async function getUserDefaultLocationId(authUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ defaultLocationId: users.defaultLocationId })
    .from(users)
    .where(or(eq(users.id, authUserId), eq(users.replitUserId, authUserId)))
    .limit(1);
  return row?.defaultLocationId ?? null;
}

/**
 * Enforces allowed_users / user_approval_requests for a signed-in subject.
 * First platform user becomes SUPER_ADMIN; others require approval unless email-linked.
 */
export async function checkAndHandleAllowList(claims: AllowListClaims): Promise<AllowListStatus> {
  const authUserId = claims.sub;
  const email = claims.email ?? undefined;
  const name =
    `${claims.first_name || ""} ${claims.last_name || ""}`.trim() || email || authUserId;
  const profileImageUrl = claims.profile_image_url ?? undefined;
  const provider = getAuthProvider();

  const existing = await storage.getUserRoleAndOrg(authUserId);
  if (existing) {
    const owner = await storage.getOwner();
    const defaultLocationId = await getUserDefaultLocationId(authUserId);
    return {
      allowed: true,
      isOwner: owner?.authUserId === authUserId || owner?.replitUserId === authUserId,
      isPending: false,
      role: existing.role,
      orgId: existing.orgId,
      defaultLocationId,
    };
  }

  if (email) {
    const linked = await storage.tryLinkAuthUserByEmail({
      email,
      newAuthUserId: authUserId,
      authProvider: provider,
    });
    if (linked.linked) {
      const roleAndOrg = await storage.getUserRoleAndOrg(authUserId);
      if (roleAndOrg) {
        const owner = await storage.getOwner();
        const defaultLocationId = await getUserDefaultLocationId(authUserId);
        return {
          allowed: true,
          isOwner: owner?.authUserId === authUserId || owner?.replitUserId === authUserId,
          isPending: false,
          role: roleAndOrg.role,
          orgId: roleAndOrg.orgId,
          defaultLocationId,
        };
      }
    }
  }

  const owner = await storage.getOwner();

  if (!owner) {
    await storage.addAllowedUser({
      replitUserId: authUserId,
      authUserId,
      authProvider: provider,
      email: email ?? null,
      name,
      isOwner: 1,
      orgId: null,
      role: "SUPER_ADMIN",
    });
    return { allowed: true, isOwner: true, isPending: false, role: "SUPER_ADMIN", orgId: null };
  }

  const existingRequest = await storage.getApprovalRequest(authUserId);

  if (existingRequest) {
    if (existingRequest.status === "approved") {
      await storage.addAllowedUser({
        replitUserId: existingRequest.replitUserId,
        authUserId,
        authProvider: provider,
        email: existingRequest.email,
        name: existingRequest.name,
        isOwner: 0,
        orgId: null,
        role: "CASHIER",
      });
      return { allowed: true, isOwner: false, isPending: false, role: "CASHIER", orgId: null };
    }
    if (existingRequest.status === "rejected") {
      return { allowed: false, isOwner: false, isPending: false };
    }
    return { allowed: false, isOwner: false, isPending: true };
  }

  await storage.createApprovalRequest({
    replitUserId: authUserId,
    authUserId,
    authProvider: provider,
    email: email ?? null,
    name,
    profileImageUrl: profileImageUrl ?? null,
    status: "pending",
  });

  return { allowed: false, isOwner: false, isPending: true };
}

/** Shape stored on req.user for RBAC middleware and /api/auth/user. */
export function buildSessionUser(
  authUserId: string,
  claims: AllowListClaims,
  status: AllowListStatus,
) {
  return {
    id: authUserId,
    claims: { sub: authUserId, email: claims.email },
    isOwner: status.isOwner,
    isAllowed: status.allowed,
    isPending: status.isPending,
    role: status.role ?? (status.isOwner ? "SUPER_ADMIN" : "CASHIER"),
    orgId: status.orgId ?? null,
    // requireOrgContext falls back to this for POS location resolution when
    // there is no X-Location-Id header and no open till shift. It was never
    // carried onto the session user before, so that fallback was always
    // undefined even when an admin had set users.default_location_id.
    defaultLocationId: status.defaultLocationId ?? null,
    expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  };
}
