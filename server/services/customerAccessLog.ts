/**
 * The customer data access log (v1.2 Phase 6, PRV-10).
 *
 * One table for every look at, or change to, a customer's contact details: a
 * reveal inside a grant, the driver's call, "Use saved address", a replaced
 * number, an export, a request and its decision, a message sent without
 * showing the number, an emailed invoice and an API key reading contact
 * details. Admins read one customer's rows ("Access history"); the owner reads
 * the whole org's and gets a weekly line.
 *
 * `recordCustomerAccess` throws when the row cannot be written. That is on
 * purpose: a reveal whose log fails is refused (the caller writes the row
 * first and only then reads the value).
 */
import type { Request } from "express";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { customerAccessLog, customers, orgNotifications, type InsertCustomerAccessLog } from "@shared/schema";
import { weeklyAccessLine, type AccessAction, type AccessCounts } from "@shared/contactAccess";
import { resolveUserNames } from "./userDisplayName";
import { orgTimeZone } from "./tradingDayShift";
import { weekKeyFor } from "@shared/review/exceptions";
import { notify } from "./signals";

type Executor = typeof db | any;

export type AccessEntry = {
  orgId: string;
  customerId: string | null;
  actorUserId: string;
  actorRole: string;
  action: AccessAction;
  field?: string | null;
  requestId?: string | null;
  orderId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Who and where, from the request, for the rows a route writes. */
export function accessActor(req: Request | any): { actorUserId: string; actorRole: string; ipAddress?: string; userAgent?: string } {
  const rawIp: string | undefined = req?.ip ?? req?.socket?.remoteAddress;
  return {
    actorUserId: String(req?.user?.id ?? "unknown"),
    actorRole: String(req?.orgContext?.role ?? req?.user?.role ?? "UNKNOWN").slice(0, 16),
    ipAddress: rawIp ? rawIp.replace(/^::ffff:/, "").slice(0, 64) : undefined,
    userAgent: typeof req?.get === "function" ? req.get("user-agent") ?? undefined : undefined,
  };
}

/** Writes the rows, or throws. Several rows (an export) go in one statement. */
export async function recordCustomerAccess(
  entries: AccessEntry | AccessEntry[],
  where: { ipAddress?: string; userAgent?: string } = {},
  client: Executor = db,
): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  const rows: InsertCustomerAccessLog[] = list.map((e) => ({
    orgId: e.orgId,
    customerId: e.customerId,
    actorUserId: e.actorUserId.slice(0, 255),
    actorRole: e.actorRole.slice(0, 16),
    action: e.action,
    field: e.field ?? null,
    requestId: e.requestId ?? null,
    orderId: e.orderId ?? null,
    metadata: e.metadata ?? null,
    ipAddress: where.ipAddress ?? null,
    userAgent: where.userAgent ?? null,
  }));
  // Large exports are chunked so one statement stays well inside Postgres's parameter limit.
  for (let i = 0; i < rows.length; i += 500) {
    await client.insert(customerAccessLog).values(rows.slice(i, i + 500));
  }
}

/**
 * The same, from a route: the actor and address come from the request. For
 * logs that must not stop the thing being logged (an export already built,
 * an API read) the caller decides whether to await or catch.
 */
export async function recordAccessFromRequest(
  req: any,
  entries: Array<Omit<AccessEntry, "actorUserId" | "actorRole">> | Omit<AccessEntry, "actorUserId" | "actorRole">,
  client: Executor = db,
): Promise<void> {
  const actor = accessActor(req);
  const list = Array.isArray(entries) ? entries : [entries];
  await recordCustomerAccess(
    list.map((e) => ({ ...e, actorUserId: actor.actorUserId, actorRole: actor.actorRole })),
    { ipAddress: actor.ipAddress, userAgent: actor.userAgent },
    client,
  );
}

export type AccessLogItem = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  action: string;
  field: string | null;
  requestId: string | null;
  orderId: string | null;
  metadata: unknown;
  createdAt: Date;
};

async function withNames(
  rows: Array<typeof customerAccessLog.$inferSelect & { customerName: string | null }>,
): Promise<AccessLogItem[]> {
  const names = await resolveUserNames([...new Set(rows.map((r) => r.actorUserId))]);
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    customerName: r.customerName,
    actorUserId: r.actorUserId,
    actorName: names.get(r.actorUserId) ?? (r.actorUserId.startsWith("api-key:") ? "API key" : "Unknown"),
    actorRole: r.actorRole,
    action: r.action,
    field: r.field,
    requestId: r.requestId,
    orderId: r.orderId,
    metadata: r.metadata,
    createdAt: r.createdAt,
  }));
}

/** One customer's Access history (admins, PRV-10). Newest first. */
export async function customerAccessHistory(orgId: string, customerId: string, limit = 200): Promise<AccessLogItem[]> {
  const rows = await db
    .select({ row: customerAccessLog, customerName: customers.name })
    .from(customerAccessLog)
    .leftJoin(customers, eq(customers.id, customerAccessLog.customerId))
    .where(and(eq(customerAccessLog.orgId, orgId), eq(customerAccessLog.customerId, customerId)))
    .orderBy(desc(customerAccessLog.createdAt), desc(customerAccessLog.id))
    .limit(Math.min(Math.max(limit, 1), 500));
  return withNames(rows.map((r: any) => ({ ...r.row, customerName: r.customerName })));
}

/** The whole org's log (the owner's page, Q13a). Newest first, optionally one action or one person. */
export async function orgAccessLog(
  orgId: string,
  filter: { action?: string | null; actorUserId?: string | null; from?: Date | null; to?: Date | null; limit?: number } = {},
): Promise<AccessLogItem[]> {
  const conds = [eq(customerAccessLog.orgId, orgId)];
  if (filter.action) conds.push(eq(customerAccessLog.action, filter.action));
  if (filter.actorUserId) conds.push(eq(customerAccessLog.actorUserId, filter.actorUserId));
  if (filter.from) conds.push(gte(customerAccessLog.createdAt, filter.from));
  if (filter.to) conds.push(lt(customerAccessLog.createdAt, filter.to));
  const rows = await db
    .select({ row: customerAccessLog, customerName: customers.name })
    .from(customerAccessLog)
    .leftJoin(customers, eq(customers.id, customerAccessLog.customerId))
    .where(and(...conds))
    .orderBy(desc(customerAccessLog.createdAt), desc(customerAccessLog.id))
    .limit(Math.min(Math.max(filter.limit ?? 300, 1), 1000));
  return withNames(rows.map((r: any) => ({ ...r.row, customerName: r.customerName })));
}

/** Counts per action in a window, for the weekly line. */
export async function accessCounts(orgId: string, from: Date, to: Date, client: Executor = db): Promise<AccessCounts> {
  const rows: Array<{ action: string; n: number }> = await client
    .select({ action: customerAccessLog.action, n: sql<number>`COUNT(*)::int` })
    .from(customerAccessLog)
    .where(and(eq(customerAccessLog.orgId, orgId), gte(customerAccessLog.createdAt, from), lt(customerAccessLog.createdAt, to)))
    .groupBy(customerAccessLog.action);
  const out: AccessCounts = {};
  for (const r of rows) out[r.action as AccessAction] = Number(r.n) || 0;
  return out;
}

/** The weekly line goes out on Mondays from this local hour, like Needs a look's. */
export const ACCESS_WEEKLY_HOUR = 9;

/**
 * The owner's weekly line (PRV-10): on Monday morning, per org that had any
 * customer data activity in the last seven days, one Signal to the owner.
 * Exactly once per org per week, under an advisory lock.
 */
export async function runWeeklyCustomerAccessLine(now: Date = new Date()): Promise<number> {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const orgRows: Array<{ orgId: string }> = await db
    .selectDistinct({ orgId: customerAccessLog.orgId })
    .from(customerAccessLog)
    .where(and(gte(customerAccessLog.createdAt, from), lt(customerAccessLog.createdAt, now)));
  let sent = 0;
  for (const { orgId } of orgRows) {
    const tz = await orgTimeZone(orgId);
    const week = weekKeyFor(now, tz);
    if (week.weekday !== 1 || week.hour < ACCESS_WEEKLY_HOUR) continue;
    sent += await db.transaction(async (tx: Executor) => {
      const lockKey = `customer_access_weekly:${orgId}:${week.key}`;
      const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS got`);
      const got = (lock as any).rows?.[0]?.got ?? (lock as any)[0]?.got;
      if (!got) return 0;
      const [already] = await tx
        .select({ id: orgNotifications.id })
        .from(orgNotifications)
        .where(
          and(
            eq(orgNotifications.orgId, orgId),
            eq(orgNotifications.source, "customer_access_weekly"),
            sql`${orgNotifications.metadata}->>'week' = ${week.key}`,
          ),
        )
        .limit(1);
      if (already) return 0;
      const counts = await accessCounts(orgId, from, now, tx);
      await notify(
        {
          orgId,
          title: "Customer data this week",
          message: weeklyAccessLine(counts),
          severity: "info",
          source: "customer_access_weekly",
          metadata: { week: week.key, counts },
        },
        tx,
      );
      return 1;
    });
  }
  return sent;
}
