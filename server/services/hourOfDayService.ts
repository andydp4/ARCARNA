import { db } from "../db";
import { orders, organizations } from "@shared/schema";
import { aggregateHourOfDay, type HourOfDayBucket } from "@shared/analytics/hourOfDay";
import { and, eq, gte, sql } from "drizzle-orm";

export async function getHourOfDayAnalytics(orgId: string, weeks: number): Promise<{
  buckets: HourOfDayBucket[];
  weeks: number;
  timezone: string;
}> {
  const safeWeeks = Math.min(Math.max(1, weeks), 52);
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - safeWeeks * 7);

  const [org] = await db
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  const tz = org?.timezone ?? "Europe/London";

  const rows = await db
    .select({
      createdAt: orders.createdAt,
      total: orders.total,
      status: orders.status,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        eq(orders.status, "completed"),
        gte(orders.createdAt, windowStart),
        sql`${orders.total}::numeric > 0`,
      ),
    );

  const buckets = aggregateHourOfDay(
    rows
      .filter((r): r is typeof r & { createdAt: Date; status: string } => !!r.createdAt && !!r.status)
      .map((r) => ({
        createdAt: r.createdAt,
        total: r.total,
        status: r.status,
      })),
    safeWeeks,
    (date) => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        weekday: "short",
        hour: "numeric",
        hour12: false,
      }).formatToParts(date);

      const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
      const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
      const dowMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      return { dow: dowMap[weekday] ?? 0, hour: parseInt(hourPart, 10) || 0 };
    },
  );

  return { buckets, weeks: safeWeeks, timezone: tz };
}
