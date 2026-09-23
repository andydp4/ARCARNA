/**
 * Needs a look (v1.2 Phase 4, CMP-02): the review inbox for exceptions.
 *
 * Every exception — a flagged sale (price guard) or a refund the refunds rule
 * picks out — gets one row here with a state (open, acknowledged, explained,
 * escalated), a reviewer and a note. Who may see and review a row is the rule
 * in shared/review/exceptions.ts, enforced here in SQL so a list never carries
 * a row the viewer may not see: people above the person it is about, never
 * that person, and the owner sees everything.
 */
import { and, desc, eq, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { exceptionReviews, orgNotifications, priceGuardOrders } from "@shared/schema";
import type { Role } from "@shared/rbac";
import {
  EXCEPTION_STATE_LABELS,
  QUEUE_LABELS,
  STALE_AFTER_DAYS,
  mayReviewException,
  reviewQueuesFor,
  staleLine,
  weekKeyFor,
  type ExceptionKind,
  type ExceptionState,
} from "@shared/review/exceptions";
import { orderRefOf } from "@shared/pricing/priceGuard";
import { loadSignalCandidates, notify } from "./signals";
import { resolveUserNames } from "./userDisplayName";
import { orgTimeZone } from "./tradingDayShift";

type Executor = typeof db | any;

/** The role of a member of staff in this org now (the owner's login counts as SUPER_ADMIN). */
export async function staffRoleOf(orgId: string, userId: string | null | undefined, client: Executor = db): Promise<Role | null> {
  if (!userId) return null;
  const candidates = await loadSignalCandidates(orgId, client);
  return (candidates.find((c) => c.userId === userId)?.role as Role | undefined) ?? null;
}

export type RaiseExceptionInput = {
  orgId: string;
  kind: ExceptionKind;
  sourceId: string;
  orderId: string | null;
  subjectUserId: string | null;
  subjectRole: Role | null;
  severity: "warning" | "error";
  summary: string;
  amount: number | null;
  rules?: unknown;
};

/** One row per exception; a replayed source is ignored. */
export async function raiseExceptionReview(client: Executor, input: RaiseExceptionInput): Promise<string | null> {
  const [row] = await client
    .insert(exceptionReviews)
    .values({
      orgId: input.orgId,
      kind: input.kind,
      sourceId: input.sourceId,
      orderId: input.orderId,
      subjectUserId: input.subjectUserId,
      subjectRole: input.subjectRole,
      severity: input.severity,
      summary: input.summary,
      amount: input.amount == null ? null : input.amount.toFixed(2),
      rules: input.rules ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: exceptionReviews.id });
  return row?.id ?? null;
}

export type Viewer = { userId: string; role: string };

/**
 * The SQL twin of mayReviewException: the subject's role (unknown counts as a
 * cashier) is one of the viewer's queues, and the viewer is not the subject.
 */
function visibleTo(viewer: Viewer, queues: Role[]) {
  if (viewer.role === "SUPER_ADMIN") return sql`TRUE`;
  if (queues.length === 0) return sql`FALSE`;
  return and(
    inArray(sql`COALESCE(${exceptionReviews.subjectRole}, 'CASHIER')`, queues),
    or(sql`${exceptionReviews.subjectUserId} IS NULL`, ne(exceptionReviews.subjectUserId, viewer.userId)),
  )!;
}

export type InboxItem = {
  id: string;
  kind: ExceptionKind;
  orderId: string | null;
  orderRef: string | null;
  subjectUserId: string | null;
  subjectName: string;
  subjectRole: string;
  severity: string;
  summary: string;
  amount: number | null;
  rules: unknown;
  state: ExceptionState;
  reviewerName: string | null;
  note: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

export type Inbox = {
  queues: Array<{ role: Role; label: string; open: number }>;
  /** Open for over STALE_AFTER_DAYS days, across the viewer's queues. */
  stale: number;
  staleLine: string;
  items: InboxItem[];
};

export async function listNeedsALook(
  orgId: string,
  viewer: Viewer,
  filter: { state?: ExceptionState | "all"; queue?: Role | null; kind?: ExceptionKind | null } = {},
): Promise<Inbox> {
  const queues = reviewQueuesFor(viewer.role);
  const visible = visibleTo(viewer, queues);
  const base = and(eq(exceptionReviews.orgId, orgId), visible);

  const counts: Array<{ role: string; open: number }> = await db
    .select({
      role: sql<string>`COALESCE(${exceptionReviews.subjectRole}, 'CASHIER')`,
      open: sql<number>`COUNT(*)::int`,
    })
    .from(exceptionReviews)
    .where(and(base, eq(exceptionReviews.state, "open")))
    .groupBy(sql`COALESCE(${exceptionReviews.subjectRole}, 'CASHIER')`);
  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);
  const [stale] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(exceptionReviews)
    .where(and(base, eq(exceptionReviews.state, "open"), lt(exceptionReviews.createdAt, staleCutoff)));

  const conds = [base];
  const state = filter.state ?? "open";
  if (state !== "all") conds.push(eq(exceptionReviews.state, state));
  if (filter.queue && queues.includes(filter.queue)) {
    conds.push(sql`COALESCE(${exceptionReviews.subjectRole}, 'CASHIER') = ${filter.queue}`);
  }
  if (filter.kind) conds.push(eq(exceptionReviews.kind, filter.kind));
  const rows = await db
    .select()
    .from(exceptionReviews)
    .where(and(...conds))
    .orderBy(desc(exceptionReviews.createdAt), desc(exceptionReviews.id))
    .limit(300);

  const ids = new Set<string>();
  for (const r of rows) {
    if (r.subjectUserId) ids.add(r.subjectUserId);
    if (r.reviewerId) ids.add(r.reviewerId);
  }
  const names = await resolveUserNames([...ids]);
  const openByRole = new Map(counts.map((c) => [c.role, Number(c.open) || 0]));
  const n = Number(stale?.n) || 0;
  return {
    queues: queues.map((role) => ({ role, label: QUEUE_LABELS[role], open: openByRole.get(role) ?? 0 })),
    stale: n,
    staleLine: staleLine(n),
    items: rows.map((r: typeof exceptionReviews.$inferSelect) => ({
      id: r.id,
      kind: r.kind as ExceptionKind,
      orderId: r.orderId,
      orderRef: r.orderId ? orderRefOf(r.orderId) : null,
      subjectUserId: r.subjectUserId,
      subjectName: r.subjectUserId ? names.get(r.subjectUserId) ?? "Unknown" : "Unknown",
      subjectRole: r.subjectRole ?? "CASHIER",
      severity: r.severity,
      summary: r.summary,
      amount: r.amount == null ? null : Number(r.amount),
      rules: r.rules,
      state: r.state as ExceptionState,
      reviewerName: r.reviewerId ? names.get(r.reviewerId) ?? "Unknown" : null,
      note: r.note,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
    })),
  };
}

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Set an exception's state, with an optional note. Escalating tells the people
 * above the reviewer (a manager's escalation reaches admins and the owner).
 */
export async function reviewException(args: {
  orgId: string;
  id: string;
  viewer: Viewer;
  state: ExceptionState;
  note?: string | null;
}): Promise<{ id: string; state: ExceptionState }> {
  return db.transaction(async (tx: Executor) => {
    const [row] = await tx
      .select()
      .from(exceptionReviews)
      .where(and(eq(exceptionReviews.id, args.id), eq(exceptionReviews.orgId, args.orgId)))
      .for("update");
    // Not yours to review reads the same as not there, so the route cannot be
    // used to learn about exceptions above the viewer.
    if (!row || !mayReviewException(args.viewer, { userId: row.subjectUserId, role: row.subjectRole })) {
      throw new ReviewError("There is nothing here for you to review.", 404, "EXCEPTION_NOT_FOUND");
    }
    const note = args.note?.trim() ? args.note.trim().slice(0, 2000) : null;
    await tx
      .update(exceptionReviews)
      .set({
        state: args.state,
        reviewerId: args.viewer.userId,
        note: note ?? row.note,
        reviewedAt: new Date(),
      })
      .where(eq(exceptionReviews.id, row.id));
    if (args.state === "escalated" && row.state !== "escalated") {
      const names = await resolveUserNames([args.viewer.userId]);
      const reviewer = names.get(args.viewer.userId) ?? "A reviewer";
      await notify(
        {
          orgId: args.orgId,
          title: `Escalated — ${reviewer}`,
          message: `${reviewer} escalated: ${row.summary}${note ? ` Note: ${note}` : ""}`,
          severity: "error",
          source: "exception_escalated",
          subjectUserId: args.viewer.userId,
          metadata: { orderId: row.orderId, entityId: row.id },
        },
        tx,
      );
    }
    return { id: row.id, state: args.state };
  });
}

export function reviewStateLabel(state: ExceptionState): string {
  return EXCEPTION_STATE_LABELS[state];
}

/**
 * A cashier's own count (their shift summary): exceptions about them in a
 * window. For prices it counts only sales where the till itself warned and
 * asked for a reason (price_guard_orders.confirmed is set). A sale flagged
 * only because it was below cost, or pushed under the minimum by the order's
 * discounts, is the managers' to see: counting it here would tell the cashier
 * that sale was below cost (owner Q4).
 */
export async function ownExceptionCount(
  orgId: string,
  userId: string,
  from: Date,
  to: Date | null,
  kind: ExceptionKind = "price",
): Promise<number> {
  const conds = [
    eq(exceptionReviews.orgId, orgId),
    eq(exceptionReviews.kind, kind),
    eq(exceptionReviews.subjectUserId, userId),
    sql`${exceptionReviews.createdAt} >= ${from}`,
    to ? sql`${exceptionReviews.createdAt} <= ${to}` : sql`TRUE`,
  ];
  if (kind === "price") {
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${priceGuardOrders} WHERE ${priceGuardOrders.id} = ${exceptionReviews.sourceId} AND ${priceGuardOrders.confirmed} IS NOT NULL)`,
    );
  }
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(exceptionReviews)
    .where(and(...conds));
  return Number(row?.n) || 0;
}

// ---------------------------------------------------------------------------
// The weekly line: "N unreviewed for over 7 days", as a Signal on Mondays.
// ---------------------------------------------------------------------------

/** The weekly line goes out on Mondays from this local hour. */
export const WEEKLY_LINE_HOUR = 9;

/**
 * Housekeeping: on Monday morning each org with stale open exceptions gets the
 * weekly line — managers the count in their queue (cashiers'), admins the
 * count across theirs (cashiers' and managers'); the owner sees every Signal.
 * Once per org per week, under an advisory lock so two runners cannot both send.
 */
export async function runWeeklyNeedsALook(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000);
  const orgRows: Array<{ orgId: string }> = await db
    .selectDistinct({ orgId: exceptionReviews.orgId })
    .from(exceptionReviews)
    .where(and(eq(exceptionReviews.state, "open"), lt(exceptionReviews.createdAt, cutoff)));
  let sent = 0;
  for (const { orgId } of orgRows) {
    const tz = await orgTimeZone(orgId);
    const week = weekKeyFor(now, tz);
    if (week.weekday !== 1 || week.hour < WEEKLY_LINE_HOUR) continue;
    sent += await db.transaction(async (tx: Executor) => {
      const lockKey = `needs_a_look_weekly:${orgId}:${week.key}`;
      const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS got`);
      const got = (lock as any).rows?.[0]?.got ?? (lock as any)[0]?.got;
      if (!got) return 0;
      const [already] = await tx
        .select({ id: orgNotifications.id })
        .from(orgNotifications)
        .where(
          and(
            eq(orgNotifications.orgId, orgId),
            eq(orgNotifications.source, "needs_a_look_weekly"),
            sql`${orgNotifications.metadata}->>'week' = ${week.key}`,
          ),
        )
        .limit(1);
      if (already) return 0;
      const staleBy: Array<{ role: string; n: number }> = await tx
        .select({
          role: sql<string>`COALESCE(${exceptionReviews.subjectRole}, 'CASHIER')`,
          n: sql<number>`COUNT(*)::int`,
        })
        .from(exceptionReviews)
        .where(and(eq(exceptionReviews.orgId, orgId), eq(exceptionReviews.state, "open"), lt(exceptionReviews.createdAt, cutoff), isNotNull(exceptionReviews.id)))
        .groupBy(sql`COALESCE(${exceptionReviews.subjectRole}, 'CASHIER')`);
      const count = (roles: string[]) => staleBy.filter((s) => roles.includes(s.role)).reduce((a, s) => a + (Number(s.n) || 0), 0);
      let out = 0;
      const forManagers = count(["CASHIER"]);
      const forAdmins = count(["CASHIER", "MANAGER"]);
      if (forManagers > 0) {
        await notify(
          {
            orgId,
            title: "Needs a look",
            message: `${staleLine(forManagers)} (cashiers).`,
            severity: "warning",
            source: "needs_a_look_weekly",
            audience: { roles: ["MANAGER"] },
            metadata: { week: week.key, queue: "CASHIER" },
          },
          tx,
        );
        out++;
      }
      if (forAdmins > 0) {
        await notify(
          {
            orgId,
            title: "Needs a look",
            message: `${staleLine(forAdmins)} (cashiers and managers).`,
            severity: "warning",
            source: "needs_a_look_weekly",
            audience: { roles: ["ADMIN"] },
            metadata: { week: week.key, queue: "MANAGER" },
          },
          tx,
        );
        out++;
      }
      return out;
    });
  }
  return sent;
}

export { EXCEPTION_STATE_LABELS, QUEUE_LABELS };
