/**
 * The shape of GET /api/control-centre — see server/services/controlCentre.ts
 * for what each field means and why "today" is the trading day (06:00 to
 * 06:00 in the org's timezone) rather than the calendar day.
 */
export type DayKpi = {
  revenue: number;
  txns: number;
  aov: number;
  refundsTotal: number;
};

export type NextMoveSeverity = "info" | "warning" | "error";

export type NextMove = {
  id: string;
  message: string;
  severity: NextMoveSeverity;
  href: string;
};

export type ControlCentreSnapshot = {
  timezone: string;
  tradingDay: string;
  now: string;

  today: DayKpi;
  vsLastWeek: DayKpi | null;
  vsSameWeekdayAvg: DayKpi | null;
  revenueTrend: { date: string; revenue: number }[];

  ordersCreatedToday: number;
  ordersCompletedToday: number;
  openOrders: number;
  toCollect: number;
  toDeliver: number;

  lowStockCount: number;
  highRiskStockCount: number;
  deadStockCount: number;
  negativeStockCount: number;
  topProduct: { name: string; unitsSold: number } | null;

  creditOutstandingTotal: number;
  creditCustomersCount: number;
  newCustomers7d: number;

  workerHealth: { status: string; queued: number; failed: number; deadLetter: number };
  pendingApprovals: number;

  yesterdayTradingDay: string;
  yesterdayCloseRan: boolean;

  nextMoves: NextMove[];
};

export const CONTROL_CENTRE_QUERY_KEY = ["/api/control-centre"] as const;

export function money(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}
