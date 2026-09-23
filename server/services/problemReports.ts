/**
 * The "Problem?" button (v1.2 Phase 8A: UXA-09, UXA-06, UXA-14).
 *
 * A report is stored for the admin inbox, told to admins as a Signal (without
 * saying who sent it) and sent to Sentry with role, screen and device tags and
 * no name or free text. When an admin marks it fixed, the reporter alone gets
 * "Thanks, fixed in version X" in their Signals bell.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { problemReports } from "@shared/schema";
import {
  fixedThanks,
  normaliseProblemReport,
  problemChipLabel,
  problemSentryTags,
  PROBLEM_RATE_LIMIT,
  PROBLEM_RATE_WINDOW_MINUTES,
  type ProblemReportInput,
  type ProblemResolveInput,
  type ProblemStatus,
} from "@shared/problemReports";
import { notify } from "./signals";

export class ProblemReportError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** What Sentry is given for one report: a message and tags, nothing else. */
export type ProblemSentryEvent = { message: string; tags: Record<string, string> };
type SentrySender = (event: ProblemSentryEvent) => Promise<void> | void;

const defaultSentrySender: SentrySender = async (event) => {
  if (!process.env.SENTRY_DSN?.trim()) return;
  const Sentry = await import("@sentry/node");
  Sentry.withScope((scope) => {
    // Whatever the request scope picked up, this event names nobody.
    scope.setUser(null);
    scope.setTags(event.tags);
    scope.setLevel("info");
    Sentry.captureMessage(event.message);
  });
};

let sentrySender: SentrySender = defaultSentrySender;

/** Tests swap the sender to see exactly what would reach Sentry. */
export function setProblemSentrySender(sender: SentrySender | null): void {
  sentrySender = sender ?? defaultSentrySender;
}

export type InboxReport = {
  id: string;
  chip: string;
  chipLabel: string;
  note: string | null;
  screen: string;
  role: string;
  device: string;
  appVersion: string | null;
  online: boolean;
  queue: { waiting: number; failed: number; needsAttention: number };
  status: string;
  fixedInVersion: string | null;
  resolvedAt: Date | null;
  reportedAt: Date | null;
  createdAt: Date;
};

/**
 * The inbox's view of a row. Built from an allow-list, so the reporter's id
 * (and any column added later) never reaches the page by accident.
 */
function toInbox(r: typeof problemReports.$inferSelect): InboxReport {
  return {
    id: r.id,
    chip: r.chip,
    chipLabel: problemChipLabel(r.chip),
    note: r.note,
    screen: r.screen,
    role: r.reporterRole,
    device: r.device,
    appVersion: r.appVersion,
    online: r.online,
    queue: r.queue,
    status: r.status,
    fixedInVersion: r.fixedInVersion,
    resolvedAt: r.resolvedAt,
    reportedAt: r.reportedAt,
    createdAt: r.createdAt,
  };
}

export async function createProblemReport(args: {
  orgId: string;
  reporterUserId: string;
  reporterRole: string;
  input: ProblemReportInput;
  now?: Date;
}): Promise<{ id: string; duplicate: boolean }> {
  const { orgId, reporterUserId, reporterRole, input } = args;
  const now = args.now ?? new Date();

  // Sent before (a queued report replayed): the same answer, no second Signal.
  const [existing] = await db
    .select({ id: problemReports.id })
    .from(problemReports)
    .where(
      and(
        eq(problemReports.orgId, orgId),
        eq(problemReports.reporterUserId, reporterUserId),
        eq(problemReports.clientRef, input.clientRef),
      ),
    );
  if (existing) return { id: existing.id, duplicate: true };

  const since = new Date(now.getTime() - PROBLEM_RATE_WINDOW_MINUTES * 60_000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(problemReports)
    .where(and(eq(problemReports.reporterUserId, reporterUserId), gte(problemReports.createdAt, since)));
  if (n >= PROBLEM_RATE_LIMIT) {
    throw new ProblemReportError(
      429,
      "too_many",
      `That is ${n} reports in ${PROBLEM_RATE_WINDOW_MINUTES} minutes. Thank you. Please tell a manager, and try again in a few minutes.`,
    );
  }

  const r = normaliseProblemReport(input);
  // A till's clock can be wrong; keep its time only when it is plausible.
  const reportedAt = input.reportedAt ? new Date(input.reportedAt) : null;
  const plausible =
    reportedAt && reportedAt.getTime() <= now.getTime() + 5 * 60_000 && reportedAt.getTime() >= now.getTime() - 30 * 86_400_000;

  const [row] = await db
    .insert(problemReports)
    .values({
      orgId,
      reporterUserId,
      reporterRole,
      clientRef: input.clientRef,
      chip: r.chip,
      note: r.note,
      screen: r.screen,
      device: r.device,
      appVersion: r.appVersion,
      online: r.online,
      queue: r.queue,
      reportedAt: plausible ? reportedAt : null,
    })
    .onConflictDoNothing()
    .returning({ id: problemReports.id });
  if (!row) {
    // Lost a race with the same report sent twice at once.
    const [again] = await db
      .select({ id: problemReports.id })
      .from(problemReports)
      .where(
        and(
          eq(problemReports.orgId, orgId),
          eq(problemReports.reporterUserId, reporterUserId),
          eq(problemReports.clientRef, input.clientRef),
        ),
      );
    return { id: again.id, duplicate: true };
  }

  const label = problemChipLabel(r.chip);
  try {
    await notify({
      orgId,
      title: `Problem? ${label}`,
      message: `${label} on ${r.screen} · ${r.device} · ${reporterRole.toLowerCase()}${r.online ? "" : " · offline"}`,
      severity: "info",
      source: "problem_report",
      metadata: { entityId: row.id },
    });
  } catch (e) {
    // The report is stored; a failed Signal must not lose it or fail the till.
    console.error("[ProblemReports] Signal failed:", e);
  }
  try {
    await sentrySender({
      message: `Problem? ${label}`,
      tags: problemSentryTags({ role: reporterRole, screen: r.screen, device: r.device, chip: r.chip, appVersion: r.appVersion, online: r.online, id: row.id }),
    });
  } catch (e) {
    console.error("[ProblemReports] Sentry send failed:", e);
  }
  return { id: row.id, duplicate: false };
}

export async function listProblemReports(orgId: string, status: ProblemStatus | "all" = "open"): Promise<InboxReport[]> {
  const where = status === "all" ? eq(problemReports.orgId, orgId) : and(eq(problemReports.orgId, orgId), eq(problemReports.status, status));
  const rows = await db.select().from(problemReports).where(where).orderBy(desc(problemReports.createdAt)).limit(200);
  return rows.map(toInbox);
}

export async function resolveProblemReport(args: {
  orgId: string;
  id: string;
  actorUserId: string;
  input: ProblemResolveInput;
}): Promise<{ report: InboxReport; thanked: boolean }> {
  const { orgId, id, actorUserId, input } = args;
  const [before] = await db
    .select()
    .from(problemReports)
    .where(and(eq(problemReports.orgId, orgId), eq(problemReports.id, id)));
  if (!before) throw new ProblemReportError(404, "not_found", "That report is not in this shop's inbox.");

  const version = input.outcome === "fixed" ? input.version : null;
  const [after] = await db
    .update(problemReports)
    .set({
      status: input.outcome,
      fixedInVersion: version,
      resolvedBy: input.outcome === "open" ? null : actorUserId,
      resolvedAt: input.outcome === "open" ? null : new Date(),
    })
    .where(and(eq(problemReports.orgId, orgId), eq(problemReports.id, id)))
    .returning();

  // Thank them once per version: re-saving the same "fixed" is not news, but
  // a fix that came back and was fixed again in a later version is.
  const thank = input.outcome === "fixed" && !(before.status === "fixed" && before.fixedInVersion === version);
  if (thank && version) {
    await notify({
      orgId,
      title: fixedThanks(version),
      message: `You pressed Problem? ("${problemChipLabel(before.chip)}") on ${before.screen}. Update to version ${version} or later to get the fix.`,
      severity: "info",
      source: "problem_report_fixed",
      audience: { userIds: [before.reporterUserId] },
      metadata: { entityId: before.id },
    });
  }
  return { report: toInbox(after), thanked: thank };
}
