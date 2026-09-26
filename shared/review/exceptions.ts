import { z } from "zod";
import { roleRank, type Role } from "../rbac";
import { isAtLeast, STAFF_ROLES } from "../accessPolicy";
import { localCalendarDate, localInstant, shiftIsoDate } from "../time/tradingDay";

/**
 * Needs a look (v1.2 Phase 4, CMP-02, CMP-04): the rules for reviewing
 * exceptions, shared by the server (which enforces them) and the inbox page.
 *
 * An exception is a flagged sale or a refund the refunds rule picks out. It is
 * reviewed by people who outrank the person it is about — the same rule as the
 * Signal it raised (shared/signals.ts) — so managers review cashiers', admins
 * review managers' too, the owner sees everything, and nobody reviews their own.
 */

export const EXCEPTION_STATES = ["open", "acknowledged", "explained", "escalated"] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];

export const EXCEPTION_STATE_LABELS: Record<ExceptionState, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  explained: "Explained",
  escalated: "Escalated",
};

/** "pattern" is a loss-prevention flag (v1.2 Phase 7C, shared/reports/lossPrevention.ts). */
export type ExceptionKind = "price" | "refund" | "pattern";

/** The weekly line: "N unreviewed for over 7 days". */
export const STALE_AFTER_DAYS = 7;

export const NEEDS_A_LOOK_MIN_ROLE: Role = "MANAGER";

function asStaffRole(role: string | null | undefined): Role | null {
  return role && (STAFF_ROLES as readonly string[]).includes(role) ? (role as Role) : null;
}

/**
 * Whether `viewer` may see and review an exception about `subject`. An
 * unknown subject role counts as a cashier (the lowest rank), as for Signals.
 */
export function mayReviewException(
  viewer: { userId: string; role: string | null | undefined },
  subject: { userId: string | null | undefined; role: string | null | undefined },
): boolean {
  const role = asStaffRole(viewer.role);
  if (!role || !isAtLeast(role, NEEDS_A_LOOK_MIN_ROLE)) return false;
  if (role === "SUPER_ADMIN") return true;
  if (subject.userId && subject.userId === viewer.userId) return false;
  const subjectRole = asStaffRole(subject.role) ?? "CASHIER";
  return roleRank(role) > roleRank(subjectRole);
}

/** The queues (by the subject's role) a viewer works through, lowest first. */
export function reviewQueuesFor(role: string | null | undefined): Role[] {
  const r = asStaffRole(role);
  if (!r || !isAtLeast(r, NEEDS_A_LOOK_MIN_ROLE)) return [];
  if (r === "SUPER_ADMIN") return [...STAFF_ROLES];
  return STAFF_ROLES.filter((s) => roleRank(s) < roleRank(r));
}

export const QUEUE_LABELS: Record<Role, string> = {
  CASHIER: "Cashiers",
  MANAGER: "Managers",
  ADMIN: "Admins",
  SUPER_ADMIN: "Owner",
  CUSTOMER: "Customers",
};

export function staleLine(count: number): string {
  return `${count} unreviewed for over ${STALE_AFTER_DAYS} days`;
}

// ---------------------------------------------------------------------------
// Admin settings: when below-minimum Signals go out, and the refunds rule.
// ---------------------------------------------------------------------------

export const MIN_SIGNAL_MODES = ["immediate", "twice_daily"] as const;
export type MinSignalMode = (typeof MIN_SIGNAL_MODES)[number];

export const REVIEW_RULE_DEFAULTS = {
  priceGuardMinSignal: "immediate" as MinSignalMode,
  refundCashOver: 50,
  refundAfterDays: 14,
  refundSameCashierHours: 24,
};
export type ReviewRules = typeof REVIEW_RULE_DEFAULTS;

export const reviewRulesSchema = z.object({
  priceGuardMinSignal: z.enum(MIN_SIGNAL_MODES),
  refundCashOver: z.number().finite().min(0).max(100000),
  refundAfterDays: z.number().int().min(1).max(3650),
  refundSameCashierHours: z.number().int().min(1).max(24 * 90),
});

export function reviewRulesFromOrg(org: {
  priceGuardMinSignal?: string | null;
  refundCashOver?: string | number | null;
  refundAfterDays?: number | null;
  refundSameCashierHours?: number | null;
}): ReviewRules {
  const d = REVIEW_RULE_DEFAULTS;
  const cash = Number(org.refundCashOver);
  return {
    priceGuardMinSignal: org.priceGuardMinSignal === "twice_daily" ? "twice_daily" : "immediate",
    refundCashOver: Number.isFinite(cash) && org.refundCashOver != null ? cash : d.refundCashOver,
    refundAfterDays: org.refundAfterDays ?? d.refundAfterDays,
    refundSameCashierHours: org.refundSameCashierHours ?? d.refundSameCashierHours,
  };
}

/** Twice daily: the round-ups go out at these local hours. */
export const DIGEST_HOURS = [12, 18] as const;

/**
 * The latest round-up time at or before `now` in the org's zone. A held
 * below-minimum Signal from before it is due; one after waits for the next.
 */
export function latestDigestSlot(now: Date, timeZone: string): Date {
  const today = localCalendarDate(now, timeZone);
  for (const day of [today, shiftIsoDate(today, -1)]) {
    for (const hour of [...DIGEST_HOURS].reverse()) {
      const slot = localInstant(day, hour, timeZone);
      if (slot.getTime() <= now.getTime()) return slot;
    }
  }
  return localInstant(shiftIsoDate(today, -1), DIGEST_HOURS[0], timeZone);
}

/** The local hour of an instant in the zone. */
export function localHour(now: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h) || 0;
}

/**
 * The week `now` falls in (local): its Monday as an ISO date (the week's key),
 * the local weekday (0 Sunday … 6 Saturday) and the local hour.
 */
export function weekKeyFor(now: Date, timeZone: string): { key: string; weekday: number; hour: number } {
  const today = localCalendarDate(now, timeZone);
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = (weekday + 6) % 7;
  return { key: shiftIsoDate(today, -back), weekday, hour: localHour(now, timeZone) };
}

// ---------------------------------------------------------------------------
// Refunds follow the same rule (CMP-04): never blocked; these raise an exception.
// ---------------------------------------------------------------------------

export const REFUND_RULES = ["cash_over", "other_cashier", "after_days", "reason_other"] as const;
export type RefundRule = (typeof REFUND_RULES)[number];

export function refundRuleLabel(rule: RefundRule, rules: ReviewRules): string {
  switch (rule) {
    case "cash_over":
      return `Cash refund over £${rules.refundCashOver.toFixed(2)}`;
    case "other_cashier":
      return "Refund on another cashier's sale";
    case "after_days":
      return `Refund ${rules.refundAfterDays}+ days after the sale`;
    case "reason_other":
      return "Reason: Other";
  }
}

export function refundExceptionRules(
  input: {
    /** Money going back as cash (method resolved against the original tender). */
    isCash: boolean;
    total: number;
    refunderUserId: string | null;
    /** Who rang the sale; null when not known. */
    saleUserId: string | null;
    saleAt: Date | null;
    reason: string;
    now?: Date;
  },
  rules: ReviewRules,
): RefundRule[] {
  const out: RefundRule[] = [];
  const now = input.now ?? new Date();
  if (input.isCash && Math.round(input.total * 100) > Math.round(rules.refundCashOver * 100)) out.push("cash_over");
  if (input.saleUserId && input.refunderUserId && input.saleUserId !== input.refunderUserId) out.push("other_cashier");
  if (input.saleAt && now.getTime() - input.saleAt.getTime() >= rules.refundAfterDays * 86_400_000) out.push("after_days");
  if (input.reason === "other") out.push("reason_other");
  return out;
}

// ---------------------------------------------------------------------------
// Repeat patterns (PRC-09): one Signal to admins.
// ---------------------------------------------------------------------------

/** This many flagged sales by one person in REPEAT_WINDOW_DAYS is a pattern. */
export const REPEAT_THRESHOLD = 3;
export const REPEAT_WINDOW_DAYS = 7;
