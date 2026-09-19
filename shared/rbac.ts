import { ROLES, type Role } from "./schema";

export { ROLES, type Role };

const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 4,
  ADMIN: 3,
  MANAGER: 2,
  CASHIER: 1,
  CUSTOMER: 0,
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === "SUPER_ADMIN") return true;
  if (actorRole === "ADMIN") {
    return targetRole !== "SUPER_ADMIN";
  }
  return false;
}

export function canManageUser(actorRole: Role, actorOrgId: string | null, targetOrgId: string | null): boolean {
  if (actorRole === "SUPER_ADMIN") return true;
  if (actorRole === "ADMIN") {
    return !!actorOrgId && actorOrgId === targetOrgId;
  }
  return false;
}

export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}

/**
 * ADMIN/SUPER_ADMIN completing a sale themselves must not inflate their own
 * commission/KPI figures. Used at order completion (server/services/
 * orderCompletion.ts) to set `orders.exclude_from_commission` automatically —
 * never a manual per-order toggle. Takes a bare string, not `Role`: the
 * completing actor's role comes off the request/session, not a validated enum.
 */
export function isCommissionExemptRole(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
