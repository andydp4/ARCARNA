import { ROLES, type Role } from "./schema";

export { ROLES, type Role };

const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 4,
  ADMIN: 3,
  MANAGER: 2,
  CASHIER: 1,
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
