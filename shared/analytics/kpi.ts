import { addDays, format, subWeeks } from "date-fns";

export type KpiOrder = {
  total: number | string;
  isRefund?: boolean;
};

export type DayKpi = {
  revenue: number;
  txns: number;
  aov: number;
  refundsTotal: number;
};

export type DailyKpiResponse = {
  today: DayKpi;
  lastWeek: DayKpi;
  sameWeekdayLtmAvg: DayKpi | null;
  date: string;
};

const EMPTY_DAY: DayKpi = { revenue: 0, txns: 0, aov: 0, refundsTotal: 0 };

export function aggregateDay(orders: KpiOrder[]): DayKpi {
  let revenue = 0;
  let txns = 0;
  let refundsTotal = 0;

  for (const order of orders) {
    const amount = Number(order.total) || 0;
    if (order.isRefund || amount < 0) {
      refundsTotal += Math.abs(amount);
      revenue += amount;
      continue;
    }
    revenue += amount;
    txns += 1;
  }

  const aov = txns > 0 ? roundMoney(revenue / txns) : 0;
  return {
    revenue: roundMoney(revenue),
    txns,
    aov,
    refundsTotal: roundMoney(refundsTotal),
  };
}

export function aggregateFromDailyRow(
  row: { totalOrders: number | null; totalRevenue: number | string | null } | null | undefined,
): DayKpi {
  if (!row) return { ...EMPTY_DAY };
  const revenue = roundMoney(Number(row.totalRevenue) || 0);
  const txns = row.totalOrders ?? 0;
  const aov = txns > 0 ? roundMoney(revenue / txns) : 0;
  return { revenue, txns, aov, refundsTotal: 0 };
}

/** ISO date strings for the same weekday going back `weeks` weeks (excludes `date` itself). */
export function sameWeekdayWindow(date: string | Date, weeks = 52): string[] {
  const anchor = typeof date === "string" ? parseDateOnly(date) : date;
  const dates: string[] = [];
  for (let i = 1; i <= weeks; i++) {
    dates.push(format(subWeeks(anchor, i), "yyyy-MM-dd"));
  }
  return dates;
}

export function offsetDate(date: string, days: number): string {
  return format(addDays(parseDateOnly(date), days), "yyyy-MM-dd");
}

export function averageSameWeekdayKpi(days: (DayKpi | null)[]): DayKpi | null {
  const present = days.filter((d): d is DayKpi => d !== null);
  if (present.length < 4) return null;

  const revenue = roundMoney(present.reduce((sum, d) => sum + d.revenue, 0) / present.length);
  const txns = Math.round(present.reduce((sum, d) => sum + d.txns, 0) / present.length);
  const refundsTotal = roundMoney(
    present.reduce((sum, d) => sum + d.refundsTotal, 0) / present.length,
  );
  const aov = txns > 0 ? roundMoney(revenue / txns) : 0;

  return { revenue, txns, aov, refundsTotal };
}

export function pctDelta(today: number, baseline: number): number | null {
  if (baseline === 0) return null;
  return Math.round(((today - baseline) / baseline) * 100);
}

export function absoluteDelta(today: number, baseline: number): number {
  return roundMoney(today - baseline);
}

function parseDateOnly(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
