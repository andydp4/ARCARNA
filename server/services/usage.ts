/**
 * Our own usage record and Friction Truths (v1.2 Phase 8B/8C: UXA-07, UXA-08,
 * UXA-13).
 *
 *  - recordUsageBatch: a till's batch, shaped again here, within a per-device
 *    limit (the tills share one address, so an IP limit would be one bucket).
 *  - rollupUsage: raw events into daily summaries, per shop in its own zone.
 *  - purgeUsage: raw events after 90 days, summaries after 24 months.
 *  - frictionTruths: the owner's page.
 *  - runWeeklyFrictionTopFive: the Monday top five, to the owner alone,
 *    held back until three weeks of data exist.
 *
 * Nothing here reads or writes a user id (owner decision Q18): the events
 * carry a role and a device name, and nothing is ever joined to a person.
 */
import { and, count as countFn, desc, eq, gte, max, sql } from "drizzle-orm";
import { db } from "../db";
import { orgNotifications, problemReports, usageDaily, usageEvents, usageStudyWindows } from "@shared/schema";
import {
  DEVICE_EVENTS_PER_HOUR,
  ORG_EVENTS_PER_HOUR,
  emptyTotals,
  fixCheckLine,
  FUNNEL_STEPS,
  hasEnoughData,
  daysOfData,
  lastWeekRange,
  normaliseStudyWindow,
  normaliseUsageEvent,
  painLeaderboard,
  pickTopFive,
  RAW_RETENTION_DAYS,
  scoreScreen,
  SCREEN_CONTINUED,
  SUMMARY_RETENTION_MONTHS,
  topFiveLine,
  usageDevice,
  usageVersion,
  weeklyAllowed,
  WEEKLY_HOUR,
  ENOUGH_DATA_DAYS,
  type FixCheck,
  type ScoredScreen,
  type ScreenTotals,
  type StudyWindow,
  type StudyWindowInput,
  type UsageBatchInput,
} from "@shared/usage";
import { localCalendarDate, shiftIsoDate } from "@shared/time/tradingDay";
import { weekKeyFor } from "@shared/review/exceptions";
import { notify } from "./signals";
import { orgTimeZone } from "./tradingDayShift";

type Executor = typeof db | any;

export class UsageError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function rowsOf<T = any>(res: any): T[] {
  return (res?.rows ?? res ?? []) as T[];
}

async function tryLock(tx: Executor, key: string): Promise<boolean> {
  const res = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS got`);
  return !!rowsOf<{ got: boolean }>(res)[0]?.got;
}

/** The local calendar date of a timestamp column, in the shop's zone. */
const localDay = (tz: string) => sql`((${usageEvents.occurredAt} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;

// ---------------------------------------------------------------------------
// Ingest.
// ---------------------------------------------------------------------------

export async function recordUsageBatch(args: {
  orgId: string;
  role: string;
  input: UsageBatchInput;
  now?: Date;
}): Promise<{ accepted: number; dropped: number; limited: boolean }> {
  const { orgId, role, input } = args;
  const now = args.now ?? new Date();
  const rows = input.events.map((e) => normaliseUsageEvent(e, now)).filter((r) => r !== null);
  const dropped = input.events.length - rows.length;
  if (rows.length === 0) return { accepted: 0, dropped, limited: false };

  const device = usageDevice(input.device);
  const appVersion = usageVersion(input.appVersion);

  return db.transaction(async (tx: Executor) => {
    // Two batches from one shop at once must not both squeeze under a limit
    // (the shop's lock covers its devices too; batches are a few a minute).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`usage_org:${orgId}`}))`);
    const since = new Date(now.getTime() - 3_600_000);
    // The shop's own cap first: the device key is the till's word, so a fresh
    // key must not buy a fresh allowance.
    const [{ n: shopN }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(usageEvents)
      .where(and(eq(usageEvents.orgId, orgId), gte(usageEvents.receivedAt, since)));
    const shopRoom = ORG_EVENTS_PER_HOUR - Number(shopN);
    if (shopRoom <= 0) {
      throw new UsageError(429, "shop_limit", "This shop has sent its usage for this hour. It will send the rest later.");
    }
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(usageEvents)
      .where(and(eq(usageEvents.orgId, orgId), eq(usageEvents.deviceKey, input.deviceKey), gte(usageEvents.receivedAt, since)));
    const room = Math.min(DEVICE_EVENTS_PER_HOUR - Number(n), shopRoom);
    if (room <= 0) {
      throw new UsageError(429, "device_limit", "This device has sent its usage for this hour. It will send the rest later.");
    }
    const kept = rows.slice(0, room);
    await tx.insert(usageEvents).values(
      kept.map((r) => ({
        orgId,
        kind: r.kind,
        role,
        device,
        deviceKey: input.deviceKey,
        appVersion,
        screen: r.screen,
        label: r.label,
        activeMs: r.activeMs,
        openMs: r.openMs,
        durationMs: r.durationMs,
        slow: r.slow,
        failed: r.failed,
        occurredAt: r.occurredAt,
        receivedAt: now,
      })),
    );
    return { accepted: kept.length, dropped: dropped + (rows.length - kept.length), limited: kept.length < rows.length };
  });
}

// ---------------------------------------------------------------------------
// Daily summaries and retention.
// ---------------------------------------------------------------------------

/**
 * Count new raw events into usage_daily. Any day that gained events is
 * recomputed whole from the raw rows, so a batch that arrives late (a till
 * that was offline) lands in the right day without double counting.
 */
export async function rollupUsage(onlyOrgId?: string): Promise<number> {
  const orgs: Array<{ orgId: string }> = onlyOrgId
    ? [{ orgId: onlyOrgId }]
    : await db.selectDistinct({ orgId: usageEvents.orgId }).from(usageEvents).where(eq(usageEvents.rolled, false));
  let days = 0;
  for (const { orgId } of orgs) {
    const tz = await orgTimeZone(orgId);
    days += await db.transaction(async (tx: Executor) => {
      if (!(await tryLock(tx, `usage_rollup:${orgId}`))) return 0;
      const touched = rowsOf<{ day: string }>(
        await tx.execute(sql`
          WITH m AS (
            UPDATE usage_events SET rolled = true
            WHERE org_id = ${orgId} AND rolled = false
            RETURNING occurred_at
          )
          SELECT DISTINCT ((occurred_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date::text AS day FROM m
        `),
      ).map((r) => r.day);
      if (touched.length === 0) return 0;
      const dayList = sql.join(touched.map((d) => sql`${d}::date`), sql`, `);
      await tx.execute(sql`DELETE FROM usage_daily WHERE org_id = ${orgId} AND day IN (${dayList})`);
      // The day bounds keep the scan on the (org_id, occurred_at) index; the
      // local-day test then picks the exact days (a day is at most 26 h of UTC).
      const lo = `${touched.reduce((a, b) => (a < b ? a : b))}T00:00:00Z`;
      const hi = `${shiftIsoDate(touched.reduce((a, b) => (a > b ? a : b)), 2)}T00:00:00Z`;
      await tx.execute(sql`
        INSERT INTO usage_daily (org_id, day, kind, role, device, screen, label, count, active_ms, open_ms, duration_ms, slow, failed)
        SELECT org_id, ${localDay(tz)} AS day, kind, role, device, screen, label,
               count(*)::int, COALESCE(sum(active_ms), 0), COALESCE(sum(open_ms), 0), COALESCE(sum(duration_ms), 0),
               (count(*) FILTER (WHERE slow))::int, (count(*) FILTER (WHERE failed))::int
        FROM usage_events
        WHERE org_id = ${orgId}
          AND occurred_at >= (${lo}::timestamptz AT TIME ZONE 'UTC') - interval '1 day'
          AND occurred_at < (${hi}::timestamptz AT TIME ZONE 'UTC')
          AND ${localDay(tz)} IN (${dayList})
        GROUP BY org_id, 2, kind, role, device, screen, label
      `);
      return touched.length;
    });
  }
  return days;
}

/** Raw events after 90 days, summaries after 24 months. Rolls up first so nothing is lost uncounted. */
export async function purgeUsage(now: Date = new Date()): Promise<{ events: number; summaries: number }> {
  await rollupUsage();
  const rawCut = new Date(now.getTime() - RAW_RETENTION_DAYS * 86_400_000);
  const ev = await db.execute(sql`DELETE FROM usage_events WHERE occurred_at < ${rawCut.toISOString()}::timestamptz AT TIME ZONE 'UTC'`);
  const summaryCut = new Date(now);
  summaryCut.setUTCMonth(summaryCut.getUTCMonth() - SUMMARY_RETENTION_MONTHS);
  const sm = await db.execute(sql`DELETE FROM usage_daily WHERE day < ${summaryCut.toISOString().slice(0, 10)}::date`);
  return { events: Number((ev as any).rowCount ?? 0), summaries: Number((sm as any).rowCount ?? 0) };
}

// ---------------------------------------------------------------------------
// Reading the summaries.
// ---------------------------------------------------------------------------

type DailyAgg = {
  kind: string;
  role: string;
  screen: string;
  label: string;
  count: number;
  activeMs: number;
  openMs: number;
  durationMs: number;
  slow: number;
  failed: number;
};

async function dailyAgg(orgId: string, from: string, to: string, client: Executor = db): Promise<DailyAgg[]> {
  const rows = await client
    .select({
      kind: usageDaily.kind,
      role: usageDaily.role,
      screen: usageDaily.screen,
      label: usageDaily.label,
      count: sql<number>`sum(${usageDaily.count})::int`,
      activeMs: sql<number>`sum(${usageDaily.activeMs})::bigint`,
      openMs: sql<number>`sum(${usageDaily.openMs})::bigint`,
      durationMs: sql<number>`sum(${usageDaily.durationMs})::bigint`,
      slow: sql<number>`sum(${usageDaily.slow})::int`,
      failed: sql<number>`sum(${usageDaily.failed})::int`,
    })
    .from(usageDaily)
    .where(and(eq(usageDaily.orgId, orgId), sql`${usageDaily.day} BETWEEN ${from}::date AND ${to}::date`))
    .groupBy(usageDaily.kind, usageDaily.role, usageDaily.screen, usageDaily.label);
  return rows.map((r: any) => ({
    ...r,
    count: Number(r.count) || 0,
    activeMs: Number(r.activeMs) || 0,
    openMs: Number(r.openMs) || 0,
    durationMs: Number(r.durationMs) || 0,
    slow: Number(r.slow) || 0,
    failed: Number(r.failed) || 0,
  }));
}

/** Problem? reports per screen, by the local date they were sent. */
async function problemsByScreen(orgId: string, tz: string, from: string, to: string, client: Executor = db): Promise<Map<string, number>> {
  const day = sql`((${problemReports.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;
  const rows: Array<{ screen: string; n: number }> = await client
    .select({ screen: problemReports.screen, n: sql<number>`count(*)::int` })
    .from(problemReports)
    .where(and(eq(problemReports.orgId, orgId), sql`${day} BETWEEN ${from}::date AND ${to}::date`))
    .groupBy(problemReports.screen);
  return new Map(rows.map((r) => [r.screen, Number(r.n) || 0]));
}

export function screenTotalsFrom(agg: DailyAgg[], problems: Map<string, number>): ScreenTotals[] {
  const by = new Map<string, ScreenTotals>();
  const get = (screen: string) => {
    let t = by.get(screen);
    if (!t) by.set(screen, (t = emptyTotals(screen)));
    return t;
  };
  for (const r of agg) {
    if (!r.screen) continue;
    const t = get(r.screen);
    if (r.kind === "screen") {
      t.activeMs += r.activeMs;
      t.openMs += r.openMs;
      if (r.label !== SCREEN_CONTINUED) t.views += r.count;
    } else if (r.kind === "crash") t.crashes += r.count;
    else if (r.kind === "message") t.errorMessages += r.failed;
    else if (r.kind === "call") {
      t.failedCalls += r.failed;
      t.slowCalls += r.slow;
    }
  }
  for (const [screen, n] of problems) get(screen).problems += n;
  return [...by.values()];
}

async function firstDayOf(orgId: string, client: Executor = db): Promise<string | null> {
  const [row] = await client
    .select({ first: sql<string | null>`min(${usageDaily.day})::text` })
    .from(usageDaily)
    .where(eq(usageDaily.orgId, orgId));
  return row?.first ?? null;
}

export type DeviceHealth = {
  device: string;
  devices: number;
  lastSeen: Date | null;
  appVersion: string | null;
  crashes: number;
  offlineMinutes: number;
  offlineTimes: number;
  failedCalls: number;
  slowCalls: number;
};

/** The last 7 days per device name, from the raw events. */
export async function deviceHealth(orgId: string, now: Date = new Date()): Promise<DeviceHealth[]> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const rows = await db
    .select({
      device: usageEvents.device,
      devices: sql<number>`count(DISTINCT ${usageEvents.deviceKey})::int`,
      lastSeen: max(usageEvents.receivedAt),
      appVersion: sql<string | null>`(array_agg(${usageEvents.appVersion} ORDER BY ${usageEvents.receivedAt} DESC))[1]`,
      crashes: sql<number>`(count(*) FILTER (WHERE ${usageEvents.kind} = 'crash'))::int`,
      offlineMs: sql<number>`COALESCE(sum(${usageEvents.durationMs}) FILTER (WHERE ${usageEvents.kind} = 'offline'), 0)::bigint`,
      offlineTimes: sql<number>`(count(*) FILTER (WHERE ${usageEvents.kind} = 'offline'))::int`,
      failedCalls: sql<number>`(count(*) FILTER (WHERE ${usageEvents.kind} = 'call' AND ${usageEvents.failed}))::int`,
      slowCalls: sql<number>`(count(*) FILTER (WHERE ${usageEvents.kind} = 'call' AND ${usageEvents.slow}))::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.orgId, orgId), gte(usageEvents.occurredAt, since)))
    .groupBy(usageEvents.device)
    .orderBy(usageEvents.device);
  return rows.map((r: any) => ({
    device: r.device,
    devices: Number(r.devices) || 0,
    lastSeen: r.lastSeen ?? null,
    appVersion: r.appVersion ?? null,
    crashes: Number(r.crashes) || 0,
    offlineMinutes: Math.round((Number(r.offlineMs) || 0) / 60_000),
    offlineTimes: Number(r.offlineTimes) || 0,
    failedCalls: Number(r.failedCalls) || 0,
    slowCalls: Number(r.slowCalls) || 0,
  }));
}

export type FrictionTruths = {
  range: { from: string; to: string; weeks: number };
  enoughData: boolean;
  daysOfData: number;
  daysNeeded: number;
  pain: ScoredScreen[] | null;
  messages: Array<{ title: string; count: number; errors: number; screens: number; topScreen: string }> | null;
  roles: Array<{ role: string; activeHours: number; openHours: number; views: number }> | null;
  funnel: Array<{ role: string; steps: Record<string, number> }> | null;
  slowCalls: Array<{ call: string; slow: number; failed: number; avgMs: number; topScreen: string }> | null;
  devices: DeviceHealth[];
  problemsOpen: number;
};

const hours = (ms: number) => Math.round((ms / 3_600_000) * 100) / 100;

export async function frictionTruths(orgId: string, opts: { weeks?: number; now?: Date } = {}): Promise<FrictionTruths> {
  const now = opts.now ?? new Date();
  const weeks = [1, 2, 4, 12, 52].includes(opts.weeks ?? 4) ? (opts.weeks ?? 4) : 4;
  await rollupUsage(orgId);
  const tz = await orgTimeZone(orgId);
  const today = localCalendarDate(now, tz);
  const from = shiftIsoDate(today, -(weeks * 7 - 1));
  const first = await firstDayOf(orgId);
  const enoughData = hasEnoughData(first, today);
  const [{ n: problemsOpen }] = await db
    .select({ n: countFn() })
    .from(problemReports)
    .where(and(eq(problemReports.orgId, orgId), eq(problemReports.status, "open")));
  const base = {
    range: { from, to: today, weeks },
    enoughData,
    daysOfData: daysOfData(first, today),
    daysNeeded: ENOUGH_DATA_DAYS,
    devices: await deviceHealth(orgId, now),
    problemsOpen: Number(problemsOpen) || 0,
  };
  // The first two weeks rank nothing: a handful of hours makes any screen look terrible.
  if (!enoughData) return { ...base, pain: null, messages: null, roles: null, funnel: null, slowCalls: null };

  const agg = await dailyAgg(orgId, from, today);
  const pain = painLeaderboard(screenTotalsFrom(agg, await problemsByScreen(orgId, tz, from, today))).slice(0, 20);

  const topScreenOf = (rows: DailyAgg[], weight: (r: DailyAgg) => number) => {
    const by = new Map<string, number>();
    for (const r of rows) by.set(r.screen, (by.get(r.screen) ?? 0) + weight(r));
    return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };

  const msgBy = new Map<string, DailyAgg[]>();
  for (const r of agg.filter((r) => r.kind === "message")) msgBy.set(r.label, [...(msgBy.get(r.label) ?? []), r]);
  const messages = [...msgBy.entries()]
    .map(([title, rows]) => ({
      title,
      count: rows.reduce((s, r) => s + r.count, 0),
      errors: rows.reduce((s, r) => s + r.failed, 0),
      screens: new Set(rows.map((r) => r.screen)).size,
      topScreen: topScreenOf(rows, (r) => r.count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const roleBy = new Map<string, { activeMs: number; openMs: number; views: number }>();
  for (const r of agg.filter((r) => r.kind === "screen")) {
    const t = roleBy.get(r.role) ?? { activeMs: 0, openMs: 0, views: 0 };
    t.activeMs += r.activeMs;
    t.openMs += r.openMs;
    if (r.label !== SCREEN_CONTINUED) t.views += r.count;
    roleBy.set(r.role, t);
  }
  const roles = [...roleBy.entries()]
    .map(([role, t]) => ({ role, activeHours: hours(t.activeMs), openHours: hours(t.openMs), views: t.views }))
    .sort((a, b) => b.activeHours - a.activeHours);

  const funnelBy = new Map<string, Record<string, number>>();
  for (const r of agg.filter((r) => r.kind === "funnel")) {
    const steps = funnelBy.get(r.role) ?? Object.fromEntries(FUNNEL_STEPS.map((s) => [s.key, 0]));
    steps[r.label] = (steps[r.label] ?? 0) + r.count;
    funnelBy.set(r.role, steps);
  }
  const funnel = [...funnelBy.entries()].map(([role, steps]) => ({ role, steps }));

  const callBy = new Map<string, DailyAgg[]>();
  for (const r of agg.filter((r) => r.kind === "call")) callBy.set(r.label, [...(callBy.get(r.label) ?? []), r]);
  const slowCalls = [...callBy.entries()]
    .map(([call, rows]) => {
      const n = rows.reduce((s, r) => s + r.count, 0);
      return {
        call,
        slow: rows.reduce((s, r) => s + r.slow, 0),
        failed: rows.reduce((s, r) => s + r.failed, 0),
        avgMs: n ? Math.round(rows.reduce((s, r) => s + r.durationMs, 0) / n) : 0,
        topScreen: topScreenOf(rows, (r) => r.count),
      };
    })
    .sort((a, b) => b.slow + b.failed - (a.slow + a.failed))
    .slice(0, 20);

  return { ...base, pain, messages, roles, funnel, slowCalls };
}

// ---------------------------------------------------------------------------
// The Monday top five (8C).
// ---------------------------------------------------------------------------

export const WEEKLY_SOURCE = "friction_weekly";

async function fixChecks(orgId: string, tz: string, weekStart: string, client: Executor): Promise<FixCheck[]> {
  const { from, to } = lastWeekRange(weekStart);
  const resolvedDay = sql`((${problemReports.resolvedAt} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;
  const fixed: Array<{ screen: string; version: string | null; resolvedAt: Date }> = await client
    .select({ screen: problemReports.screen, version: problemReports.fixedInVersion, resolvedAt: problemReports.resolvedAt })
    .from(problemReports)
    .where(
      and(
        eq(problemReports.orgId, orgId),
        eq(problemReports.status, "fixed"),
        sql`${resolvedDay} BETWEEN ${from}::date AND ${to}::date`,
      ),
    )
    .orderBy(desc(problemReports.resolvedAt));
  const seen = new Set<string>();
  const out: FixCheck[] = [];
  for (const f of fixed) {
    if (seen.has(f.screen) || out.length >= 5) continue;
    seen.add(f.screen);
    const fixDay = localCalendarDate(new Date(f.resolvedAt), tz);
    const before = await dailyAgg(orgId, shiftIsoDate(fixDay, -14), shiftIsoDate(fixDay, -1), client);
    const after = await dailyAgg(orgId, fixDay, to, client);
    const perHour = (agg: DailyAgg[], problems: Map<string, number>) =>
      scoreScreen(screenTotalsFrom(agg, problems).find((t) => t.screen === f.screen) ?? emptyTotals(f.screen)).painPerHour;
    const [{ n }] = await client
      .select({ n: sql<number>`count(*)::int` })
      .from(problemReports)
      .where(and(eq(problemReports.orgId, orgId), eq(problemReports.screen, f.screen), sql`${problemReports.createdAt} > ${f.resolvedAt}`));
    out.push({
      screen: f.screen,
      version: f.version,
      beforePerHour: perHour(before, await problemsByScreen(orgId, tz, shiftIsoDate(fixDay, -14), shiftIsoDate(fixDay, -1), client)),
      afterPerHour: perHour(after, new Map()),
      reportsSince: Number(n) || 0,
    });
  }
  return out;
}

/** The Signal's text for one shop's week, or null while it is held back. */
export async function weeklyTopFiveFor(
  orgId: string,
  weekStart: string,
  client: Executor = db,
): Promise<{ title: string; message: string; screens: string[] } | null> {
  const tz = await orgTimeZone(orgId);
  if (!weeklyAllowed(await firstDayOf(orgId, client), weekStart)) return null;
  const { from, to } = lastWeekRange(weekStart);
  const priorFrom = shiftIsoDate(weekStart, -28);
  const priorTo = shiftIsoDate(weekStart, -8);
  const lastWeek = screenTotalsFrom(await dailyAgg(orgId, from, to, client), await problemsByScreen(orgId, tz, from, to, client));
  const prior = screenTotalsFrom(
    await dailyAgg(orgId, priorFrom, priorTo, client),
    await problemsByScreen(orgId, tz, priorFrom, priorTo, client),
  );
  const top = pickTopFive(lastWeek, prior);
  const fixes = await fixChecks(orgId, tz, weekStart, client);
  const lines = top.length ? top.map(topFiveLine) : ["Nothing stood out last week."];
  if (fixes.length) lines.push("", "Fixed last week: did it work?", ...fixes.map(fixCheckLine));
  return {
    title: `Friction Truths: the week of ${from}`,
    message: lines.join("\n"),
    screens: top.map((t) => t.screen),
  };
}

/**
 * Every shop whose Monday it is (from 08:00 local) gets its top five once.
 * To the owner alone: usage data is the owner's (Q18), whatever the spec's
 * "admins and you" said. Exactly once per shop and week.
 */
export async function runWeeklyFrictionTopFive(now: Date = new Date()): Promise<number> {
  // Count what has arrived first, so a shop whose events are not summarised yet is not missed.
  await rollupUsage();
  const orgs: Array<{ orgId: string }> = await db.selectDistinct({ orgId: usageDaily.orgId }).from(usageDaily);
  let sent = 0;
  for (const { orgId } of orgs) {
    const tz = await orgTimeZone(orgId);
    const week = weekKeyFor(now, tz);
    if (week.weekday !== 1 || week.hour < WEEKLY_HOUR) continue;
    sent += await db.transaction(async (tx: Executor) => {
      if (!(await tryLock(tx, `${WEEKLY_SOURCE}:${orgId}:${week.key}`))) return 0;
      const [already] = await tx
        .select({ id: orgNotifications.id })
        .from(orgNotifications)
        .where(
          and(
            eq(orgNotifications.orgId, orgId),
            eq(orgNotifications.source, WEEKLY_SOURCE),
            sql`${orgNotifications.metadata}->>'week' = ${week.key}`,
          ),
        )
        .limit(1);
      if (already) return 0;
      const body = await weeklyTopFiveFor(orgId, week.key, tx);
      if (!body) return 0;
      await notify(
        {
          orgId,
          title: body.title,
          message: body.message,
          severity: "info",
          source: WEEKLY_SOURCE,
          audience: { roles: ["SUPER_ADMIN"] },
          metadata: { week: week.key, screens: body.screens, href: "/friction-truths" },
        },
        tx,
      );
      return 1;
    });
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Improvement study window (no recorder connected).
// ---------------------------------------------------------------------------

export async function getStudyWindow(orgId: string): Promise<StudyWindow> {
  const [row] = await db.select().from(usageStudyWindows).where(eq(usageStudyWindows.orgId, orgId));
  if (!row) return { enabled: false, screens: [], endsOn: null };
  return { enabled: row.enabled, screens: Array.isArray(row.screens) ? row.screens : [], endsOn: row.endsOn ?? null };
}

export async function saveStudyWindow(orgId: string, input: StudyWindowInput): Promise<StudyWindow> {
  const w = normaliseStudyWindow(input);
  await db
    .insert(usageStudyWindows)
    .values({ orgId, enabled: w.enabled, screens: w.screens, endsOn: w.endsOn, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: usageStudyWindows.orgId,
      set: { enabled: w.enabled, screens: w.screens, endsOn: w.endsOn, updatedAt: new Date() },
    });
  return w;
}

export async function todayFor(orgId: string, now: Date = new Date()): Promise<string> {
  return localCalendarDate(now, await orgTimeZone(orgId));
}
