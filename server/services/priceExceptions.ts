import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { orders, priceExceptions, products, users } from "@shared/schema";
import { currentTradingDay, shiftIsoDate, tradingDayBounds } from "@shared/time/tradingDay";

/**
 * "Would have flagged" (v1.2 Phase 2, PRC-03, CMP-03): the underpriced sales
 * the order engine recorded silently, by product and by person, with £ under
 * list and £ under cost. Admin only — managers do not review flags about
 * themselves. Nothing here is shown at the till.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The recording runs silently for two weeks before the till shows anything. */
export const WOULD_HAVE_FLAGGED_DEFAULT_DAYS = 14;

export function wouldHaveFlaggedRange(query: Record<string, unknown>, timeZone: string) {
  const day = (v: unknown) => (typeof v === "string" && ISO_DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
  const toIso = day(query.to) ?? currentTradingDay(timeZone);
  const fromIso = day(query.from) ?? shiftIsoDate(toIso, -(WOULD_HAVE_FLAGGED_DEFAULT_DAYS - 1));
  return {
    fromIso,
    toIso,
    start: tradingDayBounds(fromIso, timeZone).start,
    end: tradingDayBounds(toIso, timeZone).end,
  };
}

export type FlaggedGroup = {
  key: string;
  name: string;
  lines: number;
  units: number;
  belowMinimum: number;
  belowCost: number;
  underList: number;
  underCost: number;
};

export type WouldHaveFlagged = {
  period: { from: string; to: string };
  totals: Omit<FlaggedGroup, "key" | "name">;
  byProduct: FlaggedGroup[];
  byPerson: FlaggedGroup[];
};

const n = (v: unknown) => Number(v) || 0;
const money = (v: unknown) => Math.round(n(v) * 100) / 100;

export async function wouldHaveFlagged(
  orgId: string,
  range: ReturnType<typeof wouldHaveFlaggedRange>,
): Promise<WouldHaveFlagged> {
  const cond = and(
    eq(priceExceptions.orgId, orgId),
    gte(priceExceptions.createdAt, range.start),
    lt(priceExceptions.createdAt, range.end),
  );
  const measures = {
    lines: sql<number>`COUNT(*)`,
    units: sql<number>`COALESCE(SUM(${priceExceptions.quantity}), 0)`,
    belowMinimum: sql<number>`COUNT(*) FILTER (WHERE ${priceExceptions.belowMinimum})`,
    belowCost: sql<number>`COUNT(*) FILTER (WHERE ${priceExceptions.belowCost})`,
    underList: sql<number>`COALESCE(SUM(${priceExceptions.underList}), 0)`,
    underCost: sql<number>`COALESCE(SUM(${priceExceptions.underCost}), 0)`,
  };
  const shape = (r: Record<string, unknown>) => ({
    lines: n(r.lines),
    units: n(r.units),
    belowMinimum: n(r.belowMinimum),
    belowCost: n(r.belowCost),
    underList: money(r.underList),
    underCost: money(r.underCost),
  });

  const productRows = await db
    .select({ productId: priceExceptions.productId, name: products.name, ...measures })
    .from(priceExceptions)
    .leftJoin(products, eq(priceExceptions.productId, products.id))
    .where(cond)
    .groupBy(priceExceptions.productId, products.name)
    .orderBy(desc(sql`COALESCE(SUM(${priceExceptions.underList}), 0)`));

  // The person who set the price: recorded with the line, or for a sale the
  // order's own "loaded by" when the caller did not pass one (the API).
  const person = sql<string | null>`COALESCE(${priceExceptions.userId}, ${orders.inputUserId})`;
  const personRows = await db
    .select({
      userId: person,
      channel: sql<string | null>`MIN(${priceExceptions.channel})`,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      ...measures,
    })
    .from(priceExceptions)
    .innerJoin(orders, eq(priceExceptions.orderId, orders.id))
    .leftJoin(users, eq(users.id, person))
    .where(cond)
    .groupBy(person, users.firstName, users.lastName, users.email)
    .orderBy(desc(sql`COALESCE(SUM(${priceExceptions.underList}), 0)`));

  const byProduct: FlaggedGroup[] = productRows.map((r) => ({
    key: r.productId ?? "deleted",
    name: r.name ?? "Deleted product",
    ...shape(r),
  }));
  const byPerson: FlaggedGroup[] = personRows.map((r) => {
    const full = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
    const fallback = r.channel === "api" ? "API" : "Unknown";
    return { key: r.userId ?? "unknown", name: full || r.email || (r.userId ? r.userId : fallback), ...shape(r) };
  });

  const totals = byProduct.reduce(
    (t, g) => ({
      lines: t.lines + g.lines,
      units: t.units + g.units,
      belowMinimum: t.belowMinimum + g.belowMinimum,
      belowCost: t.belowCost + g.belowCost,
      underList: money(t.underList + g.underList),
      underCost: money(t.underCost + g.underCost),
    }),
    { lines: 0, units: 0, belowMinimum: 0, belowCost: 0, underList: 0, underCost: 0 },
  );

  return { period: { from: range.fromIso, to: range.toIso }, totals, byProduct, byPerson };
}
