/**
 * Staff targets (v1.2 Phase 7C, STF-07): admins only, logged and versioned.
 *
 * A change writes the next version; nothing is edited in place (the table's
 * trigger refuses UPDATE). The admin check is made by the route AND here, so
 * a new caller cannot skip it. Every change is also written to the admin
 * audit log, old version beside new.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { staffTargets } from "@shared/schema";
import { isAtLeast } from "@shared/accessPolicy";
import { staffTargetsSchema, type StaffTarget, type StaffTargetsInput } from "@shared/reports/staffTargets";

export const TARGETS_MIN_ROLE = "ADMIN" as const;

export class TargetsError extends Error {
  constructor(message: string, public status: 400 | 403) {
    super(message);
  }
}

export interface TargetsVersion {
  version: number;
  targets: StaffTarget[];
  note: string | null;
  setByUserId: string;
  setAt: string;
}

export interface CurrentTargets {
  current: TargetsVersion | null;
  /** When targets were first set: the four amber-only weeks run from here. */
  firstSetAt: string | null;
}

function toVersion(row: typeof staffTargets.$inferSelect): TargetsVersion {
  return {
    version: row.version,
    targets: (Array.isArray(row.targets) ? row.targets : []) as StaffTarget[],
    note: row.note ?? null,
    setByUserId: row.setByUserId,
    setAt: new Date(row.setAt as unknown as string).toISOString(),
  };
}

export async function currentTargets(orgId: string): Promise<CurrentTargets> {
  const [latest] = await db
    .select()
    .from(staffTargets)
    .where(eq(staffTargets.orgId, orgId))
    .orderBy(desc(staffTargets.version))
    .limit(1);
  if (!latest) return { current: null, firstSetAt: null };
  const [first] = await db
    .select({ setAt: staffTargets.setAt })
    .from(staffTargets)
    .where(eq(staffTargets.orgId, orgId))
    .orderBy(staffTargets.version)
    .limit(1);
  return { current: toVersion(latest), firstSetAt: first ? new Date(first.setAt as unknown as string).toISOString() : null };
}

export async function targetHistory(orgId: string, limit = 50): Promise<TargetsVersion[]> {
  const rows = await db
    .select()
    .from(staffTargets)
    .where(eq(staffTargets.orgId, orgId))
    .orderBy(desc(staffTargets.version))
    .limit(limit);
  return rows.map(toVersion);
}

/**
 * Writes the next version. `actor.role` must be ADMIN or the owner. Returns
 * the new version and the one it replaced, for the audit log.
 */
export async function setTargets(
  orgId: string,
  body: unknown,
  actor: { userId: string; role: string },
): Promise<{ saved: TargetsVersion; previous: TargetsVersion | null }> {
  if (!isAtLeast(actor.role, TARGETS_MIN_ROLE)) throw new TargetsError("Only an admin can set targets.", 403);
  const parsed = staffTargetsSchema.safeParse(body);
  if (!parsed.success) throw new TargetsError(parsed.error.errors[0]?.message ?? "Those targets are not valid.", 400);
  const input: StaffTargetsInput = parsed.data;

  return db.transaction(async (tx: any) => {
    // Two admins saving at once must not both claim the same version.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`staff_targets:${orgId}`}))`);
    const [prev] = await tx
      .select()
      .from(staffTargets)
      .where(eq(staffTargets.orgId, orgId))
      .orderBy(desc(staffTargets.version))
      .limit(1);
    const [row] = await tx
      .insert(staffTargets)
      .values({
        orgId,
        version: (prev?.version ?? 0) + 1,
        targets: input.targets,
        note: input.note?.trim() ? input.note.trim() : null,
        setByUserId: actor.userId,
      })
      .returning();
    return { saved: toVersion(row), previous: prev ? toVersion(prev) : null };
  });
}

/** The targets in force at an instant (for a past week's digest or flags). */
export async function targetsAt(orgId: string, at: Date): Promise<TargetsVersion | null> {
  const [row] = await db
    .select()
    .from(staffTargets)
    .where(and(eq(staffTargets.orgId, orgId), sql`${staffTargets.setAt} <= ${at}`))
    .orderBy(desc(staffTargets.version))
    .limit(1);
  return row ? toVersion(row) : null;
}
