/**
 * DB access for the rota: recurring patterns, date overrides, and time-off
 * requests. Kept separate from server/storage.ts (already very large) and
 * from shared/rota.ts (pure resolve logic, no DB) — this file is the glue
 * between the two: load rows for an org, hand them to shared/rota.ts to
 * resolve, and write the mutations a manager or a cashier makes.
 */
import { db } from "../db";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import {
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
import { storage } from "../storage";
import { resolveUserNames } from "./userDisplayName";
import { forwardDates, resolvePersonRota, headcountFor, type RotaDay } from "@shared/rota";
import { getHourOfDayAnalytics } from "./hourOfDayService";

export interface RosterMember {
  userId: string;
  name: string;
  role: string | null;
}

/** Every person who can be rota'd for this org: the org's own allow-list, named. */
export async function getRosterForOrg(orgId: string): Promise<RosterMember[]> {
  const allowed = await storage.getAllowedUsers(orgId);
  const ids = allowed.map((u) => u.replitUserId).filter((id): id is string => !!id);
  const names = await resolveUserNames(ids);
  return allowed
    .filter((u) => u.replitUserId)
    .map((u) => ({
      userId: u.replitUserId as string,
      name: names.get(u.replitUserId as string) ?? (u.replitUserId as string),
      role: u.isOwner ? "SUPER_ADMIN" : (u.role ?? null),
    }));
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
  const [row] = await db
    .update(shiftPatterns)
    .set({ ...patch, updatedAt: new Date() })
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

/** One row per person per date — a second write for the same day replaces the first. */
export async function upsertOverride(
  orgId: string,
  userId: string,
  input: InsertShiftOverrideInput,
  createdByUserId: string | null,
  timeOffRequestId: string | null = null,
): Promise<ShiftOverride> {
  const [row] = await db
    .insert(shiftOverrides)
    .values({
      orgId,
      userId,
      date: input.date,
      status: input.status,
      startTime: input.status === "working" ? input.startTime ?? null : null,
      endTime: input.status === "working" ? input.endTime ?? null : null,
      note: input.note ?? null,
      timeOffRequestId,
      createdByUserId: createdByUserId ?? undefined,
    })
    .onConflictDoUpdate({
      target: [shiftOverrides.orgId, shiftOverrides.userId, shiftOverrides.date],
      set: {
        status: input.status,
        startTime: input.status === "working" ? input.startTime ?? null : null,
        endTime: input.status === "working" ? input.endTime ?? null : null,
        note: input.note ?? null,
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
  opts: { userId?: string; status?: string } = {},
): Promise<TimeOffRequest[]> {
  const conditions = [eq(timeOffRequests.orgId, orgId)];
  if (opts.userId) conditions.push(eq(timeOffRequests.userId, opts.userId));
  if (opts.status) conditions.push(eq(timeOffRequests.status, opts.status));
  return db.select().from(timeOffRequests).where(and(...conditions));
}

export async function createTimeOffRequest(
  orgId: string,
  userId: string,
  input: InsertTimeOffRequestInput,
): Promise<TimeOffRequest> {
  const [row] = await db
    .insert(timeOffRequests)
    .values({ orgId, userId, startDate: input.startDate, endDate: input.endDate, reason: input.reason ?? null })
    .returning();
  return row;
}

/** Every date from startDate to endDate inclusive, as "YYYY-MM-DD". */
function dateRange(startDate: string, endDate: string): string[] {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  const days = Math.round((end - start) / 86_400_000) + 1;
  return days > 0 ? forwardDates(startDate, days) : [];
}

/**
 * Approve, decline, or cancel a request. Approving writes an "off" override
 * for every date in its range — the grid only ever reads shift_overrides, so
 * approval is the one moment this table's effect has to land there.
 */
export async function decideTimeOffRequest(
  orgId: string,
  id: string,
  decision: "approved" | "declined" | "cancelled",
  decidedByUserId: string,
  decisionNote?: string,
): Promise<TimeOffRequest | null> {
  const [existing] = await db
    .select()
    .from(timeOffRequests)
    .where(and(eq(timeOffRequests.id, id), eq(timeOffRequests.orgId, orgId)))
    .limit(1);
  if (!existing) return null;

  const [row] = await db
    .update(timeOffRequests)
    .set({
      status: decision,
      decidedByUserId,
      decidedAt: new Date(),
      decisionNote: decisionNote ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(timeOffRequests.id, id), eq(timeOffRequests.orgId, orgId)))
    .returning();

  if (decision === "approved") {
    const dates = dateRange(existing.startDate, existing.endDate);
    for (const date of dates) {
      await upsertOverride(orgId, existing.userId, { userId: existing.userId, date, status: "off" }, decidedByUserId, existing.id);
    }
  }

  return row ?? null;
}

export interface RotaGridPerson extends RosterMember {
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
    const personPatterns = patterns.filter((p) => p.userId === person.userId);
    const personOverrides = overrides.filter((o) => o.userId === person.userId);
    const resolved = resolvePersonRota(dates, personPatterns, personOverrides);
    rotaByUser.set(person.userId, resolved);
    return { ...person, days: resolved };
  });

  const headcountByDate: Record<string, number> = {};
  dates.forEach((date, index) => {
    headcountByDate[date] = headcountFor(date, rotaByUser, index);
  });

  return { dates, people, headcountByDate };
}

/** Busiest-times overlay: reuses the existing hour-of-day analytics, collapsed to a per-day-of-week average. */
export async function getBusyByDayOfWeek(orgId: string, weeks = 8): Promise<Record<number, number>> {
  const { buckets } = await getHourOfDayAnalytics(orgId, weeks);
  const totals: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const bucket of buckets) {
    totals[bucket.dow] = (totals[bucket.dow] ?? 0) + bucket.avgRevenue;
  }
  return totals;
}
