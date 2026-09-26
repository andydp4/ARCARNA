/**
 * Cashier Payroll, one row per person (STF-FN3).
 *
 * The table used to loop over cashier codes and count orders by the legacy
 * `orders.cashier_id`. No shift has carried a code since the lazy-shift
 * change, so everyone trading today was missing from it. Rows are now keyed
 * by the person (`user_id`), with a code-only row kept for history that was
 * never attributed to a login.
 *
 * Pure: the route loads the rows, this file shapes them, so the rules are
 * testable without a database.
 */
import { roleRank, isRole, type Role } from "../rbac";

export type PayrollShift = {
  id: string;
  userId: string | null;
  cashierId: string | null;
  openedAt: Date;
  lastActivityAt: Date | null;
  closedAt: Date | null;
  status: string;
  closeReason: string | null;
};

export type PayrollSummary = {
  shiftId: string;
  userId: string | null;
  cashierId: string | null;
  grossSales: string | number;
  unpaidCreditSales: string | number;
  creditSales: string | number;
  netSalesProfit: string | number;
  commissionAmount: string | number;
};

export type PayrollPayment = { userId: string | null; cashierId: string | null; amountPaid: string | number };

export type PayrollOrderAgg = { userId: string; orderCount: number; sales: number };

export type PayrollPerson = {
  /** `user_id` for a person, `code:<cashier id>` for history with no login. */
  key: string;
  name: string;
  /**
   * Their role in this org, or null for a code-only row (codes were only
   * ever cashiers) or someone whose login no longer resolves.
   */
  role: Role | null;
};

export type PayrollMetric = {
  key: string;
  userId: string | null;
  cashierId: string | null;
  name: string;
  role: Role | null;
  totalSales: number;
  paidSalesReceived: number;
  creditSales: number;
  netSalesProfit: number;
  commissionEarned: number;
  commissionPaid: number;
  commissionUnpaid: number;
  shiftCount: number;
  /** First to last action on each shift, summed, in hours. */
  activeHours: number;
  /** Completed-order sales divided by active hours. */
  salesPerActiveHour: number;
  orderCount: number;
  averageOrderValue: number;
};

export function personKey(userId: string | null, cashierId: string | null): string | null {
  if (userId) return userId;
  if (cashierId) return `code:${cashierId}`;
  return null;
}

/**
 * Whose pay a viewer may see (Q12, Q13a). Managers run Evidence but not
 * staff pay above cashier level; managers' pay is the owner's alone. So:
 * SUPER_ADMIN sees everyone; ADMIN and MANAGER see cashiers (including
 * code-only history, which was only ever cashiers) and their own row.
 */
export function canSeePayRow(viewer: { userId: string | null; role: string | null | undefined }, row: { key: string; role: Role | null }): boolean {
  if (viewer.role === "SUPER_ADMIN") return true;
  if (viewer.userId && row.key === viewer.userId) return true;
  if (!viewer.role || !isRole(viewer.role) || roleRank(viewer.role) < roleRank("MANAGER")) return false;
  return row.role === null || row.role === "CASHIER";
}

/**
 * Hours from a shift opening to the last thing done on it. Not open-to-close:
 * a lazy shift is closed by the daily close whenever that runs, so a shift
 * that started at 14:00 would otherwise read as about 16 hours.
 */
export function activeHoursOf(shift: Pick<PayrollShift, "openedAt" | "lastActivityAt">): number {
  const start = new Date(shift.openedAt).getTime();
  const end = shift.lastActivityAt ? new Date(shift.lastActivityAt).getTime() : start;
  return Math.max(0, end - start) / 3_600_000;
}

function n(v: string | number | null | undefined): number {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(x) ? x : 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildPayrollMetrics(input: {
  people: Map<string, PayrollPerson>;
  shifts: PayrollShift[];
  summaries: PayrollSummary[];
  payments: PayrollPayment[];
  orders: PayrollOrderAgg[];
}): PayrollMetric[] {
  type Acc = {
    sales: number;
    paidSales: number;
    credit: number;
    profit: number;
    commission: number;
    paid: number;
    shifts: number;
    hours: number;
    orderCount: number;
    orderSales: number;
    userId: string | null;
    cashierId: string | null;
  };
  const acc = new Map<string, Acc>();
  const get = (key: string, userId: string | null, cashierId: string | null): Acc => {
    let a = acc.get(key);
    if (!a) {
      a = { sales: 0, paidSales: 0, credit: 0, profit: 0, commission: 0, paid: 0, shifts: 0, hours: 0, orderCount: 0, orderSales: 0, userId, cashierId };
      acc.set(key, a);
    }
    if (!a.cashierId && cashierId) a.cashierId = cashierId;
    return a;
  };

  for (const s of input.shifts) {
    const key = personKey(s.userId, s.cashierId);
    if (!key) continue;
    const a = get(key, s.userId, s.cashierId);
    a.shifts += 1;
    a.hours += activeHoursOf(s);
  }
  for (const s of input.summaries) {
    const key = personKey(s.userId, s.cashierId);
    if (!key) continue;
    const a = get(key, s.userId, s.cashierId);
    a.sales += n(s.grossSales);
    a.paidSales += n(s.grossSales) - n(s.unpaidCreditSales);
    a.credit += n(s.creditSales);
    a.profit += n(s.netSalesProfit);
    a.commission += n(s.commissionAmount);
  }
  for (const p of input.payments) {
    const key = personKey(p.userId, p.cashierId);
    if (!key) continue;
    get(key, p.userId, p.cashierId).paid += n(p.amountPaid);
  }
  for (const o of input.orders) {
    const a = get(o.userId, o.userId, null);
    a.orderCount += Number(o.orderCount) || 0;
    a.orderSales += n(o.sales);
  }

  const out: PayrollMetric[] = [];
  for (const [key, a] of acc) {
    const person = input.people.get(key);
    const commissionEarned = round2(a.commission);
    const commissionPaid = round2(a.paid);
    out.push({
      key,
      userId: a.userId,
      cashierId: a.cashierId,
      name: person?.name ?? "Unnamed",
      role: person?.role ?? null,
      totalSales: round2(a.sales),
      paidSalesReceived: round2(a.paidSales),
      creditSales: round2(a.credit),
      netSalesProfit: round2(a.profit),
      commissionEarned,
      commissionPaid,
      commissionUnpaid: round2(Math.max(0, commissionEarned - commissionPaid)),
      shiftCount: a.shifts,
      activeHours: round2(a.hours),
      salesPerActiveHour: a.hours > 0 ? round2(a.orderSales / a.hours) : 0,
      orderCount: a.orderCount,
      averageOrderValue: a.orderCount > 0 ? round2(a.orderSales / a.orderCount) : 0,
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
