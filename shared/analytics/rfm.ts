export type RfmSegment =
  | "Champions"
  | "Loyal"
  | "At-Risk"
  | "Lost"
  | "New"
  | "Promising";

export const RFM_SEGMENTS: RfmSegment[] = [
  "Champions",
  "Loyal",
  "Promising",
  "At-Risk",
  "Lost",
  "New",
];

export type RfmCustomerInput = {
  customerId: string;
  orderCount: number;
  totalSpent: number;
  /** Days since last order; null if never ordered */
  recencyDays: number | null;
};

export type RfmScore = {
  customerId: string;
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
  segment: RfmSegment;
};

/** Assign segment from R/F/M scores and order count (standard RFM map). */
export function assignSegment(
  r: number,
  f: number,
  m: number,
  orderCount: number,
): RfmSegment {
  if (orderCount === 1 && r === 5) return "New";
  if (r === 5 && f >= 4 && m >= 4) return "Champions";
  if (f >= 4 && m >= 3 && r >= 3) return "Loyal";
  if (r >= 4 && f <= 2) return "Promising";
  if (r <= 2 && f >= 3 && m >= 3) return "At-Risk";
  if (r <= 2 && f <= 2) return "Lost";
  if (r >= 3 && f >= 3) return "Loyal";
  if (r >= 3) return "Promising";
  return "At-Risk";
}

function quintileScore(sortedValues: number[], value: number, higherIsBetter: boolean): number {
  if (sortedValues.length === 0) return 1;
  const unique = [...new Set(sortedValues)].sort((a, b) => a - b);
  if (unique.length === 1) return 3;

  const rank = sortedValues.filter((v) => (higherIsBetter ? v <= value : v >= value)).length;
  const pct = rank / sortedValues.length;
  if (pct >= 0.8) return 5;
  if (pct >= 0.6) return 4;
  if (pct >= 0.4) return 3;
  if (pct >= 0.2) return 2;
  return 1;
}

/** Compute RFM scores for all customers in an org from aggregated order stats. */
export function computeRfmScores(customers: RfmCustomerInput[]): RfmScore[] {
  if (customers.length === 0) return [];

  const withOrders = customers.filter((c) => c.orderCount > 0 && c.recencyDays !== null);
  if (withOrders.length === 0) {
    return customers.map((c) => ({
      customerId: c.customerId,
      recencyScore: 1,
      frequencyScore: 1,
      monetaryScore: 1,
      segment: "Lost" as RfmSegment,
    }));
  }

  const recencyValues = withOrders.map((c) => c.recencyDays as number);
  const frequencyValues = withOrders.map((c) => c.orderCount);
  const monetaryValues = withOrders.map((c) => c.totalSpent);

  return customers.map((c) => {
    if (c.orderCount === 0 || c.recencyDays === null) {
      return {
        customerId: c.customerId,
        recencyScore: 1,
        frequencyScore: 1,
        monetaryScore: 1,
        segment: "Lost" as RfmSegment,
      };
    }

    const r = quintileScore(recencyValues, c.recencyDays, false);
    const f = quintileScore(frequencyValues, c.orderCount, true);
    const m = quintileScore(monetaryValues, c.totalSpent, true);

    return {
      customerId: c.customerId,
      recencyScore: r,
      frequencyScore: f,
      monetaryScore: m,
      segment: assignSegment(r, f, m, c.orderCount),
    };
  });
}

export type RfmHeatmapCell = {
  r: number;
  f: number;
  count: number;
  avgMonetary: number;
};

/** Build 5×5 R×F heatmap cells coloured by average monetary score. */
export function buildRfmHeatmap(scores: RfmScore[], monetaryByCustomer: Map<string, number>): RfmHeatmapCell[] {
  const cells: RfmHeatmapCell[] = [];
  for (let r = 1; r <= 5; r++) {
    for (let f = 1; f <= 5; f++) {
      const inCell = scores.filter((s) => s.recencyScore === r && s.frequencyScore === f);
      const avgMonetary =
        inCell.length > 0
          ? inCell.reduce((sum, s) => sum + (monetaryByCustomer.get(s.customerId) ?? 0), 0) / inCell.length
          : 0;
      cells.push({ r, f, count: inCell.length, avgMonetary: Math.round(avgMonetary * 100) / 100 });
    }
  }
  return cells;
}

export function segmentCounts(scores: RfmScore[]): Record<RfmSegment, number> {
  const counts = Object.fromEntries(RFM_SEGMENTS.map((s) => [s, 0])) as Record<RfmSegment, number>;
  for (const s of scores) {
    counts[s.segment] = (counts[s.segment] ?? 0) + 1;
  }
  return counts;
}
