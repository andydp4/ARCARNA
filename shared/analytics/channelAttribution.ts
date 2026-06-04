export type ChannelAttributionRow = {
  channel: string;
  orderCount: number;
  revenue: number;
  aov: number;
  sharePct: number;
};

export function normalizeChannel(raw: string | null | undefined): string {
  const c = (raw ?? "pos").trim().toLowerCase();
  return c || "pos";
}

export function aggregateChannelAttribution(
  orders: Array<{ channel: string; total: string | number; status: string }>,
): ChannelAttributionRow[] {
  const byChannel = new Map<string, { count: number; revenue: number }>();

  for (const o of orders) {
    if (o.status !== "completed") continue;
    const total = typeof o.total === "string" ? parseFloat(o.total) : o.total;
    if (!Number.isFinite(total) || total <= 0) continue;
    const ch = normalizeChannel(o.channel);
    const cur = byChannel.get(ch) ?? { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += total;
    byChannel.set(ch, cur);
  }

  const totalRevenue = [...byChannel.values()].reduce((s, v) => s + v.revenue, 0);

  return [...byChannel.entries()]
    .map(([channel, { count, revenue }]) => ({
      channel,
      orderCount: count,
      revenue: Math.round(revenue * 100) / 100,
      aov: count > 0 ? Math.round((revenue / count) * 100) / 100 : 0,
      sharePct: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}
