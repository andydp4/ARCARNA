/**
 * DB access for the rota: recurring patterns, date overrides, and time-off
 * requests. shared/rota.ts holds the pure resolve logic; this file loads rows
 * for an org, hands them to it, and writes what a manager or cashier changes.
 */
import { db } from "../db";
import { and, desc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
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
  // Newest first. A person can still hold an old row under their legacy id for
  // a date that also has a newer one under their sign-in id (written before
  // the roster was keyed by sign-in id); the resolver takes the first match,
  // so the most recent decision is the one that shows.
  return db.select().from(shiftOverrides).where(and(...conditions)).orderBy(desc(shiftOverrides.updatedAt));
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

/** Every id one person's rota rows may carry: their sign-in (Clerk) id and their legacy id. */
async function aliasesOf(userId: string, client: Db | Tx = db): Promise<string[]> {
  const rows = await client
    .select({ authUserId: allowedUsers.authUserId, replitUserId: allowedUsers.replitUserId })
    .from(allowedUsers)
    .where(or(eq(allowedUsers.authUserId, userId), eq(allowedUsers.replitUserId, userId)));
  return [...new Set([userId, ...rows.flatMap((r) => [r.authUserId, r.replitUserId]).filter((v): v is string => !!v)])];
}

/**
 * A manager's one-off change for one person on one date, as the rota page
 * saves it. In one transaction:
 *   - a day off written by a request that is still approved is not
 *     overwritten here (the request would still read "approved" for a day the
 *     person is shown working, and revoking it would then do nothing) — 409,
 *     revoke the request instead;
 *   - any row for that date under the person's OTHER id (saved before the
 *     roster was keyed by sign-in id) is removed, so the new row cannot be
 *     shadowed by the old one;
 *   - the row under their sign-in id is written.
 */
export async function saveOverride(
  orgId: string,
  member: { userId: string; aliases: string[] },
  input: InsertShiftOverrideInput,
  createdByUserId: string | null,
): Promise<ShiftOverride> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: shiftOverrides.id, userId: shiftOverrides.userId, timeOffRequestId: shiftOverrides.timeOffRequestId })
      .from(shiftOverrides)
      .where(and(eq(shiftOverrides.orgId, orgId), inArray(shiftOverrides.userId, member.aliases), eq(shiftOverrides.date, input.date)));
    const linked = existing.map((r) => r.timeOffRequestId).filter((v): v is string => !!v);
    if (linked.length) {
      const approved = await tx
        .select({ id: timeOffRequests.id })
        .from(timeOffRequests)
        .where(and(eq(timeOffRequests.orgId, orgId), inArray(timeOffRequests.id, linked), eq(timeOffRequests.status, "approved")));
      if (approved.length) {
        throw new RotaError("This day off comes from an approved time-off request. Revoke the request to change it.", 409);
      }
    }
    const stale = existing.filter((r) => r.userId !== member.userId).map((r) => r.id);
    if (stale.length) await tx.delete(shiftOverrides).where(inArray(shiftOverrides.id, stale));
    return upsertOverride(orgId, member.userId, input, createdByUserId, null, tx);
  });
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

/**
 * Removes a one-off change so the day falls back to the pattern. A day off
 * written by a request that is STILL approved is not removed here — that would
 * leave the request reading "approved" for a day the person is back on — so
 * it is refused, and the request is revoked instead. A row still tagged with a
 * request that is no longer approved (left over from before decisions were
 * locked down) can be reset like any other.
 */
export async function deleteOverride(orgId: string, id: string): Promise<boolean> {
  const [existing] = await db
    .select({ timeOffRequestId: shiftOverrides.timeOffRequestId })
    .from(shiftOverrides)
    .where(and(eq(shiftOverrides.id, id), eq(shiftOverrides.orgId, orgId)));
  if (!existing) return false;
  if (existing.timeOffRequestId) {
    const [request] = await db
      .select({ status: timeOffRequests.status })
      .from(timeOffRequests)
      .where(and(eq(timeOffRequests.id, existing.timeOffRequestId), eq(timeOffRequests.orgId, orgId)));
    if (request?.status === "approved") {
      throw new RotaError("This day off comes from an approved time-off request. Revoke the request instead.", 409);
    }
  }
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

export type DecidedTimeOffRequest = TimeOffRequest & {
  /** On approval: dates where a manager's one-off working shift was replaced by the day off. */
  replacedShifts?: Array<{ date: string; startTime: string | null; endTime: string | null }>;
};

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
): Promise<DecidedTimeOffRequest> {
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

    const aliases = await aliasesOf(row.userId, tx);

    if (decision === "approved") {
      const dates = timeOffDates(row.startDate, row.endDate);
      const existing = await tx
        .select()
        .from(shiftOverrides)
        .where(and(eq(shiftOverrides.orgId, orgId), inArray(shiftOverrides.userId, aliases), inArray(shiftOverrides.date, dates)));
      // A manager's one-off working shift on one of these days is replaced by
      // the day off; say which, so the approver knows to re-add it if the
      // approval is ever revoked.
      const replacedShifts = existing
        .filter((o) => o.status === "working" && !o.timeOffRequestId)
        .map((o) => ({ date: o.date, startTime: o.startTime, endTime: o.endTime }))
        .sort((a, b) => a.date.localeCompare(b.date));
      // Rows for these days under the person's other id would shadow the new ones.
      const stale = existing.filter((o) => o.userId !== row.userId).map((o) => o.id);
      if (stale.length) await tx.delete(shiftOverrides).where(inArray(shiftOverrides.id, stale));
      const values = dates.map((date) =>
        overrideValues(orgId, row.userId, { userId: row.userId, date, status: "off" }, decidedByUserId, row.id),
      );
      await tx
        .insert(shiftOverrides)
        .values(values)
        .onConflictDoUpdate({
          target: [shiftOverrides.orgId, shiftOverrides.userId, shiftOverrides.date],
          set: { status: "off", startTime: null, endTime: null, note: null, timeOffRequestId: row.id, updatedAt: new Date() },
        });
      return replacedShifts.length ? { ...row, replacedShifts } : row;
    }

    if (decision === "revoked") {
      // A day also covered by another of this person's approved requests
      // stays off, handed to that request; only the days nothing else covers
      // go back to the pattern.
      const others = await tx
        .select({ id: timeOffRequests.id, startDate: timeOffRequests.startDate, endDate: timeOffRequests.endDate })
        .from(timeOffRequests)
        .where(
          and(
            eq(timeOffRequests.orgId, orgId),
            inArray(timeOffRequests.userId, aliases),
            eq(timeOffRequests.status, "approved"),
            ne(timeOffRequests.id, row.id),
            lte(timeOffRequests.startDate, row.endDate),
            gte(timeOffRequests.endDate, row.startDate),
          ),
        );
      const days = await tx
        .select({ id: shiftOverrides.id, date: shiftOverrides.date })
        .from(shiftOverrides)
        .where(and(eq(shiftOverrides.orgId, orgId), eq(shiftOverrides.timeOffRequestId, row.id)));
      const drop: string[] = [];
      for (const day of days) {
        const cover = others.find((o) => o.startDate <= day.date && o.endDate >= day.date);
        if (cover) {
          await tx.update(shiftOverrides).set({ timeOffRequestId: cover.id, updatedAt: new Date() }).where(eq(shiftOverrides.id, day.id));
        } else {
          drop.push(day.id);
        }
      }
      if (drop.length) await tx.delete(shiftOverrides).where(inArray(shiftOverrides.id, drop));
    }
    return row;
  });
}

export interface RotaGridPerson {
  userId: string;
  name: string;
  role: string | null;
  /** Every id this person's rota rows and requests may carry (Clerk subject and legacy id). */
  aliases: string[];
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
    return { userId: person.userId, name: person.name, role: person.role, aliases: person.aliases, days: resolved };
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
