import { roleRank, type Role } from "./rbac";
import { isAtLeast, STAFF_ROLES } from "./accessPolicy";

/**
 * Who a Signal is for (v1.2 Phase 0B, FIX-08 / CMP-01).
 *
 * Pure rules shared by `notify()` (server/services/signals.ts), which resolves
 * the recipients when a Signal is written, and by the read route, which checks
 * them again against the viewer's CURRENT role — so someone demoted since the
 * Signal was sent stops seeing it.
 *
 * The rules, in the owner's words:
 * - the recipient lookup always includes the owner (SUPER_ADMIN), whose login
 *   has no fixed organisation;
 * - read state is per person;
 * - existing Signals go to managers, commission paid goes to admins;
 * - a Signal that names a member of staff never goes team-wide: it reaches
 *   only people who outrank the person it names, so managers see Signals about
 *   cashiers and only admins see Signals about managers.
 */

export type SignalAudience = {
  /** Everyone in the org at or above this role. */
  minRole?: Role;
  /** Everyone in the org with one of these roles. */
  roles?: Role[];
  /** Named people (auth subjects). Addressed to them personally. */
  userIds?: string[];
  /** Tell the person the Signal names. Off unless asked for. */
  tellSubject?: boolean;
  /** Role of the person named, recorded at send time for the read-time check. */
  subjectRole?: Role | null;
};

/** Default routing per Signal source (owner decision: existing Signals go to managers). */
export const SIGNAL_ROUTES: Record<string, SignalAudience> = {
  personal_use: { minRole: "MANAGER" },
  daily_close: { minRole: "MANAGER" },
  scheduled_report: { minRole: "MANAGER" },
  automation_rule: { minRole: "MANAGER" },
  report_flag: { minRole: "MANAGER" },
  credit_payment: { minRole: "MANAGER" },
  // Pay is admin business (owner decisions Q13/Q16).
  cashier_commission: { minRole: "ADMIN" },
};

export const DEFAULT_SIGNAL_AUDIENCE: SignalAudience = { minRole: "MANAGER" };

export function audienceFor(source: string, override?: SignalAudience): SignalAudience {
  return override ?? SIGNAL_ROUTES[source] ?? DEFAULT_SIGNAL_AUDIENCE;
}

export type SignalCandidate = {
  /** Auth subject, the same value as `req.user.id`. */
  userId: string;
  role: string | null;
  /** The person's fixed org. NULL for the owner's SUPER_ADMIN login. */
  orgId: string | null;
};

function isStaffRole(role: string | null | undefined): role is Role {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

/**
 * Whether one person may see a Signal. Used both to pick recipients at send
 * time and to re-check at read time.
 *
 * `inOrg` is whether the person belongs to the Signal's org; SUPER_ADMIN is
 * always treated as in it.
 */
export function mayReceiveSignal(
  person: { userId: string; role: string | null; inOrg: boolean },
  audience: SignalAudience,
  subjectUserId: string | null | undefined,
): boolean {
  const role = person.role;
  if (!isStaffRole(role)) return false;
  const isSubject = !!subjectUserId && person.userId === subjectUserId;
  if (isSubject && !audience.tellSubject) return false;

  // The owner sees everything in every org, whatever the audience.
  if (role === "SUPER_ADMIN") return true;
  if (!person.inOrg) return false;

  // Addressed personally: they get it, whatever their role.
  if (audience.userIds?.includes(person.userId)) return true;
  if (isSubject) return true; // tellSubject was set

  const byRole =
    (!!audience.minRole && isAtLeast(role, audience.minRole)) ||
    (!!audience.roles && audience.roles.includes(role));
  if (!byRole) return false;

  // A Signal that names someone reaches only people who outrank them — never
  // their peers, so never team-wide. An unknown subject role is treated as a
  // cashier, the lowest rank, which still keeps it off the team.
  if (subjectUserId) {
    const subjectRole: Role = isStaffRole(audience.subjectRole) ? audience.subjectRole : "CASHIER";
    if (roleRank(role) <= roleRank(subjectRole)) return false;
  }
  return true;
}

/**
 * The recipients of a Signal from everyone who might get one: people in the
 * org plus every SUPER_ADMIN (whose org is NULL). Deduplicated.
 */
export function selectSignalRecipients(
  candidates: readonly SignalCandidate[],
  orgId: string,
  audience: SignalAudience,
  subjectUserId?: string | null,
): string[] {
  const out = new Set<string>();
  for (const c of candidates) {
    if (!c.userId) continue;
    const inOrg = c.orgId === orgId;
    if (mayReceiveSignal({ userId: c.userId, role: c.role, inOrg }, audience, subjectUserId)) {
      out.add(c.userId);
    }
  }
  return [...out];
}

/**
 * Computed Signals (not stored): who may see each kind. Stock warnings are for
 * managers; account approvals are for admins; worker dead letters are
 * platform-wide (not scoped to one org), so only the owner sees them.
 */
export const COMPUTED_SIGNAL_MIN_ROLE: Record<"stock" | "approval" | "worker", Role> = {
  stock: "MANAGER",
  approval: "ADMIN",
  worker: "SUPER_ADMIN",
};
