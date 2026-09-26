import { isRole, roleRank, type Role } from "./rbac";
import { isAtLeast } from "./accessPolicy";

/**
 * Staff and pay (v1.2 Phase 0B, STF-FN4 / FIX-10; owner decisions Q12, Q13a, Q16).
 *
 * Pure rules, so the server can enforce them and the client can hide what the
 * server would refuse, from the same table.
 */

// ---------------------------------------------------------------------------
// Shift sheets.
// ---------------------------------------------------------------------------

export type ShiftSheetViewer = { userId: string | null | undefined; role: string | null | undefined };

/**
 * Who a shift belongs to. `userId` is the person (a lazy shift, or a till
 * shift). `role` null means no known role, read as a cashier (the lowest
 * rank); legacy cashier codes were only ever cashiers.
 */
export type ShiftSheetOwner = { userId: string | null | undefined; role: Role | null | undefined };

/**
 * Whether a viewer may read a shift sheet (the till Z-report or the cashier
 * balance sheet). Cashiers read only their own; managers read cashiers' and
 * their own; admins and the owner read all.
 */
export function maySeeShiftSheet(viewer: ShiftSheetViewer, owner: ShiftSheetOwner): boolean {
  const role = viewer.role;
  if (!role || !isRole(role) || role === "CUSTOMER") return false;
  if (isAtLeast(role, "ADMIN")) return true;
  const own = !!viewer.userId && !!owner.userId && owner.userId === viewer.userId;
  if (own) return true;
  if (role === "CASHIER") return false;
  // MANAGER: a colleague's sheet only when that colleague is a cashier. No
  // known role (a code-only shift, or a person with no login on record) reads
  // as a cashier, the same rule as canSeePayRow (shared/reports/payroll.ts).
  return owner.role == null || owner.role === "CASHIER";
}

/**
 * Fields of a cashier balance sheet that are cost, or are worked out from it
 * (profit, overhead share, expenses that include personal-use stock at cost).
 * Cost never reaches a cashier, not even in the data (Q6).
 */
const SHEET_COST_FIELDS = [
  "stockCost",
  "personalUseCost",
  "orderExpenses",
  "globalExpenseAllocation",
  "netSalesProfit",
  "businessRetainedProfit",
  "hasIncompleteCostData",
] as const;

/**
 * A cashier shift sheet (the live balance sheet or the stored summary row) as
 * a viewer may see it. Below manager, the cost fields go; below admin, the
 * commission rate goes too (Q16). What the till shows a cashier — sales and
 * the commission they have earned — stays.
 */
export function shiftSheetForRole<T extends Record<string, unknown>>(sheet: T, role: string | null | undefined): Partial<T> {
  const out: Record<string, unknown> = { ...sheet };
  if (!canSeeCommissionRates(role)) delete out.commissionRate;
  if (!isAtLeast(role, "MANAGER")) for (const key of SHEET_COST_FIELDS) delete out[key];
  return out as Partial<T>;
}

// ---------------------------------------------------------------------------
// The staff list (cashier profiles).
// ---------------------------------------------------------------------------

/** The staff list is manager and above. */
export const STAFF_LIST_MIN_ROLE: Role = "MANAGER";
/** Commission rates, the switch, the default and the overhead mode (Q16). */
export const PAY_SETTINGS_MIN_ROLE: Role = "ADMIN";

export function canSeeCommissionRates(role: string | null | undefined): boolean {
  return isAtLeast(role, PAY_SETTINGS_MIN_ROLE);
}

/**
 * A cashier profile as a viewer may see it. The PIN never leaves the server,
 * for anyone: it is a credential, and an admin who needs a new one sets it
 * rather than reading the old one back. `hasPin` says whether one is set.
 * The commission override is admin only.
 */
export function cashierProfileForRole<T extends { pinCode?: string | null; defaultCommissionRate?: unknown }>(
  profile: T,
  role: string | null | undefined,
): Omit<T, "pinCode"> & { hasPin: boolean } {
  const { pinCode, ...rest } = profile;
  const out: Record<string, unknown> = { ...rest, hasPin: !!pinCode };
  if (!canSeeCommissionRates(role)) delete out.defaultCommissionRate;
  return out as Omit<T, "pinCode"> & { hasPin: boolean };
}

// ---------------------------------------------------------------------------
// Org settings that set pay or judge staff (Q16): admin only, every change logged.
// ---------------------------------------------------------------------------

/** The commission switch, the default rate and the overhead mode. */
export const PAY_SETTING_KEYS = [
  "cashierCommissionEnabled",
  "defaultCashierCommissionRate",
  "globalExpenseAllocationMode",
] as const;

/**
 * The "on time" timing settings: they decide when a member of staff's order
 * reads as late, so they are how staff are judged (question 16).
 */
export const TIMING_SETTING_KEYS = [
  "opsPrepSlaMinutes",
  "opsDeliveryLeadMinutes",
  "opsDueSoonLeadMinutes",
  "opsLateGraceMinutes",
] as const;

export const ADMIN_ONLY_SETTING_KEYS: readonly string[] = [...PAY_SETTING_KEYS, ...TIMING_SETTING_KEYS];

export type SettingChange = { key: string; from: unknown; to: unknown };

function normaliseSetting(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : String(value);
}

/**
 * The admin-only settings a patch would actually change. A key sent with the
 * value already stored is not a change — the setup wizard and the settings
 * cards echo the whole form back, and a manager saving an unrelated field
 * must not be refused over a value they did not touch. `"10"`, `10` and
 * `"10.00"` are the same rate.
 */
export function adminOnlySettingChanges(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): SettingChange[] {
  const out: SettingChange[] = [];
  for (const key of ADMIN_ONLY_SETTING_KEYS) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const from = normaliseSetting(current[key]);
    const to = normaliseSetting(patch[key]);
    if (from !== to) out.push({ key, from: current[key] ?? null, to: patch[key] });
  }
  return out;
}

/** Org settings as a viewer below admin may read them: no commission rate. */
export function orgSettingsForRole<T extends Record<string, unknown>>(settings: T, role: string | null | undefined): T {
  if (canSeeCommissionRates(role)) return settings;
  const out: Record<string, unknown> = { ...settings };
  delete out.defaultCashierCommissionRate;
  return out as T;
}

// ---------------------------------------------------------------------------
// Commission payments.
// ---------------------------------------------------------------------------

export type CommissionPaymentVerdict = { ok: true } | { ok: false; status: 403; message: string };

/**
 * Whether the viewer may confirm a commission payment to this payee. No one
 * confirms their own — except the owner: everyone else's self-payment has
 * someone above them to confirm it instead, but nobody outranks the owner,
 * so applying the same rule to them would mean their own commission could
 * never be confirmed by anyone, ever. Below the owner, only cashiers' pay
 * (and code-only history, which was only ever cashiers) — the same rows
 * canSeePayRow shows them; managers' and admins' pay is the owner's (Q13a).
 */
export function mayConfirmCommissionPayment(
  viewer: ShiftSheetViewer,
  payee: { userId: string | null | undefined; role: Role | null | undefined },
): CommissionPaymentVerdict {
  const role = viewer.role;
  const isSelf = Boolean(viewer.userId && payee.userId && viewer.userId === payee.userId);
  if (isSelf && role !== "SUPER_ADMIN") {
    return { ok: false, status: 403, message: "You cannot confirm your own commission payment. Ask someone else to confirm it." };
  }
  if (!role || !isRole(role) || roleRank(role) < roleRank("MANAGER")) {
    return { ok: false, status: 403, message: "Only a manager or admin can confirm commission payments." };
  }
  if (role === "SUPER_ADMIN") return { ok: true };
  // No known role reads as a cashier, as in canSeePayRow.
  if (!payee.userId || payee.role == null || payee.role === "CASHIER") return { ok: true };
  return { ok: false, status: 403, message: "Only the owner can confirm commission for managers and admins." };
}
