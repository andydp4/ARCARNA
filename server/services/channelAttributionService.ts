import { db } from "../db";
import { orders } from "@shared/schema";
import { aggregateChannelAttribution } from "@shared/analytics/channelAttribution";
import { and, eq, gte } from "drizzle-orm";

export async function getChannelAttribution(orgId: string, days: number) {
  const safeDays = Math.min(Math.max(1, days), 365);
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - safeDays);

  const rows = await db
    .select({
      channel: orders.channel,
      total: orders.total,
      status: orders.status,
    })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, windowStart)));

  const channels = aggregateChannelAttribution(
    rows
      .filter((r): r is typeof r & { status: string } => !!r.status)
      .map((r) => ({
        channel: r.channel ?? "pos",
        total: r.total,
        status: r.status,
      })),
  );

  return { channels, days: safeDays };
}
