export type HourOfDayOrder = {
  createdAt: Date | string;
  total: number | string;
  status: string;
};

export type HourOfDayBucket = {
  dow: number;
  hour: number;
  avgRevenue: number;
  txns: number;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function dowLabel(dow: number): string {
  return DOW_LABELS[dow] ?? String(dow);
}

/** Pure aggregator: bucket completed orders by weekday + hour, average revenue over `weeks`. */
export function aggregateHourOfDay(
  orders: HourOfDayOrder[],
  weeks: number,
  getDowHour: (date: Date) => { dow: number; hour: number },
): HourOfDayBucket[] {
  const safeWeeks = Math.max(1, weeks);
  const totals = new Map<string, { revenue: number; txns: number }>();

  for (const order of orders) {
    if (order.status !== "completed") continue;
    const amount = Number(order.total) || 0;
    if (amount <= 0) continue;

    const date = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
    if (Number.isNaN(date.getTime())) continue;

    const { dow, hour } = getDowHour(date);
    const key = `${dow}:${hour}`;
    const existing = totals.get(key) ?? { revenue: 0, txns: 0 };
    existing.revenue += amount;
    existing.txns += 1;
    totals.set(key, existing);
  }

  const buckets: HourOfDayBucket[] = [];
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const key = `${dow}:${hour}`;
      const cell = totals.get(key) ?? { revenue: 0, txns: 0 };
      buckets.push({
        dow,
        hour,
        avgRevenue: roundMoney(cell.revenue / safeWeeks),
        txns: cell.txns,
      });
    }
  }

  return buckets;
}

export function formatHourOfDayTooltip(dow: number, hour: number, avgRevenue: number, txns: number): string {
  const hh = String(hour).padStart(2, "0");
  return `${dowLabel(dow)} ${hh}:00 — £${avgRevenue.toFixed(0)} avg, ${txns} order${txns === 1 ? "" : "s"}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
