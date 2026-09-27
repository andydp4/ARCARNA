/**
 * DB access for the rota: recurring patterns, date overrides, and time-off
 * requests. shared/rota.ts holds the pure resolve logic; this file loads rows
 * for an org, hands them to it, and writes what a manager or cashier changes.
 */
import { db } from "../db";
import { and, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import {
  allowedUsers,
  shiftPatterns,
  shiftOverrides,
  timeOffRequests,
  type ShiftPattern,
  type ShiftOverride,
  type TimeOffRequest,
  type InsertShiftPatternInput,
  type InsertShiftOverrideInput,
  type InsertTimeOffRequestInput,
} from "@shared/schema";
import { forwardDates, resolvePersonRota, headcountFor, type RotaDay } from "@shared/rota";
import { getHourOfDayAnalytics } from "./hourOfDayService";

export class RotaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Longest time-off request accepted, in days — long enough for a holiday, short enough that a mistyped year is refused. */
export const MAX_TIME_OFF_DAYS = 62;

export interface RosterMember {
  /** The auth subject — what req.user.id carries, and what every rota row is written under. */
  userId: string;
  /** Every id this person's rows may have been written under (auth subject and legacy replit id). */
  aliases: string[];
  name: string;
  role: string | null;
}

/**
 * Everyone who can be put on this org's rota.
 *
 * Mirrors the Ops board's staff list (opsBoard.ts loadStaff): keyed by the auth
 * subject — authUserId, falling back to the legacy replitUserId — because that
 * is what req.user.id is and what a time-off request is stored under. A row
 * linked to Clerk by email keeps its old replitUserId, so keying on that made
 * approved days off invisible for exactly those staff. Shop (CUSTOMER)
 * accounts are not staff; an org-less row is included only for the owner.
 */
export async function getRosterForOrg(orgId: string): Promise<RosterMember[]> {
  const rows = await db
    .select({
      authUserId: allowedUsers.authUserId,
      replitUserId: allowedUsers.replitUserId,
      name: allowedUsers.name,
      role: allowedUsers.role,
      isOwner: allowedUsers.isOwner,
    })
    .from(allowedUsers)
    .where(
      and(
        ne(allowedUsers.role, "CUSTOMER"),
        or(
          eq(allowedUsers.orgId, orgId),
          and(isNull(allowedUsers.orgId), or(eq(allowedUsers.isOwner, 1), eq(allowedUsers.role, "SUPER_ADMIN"))),
        ),
      ),
    );

  const out: RosterMember[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const userId = r.authUserId || r.replitUserId;
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    out.push({
      userId,
      aliases: [...new Set([r.authUserId, r.replitUserId].filter((v): v is string => !!v))],
      // The staff member's name only — never their email, which a cashier
      // viewing the rota has no business seeing.
      name: r.name?.trim() || "Unnamed staff member",
      role: r.isOwner ? "SUPER_ADMIN" : (r.role ?? null),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The roster member a user id (either alias) belongs to, or throws 400 — ids from a request body are not trusted. */
export async function requireRosterMember(orgId: string, userId: string): Promise<RosterMember> {
  const member = (await getRosterForOrg(orgId)).find((m) => m.aliases.includes(userId));
  if (!member) throw new RotaError("That person is not on this shop's staff.", 400);
  return member;
}

export async function listPatterns(orgId: string, userId?: string): Promise<ShiftPattern[]> {
  return db
    .select()
    .from(shiftPatterns)
    .where(userId ? and(eq(shiftPatterns.orgId, orgId), eq(shiftPatterns.userId, userId)) : eq(shiftPatterns.orgId, orgId));
}

export async function createPattern(
  orgId: string,
  userId: string,
  input: InsertShiftPatternInput,
  createdByUserId: string | null,
): Promise<ShiftPattern> {
  const [row] = await db
    .insert(shiftPatterns)
    .values({ ...input, orgId, userId, createdByUserId: createdByUserId ?? undefined })
    .returning();
  return row;
}

export async function updatePattern(
  orgId: string,
  id: string,
  patch: Partial<InsertShiftPatternInput>,
): Promise<ShiftPattern | null> {
  // Who a pattern belongs to is not editable: delete it and add one for the other person.
  const { userId: _ignored, ...rest } = patch;
  const [row] = await db
    .update(shiftPatterns)
    .set({ ...rest, updatedAt: new Date() })
    .where(and(eq(shiftPatterns.id, id), eq(shiftPatterns.orgId, orgId)))
    .returning();
  return row ?? null;
}

export async function deletePattern(orgId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(shiftPatterns)
    .where(and(eq(shiftPatterns.id, id), eq(shiftPatterns.orgId, orgId)))
    .returning({ id: shiftPatterns.id });
  return rows.length > 0;
}

export async function listOverrides(
  orgId: string,
  opts: { userId?: string; from?: string; to?: string } = {},
): Promise<ShiftOverride[]> {
  const conditions = [eq(shiftOverrides.orgId, orgId)];
  if (opts.userId) conditions.push(eq(shiftOverrides.userId, opts.userId));
  if (opts.from) conditions.push(gte(shiftOverrides.date, opts.from));
  if (opts.to) conditions.push(lte(shiftOverrides.date, opts.to));
  return db.select().from(shiftOverrides).where(and(...conditions));
}

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function overrideValues(orgId: string, userId: string, input: InsertShiftOverrideInput, createdByUserId: string | null, timeOffRequestId: string | null) {
  const working = input.status === "working";
  return {
    orgId,
    userId,
    date: input.date,
    status: input.status,
    startTime: working ? input.startTime ?? null : null,
    endTime: working ? input.endTime ?? null : null,
    note: input.note ?? null,
    timeOffRequestId,
    createdByUserId: createdByUserId ?? undefined,
  };
}

/** One row per person per date — a second write for the same day replaces the first. */
export async function upsertOverride(
  orgId: string,
  userId: string,
  input: InsertShiftOverrideInput,
  createdByUserId: string | null,
  timeOffRequestId: string | null = null,
  client: Db | Tx = db,
): Promise<ShiftOverride> {
  const values = overrideValues(orgId, userId, input, createdByUserId, timeOffRequestId);
  const [row] = await client
    .insert(shiftOverrides)
    .values(values)
    .onConflictDoUpdate({
      target: [shiftOverrides.orgId, shiftOverrides.userId, shiftOverrides.date],
      set: {
        status: values.status,
        startTime: values.startTime,
        endTime: values.endTime,
        note: values.note,
        timeOffRequestId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function deleteOverride(orgId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(shiftOverrides)
    .where(and(eq(shiftOverrides.id, id), eq(shiftOverrides.orgId, orgId)))
    .returning({ id: shiftOverrides.id });
  return rows.length > 0;
}

export async function listTimeOffRequests(
  orgId: string,
  opts: { userIds?: string[]; status?: string } = {},
): Promise<TimeOffRequest[]> {
  const conditions = [eq(timeOffRequests.orgId, orgId)];
  if (opts.userIds) conditions.push(inArray(timeOffRequests.userId, opts.userIds.length ? opts.userIds : ["__none__"]));
  if (opts.status) conditions.push(eq(timeOffRequests.status, opts.status));
  return db.select().from(timeOffRequests).where(and(...conditions));
}

export async function getTimeOffRequest(orgId: string, id: string): Promise<TimeOffRequest | null> {
  const [row] = await db
    .select()
    .from(timeOffRequests)
    .where(and(eq(timeOffRequests.id, id), eq(timeOffRequests.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/** Every date from startDate to endDate inclusive. Throws 400 for an inverted, impossible or over-long range. */
export function timeOffDates(startDate: string, endDate: string): string[] {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    const t = Date.UTC(y, m - 1, d);
    // Date.UTC rolls 2026-02-31 over to March; round-tripping catches it.
    if (new Date(t).toISOString().slice(0, 10) !== s) throw new RotaError(`${s} is not a real date.`, 400);
    return t;
  };
  const days = Math.round((parse(endDate) - parse(startDate)) / 86_400_000) + 1;
  if (days < 1) throw new RotaError("The end date cannot be before the start date.", 400);
  if (days > MAX_TIME_OFF_DAYS) {
    throw new RotaError(`A request can cover at most ${MAX_TIME_OFF_DAYS} days — this one is ${days}. Check the year.`, 400);
  }
  return forwardDates(startDate, days);
}

export async function createTimeOffRequest(
  orgId: string,
  userId: string,
  input: InsertTimeOffRequestInput,
): Promise<TimeOffRequest> {
  timeOffDates(input.startDate, input.endDate);
  const [row] = await db
    .insert(timeOffRequests)
    .values({ orgId, userId, startDate: input.startDate, endDate: input.endDate, reason: input.reason ?? null })
    .returning();
  return row;
}

export type TimeOffDecision = "approved" | "declined" | "cancelled" | "revoked";

/**
 * Move a request on, atomically and only from the state it is expected to be in.
 *
 *   approved / declined / cancelled — only from pending. A stale screen that
 *     still shows an already-decided request gets 409, rather than
 *     resurrecting a cancelled request or declining an approved one while its
 *     days off stay on the grid.
 *   revoked — only from approved: undoes the approval and removes the days off
 *     it wrote (recorded as status "cancelled").
 *
 * The status change and the override writes are one transaction: either the
 * request is approved with every day off in place, or nothing changed.
 */
export async function decideTimeOffRequest(
  orgId: string,
  id: string,
  decision: TimeOffDecision,
  decidedByUserId: string,
  decisionNote?: string,
): Promise<TimeOffRequest> {
  const from = decision === "revoked" ? "approved" : "pending";
  const to = decision === "revoked" ? "cancelled" : decision;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(timeOffRequests)
      .set({ status: to, decidedByUserId, decidedAt: new Date(), decisionNote: decisionNote ?? null, updatedAt: new Date() })
      .where(and(eq(timeOffRequests.id, id), eq(timeOffRequests.orgId, orgId), eq(timeOffRequests.status, from)))
      .returning();
    if (!row) {
      const [current] = await tx
        .select({ status: timeOffRequests.status })
        .from(timeOffRequests)
        .where(and(eq(timeOffRequests.id, id), eq(timeOffRequests.orgId, orgId)))
        .limit(1);
      if (!current) throw new RotaError("Time-off request not found", 404);
      throw new RotaError(`This request is already ${current.status} — refresh to see its current state.`, 409);
    }

    if (decision === "approved") {
      const values = timeOffDates(row.startDate, row.endDate).map((date) =>
        overrideValues(orgId, row.userId, { userId: row.userId, date, status: "off" }, decidedByUserId, row.id),
      );
      await tx
        .insert(shiftOverrides)
        .values(values)
        .onConflictDoUpdate({
          target: [shiftOverrides.orgId, shiftOverrides.userId, shiftOverrides.date],
          set: { status: "off", startTime: null, endTime: null, note: null, timeOffRequestId: row.id, updatedAt: new Date() },
        });
    } else if (decision === "revoked") {
      await tx
        .delete(shiftOverrides)
        .where(and(eq(shiftOverrides.orgId, orgId), eq(shiftOverrides.timeOffRequestId, row.id)));
    }
    return row;
  });
}

export interface RotaGridPerson {
  userId: string;
  name: string;
  role: string | null;
  days: RotaDay[];
}

export interface RotaGrid {
  dates: string[];
  people: RotaGridPerson[];
  headcountByDate: Record<string, number>;
}

/** The resolved N-day-forward grid for every person on the org's roster. */
export async function getRotaGrid(orgId: string, from: string, days: number): Promise<RotaGrid> {
  const dates = forwardDates(from, days);
  const [roster, patterns, overrides] = await Promise.all([
    getRosterForOrg(orgId),
    listPatterns(orgId),
    listOverrides(orgId, { from: dates[0], to: dates[dates.length - 1] }),
  ]);

  const rotaByUser = new Map<string, RotaDay[]>();
  const people: RotaGridPerson[] = roster.map((person) => {
    // Rows written before the roster was keyed by auth subject carry the
    // legacy id; match on either so nothing already saved goes missing.
    const mine = new Set(person.aliases);
    const resolved = resolvePersonRota(
      dates,
      patterns.filter((p) => mine.has(p.userId)),
      overrides.filter((o) => mine.has(o.userId)),
    );
    rotaByUser.set(person.userId, resolved);
    return { userId: person.userId, name: person.name, role: person.role, days: resolved };
  });

  const headcountByDate: Record<string, number> = {};
  dates.forEach((date, index) => {
    headcountByDate[date] = headcountFor(date, rotaByUser, index);
  });

  return { dates, people, headcountByDate };
}

/** Busiest-times overlay: the existing hour-of-day analytics, summed per day of week. */
export async function getBusyByDayOfWeek(orgId: string, weeks = 8): Promise<Record<number, number>> {
  const { buckets } = await getHourOfDayAnalytics(orgId, weeks);
  const totals: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const bucket of buckets) {
    totals[bucket.dow] = (totals[bucket.dow] ?? 0) + bucket.avgRevenue;
  }
  return totals;
}
